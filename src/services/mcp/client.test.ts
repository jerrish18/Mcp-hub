import test from 'node:test';
import assert from 'node:assert/strict';
import { callMcpTool, connectAndInspectServer, parseSseJsonRpcMessage, sendMcpRpc } from './client';
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

