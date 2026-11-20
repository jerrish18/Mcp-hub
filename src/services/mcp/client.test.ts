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
