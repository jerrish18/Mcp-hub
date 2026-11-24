import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callMcpTool,
  connectAndInspectServer,
  disconnectMcpServer,
  getMcpPrompt,
  onMcpListChanged,
  parseSseJsonRpcMessage,
  pingMcpServer,
  readMcpResource,
  reconnectWithBackoff,
  sendMcpRpc,
} from './client';
import { parseMcpAddDeepLink } from '../../config/connectors';
import type { McpServerConfig, ServerSecretPayload } from '../../types';

test('parseSseJsonRpcMessage extracts matching JSON-RPC frame from SSE payload', () => {
  const sse = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":10,"result":{"ok":true}}',
    '',
    'event: message',
    'data: {"jsonrpc":"2.0","id":11,"result":{"tools":[]}}',
    '',
  ].join('\n');

  const msg = parseSseJsonRpcMessage(sse, 11);
  assert.deepEqual(msg?.result, { tools: [] });
});

test('virtual sandbox MCP server lists tools and executes calculations', async () => {
  const virtualServer: McpServerConfig = {
    id: 'srv_virtual',
    name: 'Sandbox',
    url: 'virtual://mcp-hub-sandbox',
    authType: 'none',
    enabled: true,
    transportPreference: 'auto',
    status: 'disconnected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const inspected = await connectAndInspectServer({ server: virtualServer, secrets: {} });
  assert.ok(inspected.tools.some((t) => t.name === 'workspace_search_notes' && t.annotations?.readOnlyHint === true));
  assert.ok(inspected.tools.some((t) => t.name === 'workspace_create_note' && t.annotations?.readOnlyHint === false));

  const calcRes = await callMcpTool({
    server: virtualServer,
    secrets: {},
    toolName: 'calculate_expression',
    args: { expression: '(10 + 5) * 2' },
  });
  assert.equal(calcRes.isError, false);
  assert.ok(calcRes.text.includes('30'));
});

test('sendMcpRpc falls back to SSE when Streamable HTTP returns 405 and retries 401 with refreshed OAuth token', async () => {
  const server: McpServerConfig = {
    id: 'srv_remote_test',
    name: 'Remote Test',
    url: 'https://mcp.remote.test/mcp',
    authType: 'oauth_pkce',
    enabled: true,
    transportPreference: 'auto',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  let secrets: ServerSecretPayload = {
    oauthClientId: 'cid',
    oauthMetadata: {
      authorizationEndpoint: 'https://auth.remote.test/auth',
      tokenEndpoint: 'https://auth.remote.test/token',
    },
    oauthTokens: {
      accessToken: 'expired_token',
      refreshToken: 'refresh_tok',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600_000,
    },
  };

  const log: string[] = [];
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    log.push(`${init?.method ?? 'GET'} ${url} auth=${auth ?? 'none'}`);

    if (url === 'https://auth.remote.test/token') {
      return new Response(
        JSON.stringify({ access_token: 'new_token', refresh_token: 'refresh_tok_2', expires_in: 3600 }),
        { status: 200 }
      );
    }

    // First attempt with expired_token returns 401 -> triggers refresh and retry
    if (auth === 'Bearer expired_token') {
      return new Response('Unauthorized', { status: 401 });
    }

    if (url === 'https://mcp.remote.test/mcp' && init?.method === 'POST') {
      // Simulate server rejecting Streamable HTTP POST with 405 so client falls back to SSE
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url === 'https://mcp.remote.test/mcp' && (!init?.method || init.method === 'GET')) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: endpoint\ndata: /messages?sid=42\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    if (url === 'https://mcp.remote.test/messages?sid=42' && init?.method === 'POST') {
      const req = JSON.parse(String(init.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Unexpected', { status: 500 });
  }) as typeof fetch;

  const res = await sendMcpRpc<{ tools: unknown[] }>({
    server,
    secrets,
    saveUpdatedSecrets: async (u) => {
      secrets = u;
    },
    method: 'tools/list',
    fetchFn: mockFetch,
  });

  assert.deepEqual(res.result.tools, []);
  assert.equal(secrets.oauthTokens?.accessToken, 'new_token');
  assert.ok(log.some((entry) => entry.includes('https://mcp.remote.test/messages?sid=42')));
});

test('virtual sandbox monotonic note IDs never collide after deleting notes', async () => {
  const virtualServer: McpServerConfig = {
    id: 'srv_virtual',
    name: 'Sandbox',
    url: 'virtual://mcp-hub-sandbox',
    authType: 'none',
    enabled: true,
    transportPreference: 'auto',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const c1 = await callMcpTool({
    server: virtualServer,
    secrets: {},
    toolName: 'workspace_create_note',
    args: { title: 'Note A', content: 'First' },
  });
  const m1 = c1.text.match(/Created note (note-\d+):/);
  assert.ok(m1?.[1]);

  await callMcpTool({
    server: virtualServer,
    secrets: {},
    toolName: 'workspace_delete_note',
    args: { id: m1[1] },
  });

  const c2 = await callMcpTool({
    server: virtualServer,
    secrets: {},
    toolName: 'workspace_create_note',
    args: { title: 'Note B', content: 'Second' },
  });
  const m2 = c2.text.match(/Created note (note-\d+):/);
  assert.ok(m2?.[1]);
  assert.notEqual(m1[1], m2[1]);
});

test('virtual YouTube and GitHub connectors inspect tools and execute read/write actions cleanly', async () => {
  const ytServer: McpServerConfig = {
    id: 'srv_youtube',
    name: 'YouTube',
    url: 'virtual://youtube-data-api',
    authType: 'bearer',
    enabled: true,
    transportPreference: 'auto',
    status: 'disconnected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const ytMockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    assert.ok(url.includes('googleapis.com/youtube/v3/'));
    assert.ok(url.includes('key=AIzaFakeYouTubeKey'));
    if (url.includes('/youtube/v3/videos')) {
      return new Response(JSON.stringify({ items: [{ id: 'check1' }] }), { status: 200 });
    }
    assert.ok(url.includes('/youtube/v3/search'));
    return new Response(
      JSON.stringify({
        items: [
          {
            id: { videoId: 'vid123' },
            snippet: { title: 'MCP Tutorial', channelTitle: 'DevHub', publishedAt: '2026-01-01', description: 'Guide' },
          },
        ],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const ytInspected = await connectAndInspectServer({
    server: ytServer,
    secrets: { bearerToken: 'AIzaFakeYouTubeKey' },
    fetchFn: ytMockFetch,
  });
  assert.ok(ytInspected.tools.some((t) => t.name === 'youtube_search_videos' && t.annotations?.readOnlyHint === true));

  const ytCall = await callMcpTool({
    server: ytServer,
    secrets: { bearerToken: 'AIzaFakeYouTubeKey' },
    toolName: 'youtube_search_videos',
    args: { query: 'mcp' },
    fetchFn: ytMockFetch,
  });
  assert.equal(ytCall.isError, false);
  assert.ok(ytCall.text.includes('vid123'));

  const ghServer: McpServerConfig = {
    id: 'srv_github',
    name: 'GitHub',
    url: 'virtual://github-api',
    authType: 'bearer',
    enabled: true,
    transportPreference: 'auto',
    status: 'disconnected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const ghMockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/user')) {
      return new Response(JSON.stringify({ login: 'octocat' }), { status: 200 });
    }
    return new Response(
      JSON.stringify([{ full_name: 'octocat/Hello-World', private: false, html_url: 'https://github.com/octocat/Hello-World' }]),
      { status: 200 }
    );
  }) as typeof fetch;

  const ghInspected = await connectAndInspectServer({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test123456' },
    fetchFn: ghMockFetch,
  });
  assert.ok(ghInspected.tools.some((t) => t.name === 'github_create_issue' && t.annotations?.readOnlyHint === false));

  const ghRepos = await callMcpTool({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test123456' },
    toolName: 'github_list_repos',
    args: { perPage: 5 },
    fetchFn: ghMockFetch,
  });
  assert.equal(ghRepos.isError, false);
  assert.ok(ghRepos.text.includes('octocat/Hello-World'));
});

test('sendMcpRpc recovers from stale Mcp-Session-Id 404 by clearing session and retrying once', async () => {
  const server: McpServerConfig = {
    id: 'srv_session_reset',
    name: 'Session Reset Test',
    url: 'https://mcp.session.test/mcp',
    authType: 'none',
    enabled: true,
    transportPreference: 'streamable_http',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  let callNum = 0;
  const seenSessions: Array<string | null> = [];
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    callNum++;
    const headers = init?.headers as Record<string, string>;
    seenSessions.push(headers['Mcp-Session-Id'] ?? null);

    if (callNum === 1) {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess_old' },
      });
    }
    if (callNum === 2) {
      return new Response('Session Expired', { status: 404 });
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { recovered: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess_new' },
    });
  }) as typeof fetch;

  // Prime session cache
  await sendMcpRpc({ server, secrets: {}, method: 'ping', fetchFn: mockFetch });
  // Second call gets 404 on sess_old -> auto-clears session and retries cleanly without session header
  const second = await sendMcpRpc<{ recovered: boolean }>({
    server,
    secrets: {},
    method: 'tools/list',
    fetchFn: mockFetch,
  });

  assert.equal(second.result.recovered, true);
  assert.deepEqual(seenSessions, [null, 'sess_old', null]);
});

test('GitHub virtual MCP supports repo creation, UTF-8 read, file push with SHA lookup, and atomic batch commits', async () => {
  const ghServer: McpServerConfig = {
    id: 'srv_github',
    name: 'GitHub',
    url: 'virtual://github-api',
    authType: 'bearer',
    enabled: true,
    transportPreference: 'auto',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const requests: string[] = [];
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url}`);

    if (method === 'POST' && url === 'https://api.github.com/user/repos') {
      const body = JSON.parse(String(init?.body)) as { name: string; private: boolean };
      return new Response(
        JSON.stringify({
          full_name: `octocat/${body.name}`,
          name: body.name,
          default_branch: 'main',
          private: body.private,
          html_url: `https://github.com/octocat/${body.name}`,
          owner: { login: 'octocat' },
        }),
        { status: 201 }
      );
    }

    if (method === 'GET' && url === 'https://api.github.com/repos/octocat/demo/contents/README.md') {
      const encoded = Buffer.from('# Hello ✓', 'utf8').toString('base64');
      return new Response(
        JSON.stringify({
          path: 'README.md',
          sha: 'sha_existing_1',
          size: 9,
          encoding: 'base64',
          content: encoded,
          html_url: 'https://github.com/octocat/demo/blob/main/README.md',
        }),
        { status: 200 }
      );
    }

    if (method === 'PUT' && url === 'https://api.github.com/repos/octocat/demo/contents/README.md') {
      const body = JSON.parse(String(init?.body)) as { sha?: string; content: string };
      assert.equal(body.sha, 'sha_existing_1');
      assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '# Updated ✓');
      return new Response(
        JSON.stringify({
          content: { path: 'README.md', html_url: 'https://github.com/octocat/demo/blob/main/README.md' },
          commit: { sha: 'commit_sha_single', html_url: 'https://github.com/octocat/demo/commit/commit_sha_single' },
        }),
        { status: 200 }
      );
    }

    // Batch push flow: existing initialized repo
    if (method === 'GET' && url === 'https://api.github.com/repos/octocat/demo') {
      return new Response(JSON.stringify({ default_branch: 'main', html_url: 'https://github.com/octocat/demo' }), { status: 200 });
    }
    if (method === 'GET' && url === 'https://api.github.com/repos/octocat/demo/git/ref/heads/main') {
      return new Response(JSON.stringify({ object: { sha: 'head_sha_1' } }), { status: 200 });
    }
    if (method === 'GET' && url === 'https://api.github.com/repos/octocat/demo/git/commits/head_sha_1') {
      return new Response(JSON.stringify({ tree: { sha: 'base_tree_1' } }), { status: 200 });
    }
    if (method === 'POST' && url === 'https://api.github.com/repos/octocat/demo/git/blobs') {
      return new Response(JSON.stringify({ sha: 'blob_sha_x' }), { status: 201 });
    }
    if (method === 'POST' && url === 'https://api.github.com/repos/octocat/demo/git/trees') {
      return new Response(JSON.stringify({ sha: 'new_tree_sha' }), { status: 201 });
    }
    if (method === 'POST' && url === 'https://api.github.com/repos/octocat/demo/git/commits') {
      return new Response(JSON.stringify({ sha: 'new_commit_sha', html_url: 'https://github.com/octocat/demo/commit/new_commit_sha' }), { status: 201 });
    }
    if (method === 'PATCH' && url === 'https://api.github.com/repos/octocat/demo/git/refs/heads/main') {
      return new Response(JSON.stringify({ object: { sha: 'new_commit_sha' } }), { status: 200 });
    }

    // Empty-repo bootstrap flow
    if (method === 'GET' && url === 'https://api.github.com/repos/octocat/empty-repo') {
      return new Response(JSON.stringify({ default_branch: 'main', html_url: 'https://github.com/octocat/empty-repo' }), { status: 200 });
    }
    if (method === 'GET' && url === 'https://api.github.com/repos/octocat/empty-repo/git/ref/heads/main') {
      return new Response('Conflict - empty repository', { status: 409 });
    }
    if (method === 'PUT' && url === 'https://api.github.com/repos/octocat/empty-repo/contents/index.html') {
      return new Response(
        JSON.stringify({ commit: { sha: 'boot_sha_1', html_url: 'https://github.com/octocat/empty-repo/commit/boot_sha_1' } }),
        { status: 201 }
      );
    }

    return new Response(`Unhandled mock URL: ${method} ${url}`, { status: 404 });
  }) as typeof fetch;

  const created = await callMcpTool({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test' },
    toolName: 'github_create_repo',
    args: { name: 'demo', private: false },
    fetchFn: mockFetch,
  });
  assert.equal(created.isError, false);
  assert.ok(created.text.includes('octocat/demo'));

  const readRes = await callMcpTool({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test' },
    toolName: 'github_read_file',
    args: { owner: 'octocat', repo: 'demo', path: 'README.md' },
    fetchFn: mockFetch,
  });
  assert.equal(readRes.isError, false);
  assert.ok(readRes.text.includes('# Hello ✓'));

  const pushSingle = await callMcpTool({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test' },
    toolName: 'github_push_file',
    args: { owner: 'octocat', repo: 'demo', path: 'README.md', content: '# Updated ✓', message: 'docs: update' },
    fetchFn: mockFetch,
  });
  assert.equal(pushSingle.isError, false);
  assert.ok(pushSingle.text.includes('commit_sha_single'));

  const pushBatch = await callMcpTool({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test' },
    toolName: 'github_push_files_batch',
    args: {
      owner: 'octocat',
      repo: 'demo',
      branch: 'main',
      message: 'feat: batch push',
      files: [
        { path: 'index.html', content: '<h1>App</h1>' },
        { path: 'app.js', content: 'console.log(1);' },
      ],
    },
    fetchFn: mockFetch,
  });
  assert.equal(pushBatch.isError, false);
  assert.ok(pushBatch.text.includes('new_commit_sha'));

  const pushEmpty = await callMcpTool({
    server: ghServer,
    secrets: { bearerToken: 'ghp_test' },
    toolName: 'github_push_files_batch',
    args: {
      owner: 'octocat',
      repo: 'empty-repo',
      branch: 'main',
      message: 'feat: bootstrap',
      files: [{ path: 'index.html', content: '<h1>Boot</h1>' }],
    },
    fetchFn: mockFetch,
  });
  assert.equal(pushEmpty.isError, false);
  assert.ok(pushEmpty.text.includes('boot_sha_1'));
});

test('Phase 2: protocol negotiation falls back 2025-06-18 -> 2025-03-26 and sends MCP-Protocol-Version header', async () => {
  const srv: McpServerConfig = {
    id: 'srv_proto_fallback',
    name: 'Legacy Proto',
    url: 'https://mcp.legacy.test/mcp',
    authType: 'none',
    enabled: true,
    transportPreference: 'streamable_http',
    status: 'disconnected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const seenHeaders: Array<{ method: string; protocolHeader?: string }> = [];
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      id?: number;
      method: string;
      params?: { protocolVersion?: string };
    };
    const hdrs = init?.headers as Record<string, string>;
    seenHeaders.push({ method: body.method, protocolHeader: hdrs['MCP-Protocol-Version'] });

    if (body.method === 'initialize') {
      if (body.params?.protocolVersion === '2025-06-18') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Unsupported protocolVersion' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26' } }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sid_proto_1' } }
      );
    }

    if (body.method === 'tools/list') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (body.method === 'resources/list') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { resources: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (body.method === 'prompts/list') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { prompts: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 202 });
  }) as typeof fetch;

  const res = await connectAndInspectServer({ server: srv, secrets: {}, fetchFn: mockFetch });
  assert.equal(res.protocolVersion, '2025-03-26');
  const toolsCallHeader = seenHeaders.find((h) => h.method === 'tools/list');
  assert.equal(toolsCallHeader?.protocolHeader, '2025-03-26');
});

test('Phase 2: virtual sandbox reads resources and formats prompts', async () => {
  const virtualServer: McpServerConfig = {
    id: 'srv_virtual_res_prompt',
    name: 'Sandbox',
    url: 'virtual://mcp-hub-sandbox',
    authType: 'none',
    enabled: true,
    transportPreference: 'auto',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const inspected = await connectAndInspectServer({ server: virtualServer, secrets: {} });
  assert.ok(inspected.resources.length >= 1);
  assert.ok(inspected.prompts.length >= 1);

  const resource = await readMcpResource({
    server: virtualServer,
    secrets: {},
    uri: inspected.resources[0].uri,
  });
  assert.ok(resource.textSummary.length > 0);

  const prompt = await getMcpPrompt({
    server: virtualServer,
    secrets: {},
    name: inspected.prompts[0].name,
    arguments: { topic: 'MCP Streams', audience: 'engineers' },
  });
  assert.ok(prompt.composedText.length > 0);
});

test('Phase 2: callMcpTool streams SSE notifications/progress, list_changed, mediaBlocks and structuredContent', async () => {
  const srv: McpServerConfig = {
    id: 'srv_sse_media',
    name: 'Media MCP',
    url: 'https://mcp.media.test/mcp',
    authType: 'none',
    enabled: true,
    transportPreference: 'streamable_http',
    protocolVersion: '2025-06-18',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const listChangedEvents: string[] = [];
  const unsub = onMcpListChanged((serverId, kind) => {
    if (serverId === srv.id) listChangedEvents.push(kind);
  });

  const progressUpdates: Array<{ progress: number; total?: number; message?: string }> = [];
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body ?? '{}')) as {
      id: number;
      params?: { _meta?: { progressToken?: string } };
    };
    const token = req.params?._meta?.progressToken ?? 'tok';
    const ssePayload = [
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken: token, progress: 50, total: 100, message: 'Rendering' },
      })}\n\n`,
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed',
        params: {},
      })}\n\n`,
      `event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            { type: 'text', text: 'Chart generated.' },
            { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            { type: 'audio', uri: 'https://cdn.media.test/out.mp3', mimeType: 'audio/mpeg' },
          ],
          structuredContent: { rows: 12, status: 'ok' },
          isError: false,
        },
      })}\n\n`,
    ];

    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const chunk of ssePayload) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sid_media_99' },
    });
  }) as typeof fetch;

  try {
    const res = await callMcpTool({
      server: srv,
      secrets: {},
      toolName: 'render_chart',
      args: { metric: 'revenue' },
      onProgress: (u) => progressUpdates.push({ progress: u.progress, total: u.total, message: u.message }),
      fetchFn: mockFetch,
    });

    assert.equal(res.isError, false);
    assert.ok(res.text.includes('Chart generated.'));
    assert.equal(res.mediaBlocks.length, 2);
    assert.equal(res.mediaBlocks[0].type, 'image');
    assert.equal(res.mediaBlocks[1].type, 'audio');
    assert.deepEqual(res.structuredContent, { rows: 12, status: 'ok' });
    assert.equal(progressUpdates.length, 1);
    assert.equal(progressUpdates[0].progress, 50);
    assert.deepEqual(listChangedEvents, ['tools']);
  } finally {
    unsub();
  }
});

test('Phase 2: disconnectMcpServer sends DELETE with Mcp-Session-Id and abort sends notifications/cancelled', async () => {
  const srv: McpServerConfig = {
    id: 'srv_cancel_delete',
    name: 'Cancel Delete',
    url: 'https://mcp.cancel.test/mcp',
    authType: 'none',
    enabled: true,
    transportPreference: 'streamable_http',
    protocolVersion: '2025-06-18',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  const calls: Array<{ method: string; sid?: string | null; rpcMethod?: string }> = [];
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (method === 'DELETE') {
      calls.push({ method: 'DELETE', sid: headers['Mcp-Session-Id'] });
      return new Response('', { status: 204 });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { id?: number; method: string };
    calls.push({ method, sid: headers['Mcp-Session-Id'], rpcMethod: body.method });
    if (body.method === 'ping') {
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sid_del_7' },
      });
    }
    if (body.method === 'notifications/cancelled') {
      return new Response('', { status: 202 });
    }
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }) as typeof fetch;

  const ping = await pingMcpServer({ server: srv, secrets: {}, fetchFn: mockFetch });
  assert.equal(ping.ok, true);

  const ac = new AbortController();
  const slowPromise = sendMcpRpc({
    server: srv,
    secrets: {},
    method: 'tools/call',
    signal: ac.signal,
    fetchFn: mockFetch,
  });
  setTimeout(() => ac.abort(), 15);
  await assert.rejects(() => slowPromise);
  await new Promise((r) => setTimeout(r, 10));

  await disconnectMcpServer(srv.id, mockFetch);

  assert.ok(calls.some((c) => c.rpcMethod === 'notifications/cancelled'));
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.sid === 'sid_del_7'));
});

test('Phase 2: reconnectWithBackoff retries transient failures and parseMcpAddDeepLink parses deep links', async () => {
  let attempts = 0;
  const val = await reconnectWithBackoff(
    async () => {
      attempts++;
      if (attempts < 2) throw new Error('Network glitch');
      return 'connected';
    },
    { maxAttempts: 3, baseDelayMs: 50 }
  );
  assert.equal(val, 'connected');
  assert.equal(attempts, 2);

  const d1 = parseMcpAddDeepLink('mcphub://add?url=https%3A%2F%2Fmcp.linear.app%2Fmcp&name=Linear&authType=oauth_pkce');
  assert.deepEqual(d1, {
    url: 'https://mcp.linear.app/mcp',
    name: 'Linear',
    authType: 'oauth_pkce',
  });

  const d2 = parseMcpAddDeepLink('https://app.mcphub.dev/?mcphub_add=https://mcp.notion.com/mcp&name=Notion');
  assert.deepEqual(d2, {
    url: 'https://mcp.notion.com/mcp',
    name: 'Notion',
    authType: undefined,
  });

  const rejected = parseMcpAddDeepLink('mcphub://add?url=http://insecure.example.com/mcp');
  assert.equal(rejected, null);
});



