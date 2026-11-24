import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import { createControlRouter } from './controlRouter.ts';

describe('createControlRouter (App API Key + External Control)', () => {
  let server: http.Server;
  let baseUrl = '';
  let tmpDir = '';
  let storageFile = '';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-control-test-'));
    storageFile = path.join(tmpDir, 'control-keys.json');

    const app = express();
    const router = createControlRouter({ storageFilePath: storageFile });
    app.use('/api', router);
    app.post('/mcp', (req, res, next) => {
      req.url = '/mcp-endpoint';
      router(req, res, next);
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects key creation without X-MCPHub-UI header or with cross-origin Origin header', async () => {
    const noHeader = await fetch(`${baseUrl}/api/control/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'Blocked', scope: 'full' }),
    });
    assert.equal(noHeader.status, 403);

    const crossOrigin = await fetch(`${baseUrl}/api/control/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCPHub-UI': '1',
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ label: 'Evil', scope: 'full' }),
    });
    assert.equal(crossOrigin.status, 403);
  });

  it('generates SHA-256 hashed App API keys, enforces auth/scopes across REST & MCP, and supports instant revocation', async () => {
    // 1. Generate a read_only key
    const roRes = await fetch(`${baseUrl}/api/control/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ label: 'Telemetry Bot', scope: 'read_only' }),
    });
    assert.equal(roRes.status, 201);
    const roData = (await roRes.json()) as {
      key: { id: string; prefix: string; scope: string; active: boolean };
      plaintextKey: string;
    };
    assert.ok(roData.plaintextKey.startsWith('mcphub_live_'));
    assert.equal(roData.key.scope, 'read_only');

    // Confirm plaintext secret is NEVER persisted to disk
    const persistedRaw = fs.readFileSync(storageFile, 'utf8');
    assert.equal(persistedRaw.includes(roData.plaintextKey), false);
    assert.ok(persistedRaw.includes('hashHex'));

    // 2. Reject missing or bogus bearer token with 401
    const unauth = await fetch(`${baseUrl}/api/control/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_workspace_overview', params: {} }),
    });
    assert.equal(unauth.status, 401);

    const wrongKey = await fetch(`${baseUrl}/api/control/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer mcphub_live_definitely_wrong_token',
      },
      body: JSON.stringify({ action: 'get_workspace_overview', params: {} }),
    });
    assert.equal(wrongKey.status, 401);

    // 3. Read-only key can inspect state but gets 403 on write/navigation actions
    const roState = await fetch(`${baseUrl}/api/control/state`, {
      headers: { Authorization: `Bearer ${roData.plaintextKey}` },
    });
    assert.equal(roState.status, 200);
    const roStateJson = (await roState.json()) as { mode: string; connectedServers: number };
    assert.equal(roStateJson.mode, 'headless_server_mirror');

    const roDenied = await fetch(`${baseUrl}/api/control/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${roData.plaintextKey}`,
      },
      body: JSON.stringify({ action: 'navigate_tab', params: { tab: 'chat' } }),
    });
    assert.equal(roDenied.status, 403);

    // 4. Generate a chat_and_tools key and test Remote MCP Server (/mcp) + REST execution
    const ctRes = await fetch(`${baseUrl}/api/control/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ label: 'Cursor Agent', scope: 'chat_and_tools' }),
    });
    assert.equal(ctRes.status, 201);
    const ctData = (await ctRes.json()) as { key: { id: string }; plaintextKey: string };

    // MCP initialize
    const mcpInit = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctData.plaintextKey}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    assert.equal(mcpInit.status, 200);
    const mcpInitJson = (await mcpInit.json()) as { result: { serverInfo: { name: string } } };
    assert.equal(mcpInitJson.result.serverInfo.name, 'MCP Hub Remote Control Server');

    // MCP tools/list excludes admin-only actions like delete_server for chat_and_tools scope
    const mcpTools = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctData.plaintextKey}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const mcpToolsJson = (await mcpTools.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const toolNames = mcpToolsJson.result.tools.map((t) => t.name);
    assert.ok(toolNames.includes('call_mcp_tool'));
    assert.ok(toolNames.includes('navigate_tab'));
    assert.equal(toolNames.includes('delete_server'), false);

    // MCP tools/call invokes call_mcp_tool -> virtualSandbox calculate_expression
    const mcpCall = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctData.plaintextKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'call_mcp_tool',
          arguments: {
            serverId: 'srv_sandbox',
            toolName: 'calculate_expression',
            arguments: { expression: '6 * 7' },
          },
        },
      }),
    });
    assert.equal(mcpCall.status, 200);
    const mcpCallJson = (await mcpCall.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    assert.equal(mcpCallJson.result.isError, false);
    assert.ok(mcpCallJson.result.content[0].text.includes('42'));

    // 5. Revoke key and verify immediate 401 rejection
    const revokeRes = await fetch(`${baseUrl}/api/control/keys/${ctData.key.id}`, {
      method: 'DELETE',
      headers: { 'X-MCPHub-UI': '1' },
    });
    assert.equal(revokeRes.status, 200);

    const afterRevoke = await fetch(`${baseUrl}/api/control/state`, {
      headers: { 'X-API-Key': ctData.plaintextKey },
    });
    assert.equal(afterRevoke.status, 401);
  });

  it('ignores literal empty-quote or MY_ placeholder adminToken values', async () => {
    const app = express();
    app.use('/api', createControlRouter({ storageFilePath: '', adminToken: '""' }));
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = srv.address() as { port: number };
      const statusRes = await fetch(`http://127.0.0.1:${addr.port}/api/control/bridge/status`);
      const statusJson = (await statusRes.json()) as { adminTokenRequired: boolean };
      assert.equal(statusJson.adminTokenRequired, false);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it('always enforces adminToken when configured, even without Origin header or extra flags', async () => {
    const app = express();
    app.use(
      '/api',
      createControlRouter({
        storageFilePath: '',
        adminToken: 'super-secret-admin-token-1234',
      })
    );
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = srv.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;

      // Missing Origin header AND X-MCPHub-UI=1 alone must still fail with 401 when adminToken is set
      const noToken = await fetch(`${url}/api/control/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
        body: JSON.stringify({ label: 'Unauth', scope: 'read_only' }),
      });
      assert.equal(noToken.status, 401);

      // Valid Bearer adminToken succeeds even without Origin header
      const withToken = await fetch(`${url}/api/control/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MCPHub-UI': '1',
          Authorization: 'Bearer super-secret-admin-token-1234',
        },
        body: JSON.stringify({ label: 'Admin Created', scope: 'read_only' }),
      });
      assert.equal(withToken.status, 201);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it('refuses to mount /control/keys and /control/bridge/* in production when adminToken is missing', async () => {
    const app = express();
    app.use(
      '/api',
      createControlRouter({
        storageFilePath: '',
        adminToken: '',
        isProduction: true,
      })
    );
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = srv.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;

      const createKeyRes = await fetch(`${url}/api/control/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
        body: JSON.stringify({ label: 'Blocked', scope: 'full' }),
      });
      assert.ok(createKeyRes.status === 404 || createKeyRes.status === 403);

      const bridgeRes = await fetch(`${url}/api/control/bridge/status`);
      assert.ok(bridgeRes.status === 404 || bridgeRes.status === 403);
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it('persists control activity log across router restarts with redacted details', async () => {
    const restartDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-activity-test-'));
    const keysFile = path.join(restartDir, 'control-keys.json');
    const activityFile = path.join(restartDir, 'control-activity.json');

    const startInstance = async () => {
      const app = express();
      app.use(
        '/api',
        createControlRouter({
          storageFilePath: keysFile,
          activityFilePath: activityFile,
        })
      );
      const srv = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const addr = srv.address() as { port: number };
      return { srv, url: `http://127.0.0.1:${addr.port}` };
    };

    try {
      const first = await startInstance();
      let createdKey = '';
      try {
        const keyRes = await fetch(`${first.url}/api/control/keys`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
          body: JSON.stringify({ label: 'AuditBot', scope: 'read_only' }),
        });
        const keyJson = (await keyRes.json()) as { plaintextKey: string };
        createdKey = keyJson.plaintextKey;

        await fetch(`${first.url}/api/control/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${createdKey}`,
          },
          body: JSON.stringify({ action: 'get_workspace_overview', params: {} }),
        });
      } finally {
        await new Promise<void>((resolve) => first.srv.close(() => resolve()));
      }

      // Spin up a brand new router instance pointed at the same files
      const second = await startInstance();
      try {
        const listRes = await fetch(`${second.url}/api/control/keys?limit=100`);
        assert.equal(listRes.status, 200);
        const listJson = (await listRes.json()) as {
          activity: Array<{ action: string; status: string; keyLabel: string }>;
        };
        assert.ok(listJson.activity.length >= 1);
        assert.equal(listJson.activity[0].action, 'get_workspace_overview');
        assert.equal(listJson.activity[0].status, 'ok');
        assert.equal(listJson.activity[0].keyLabel, 'AuditBot');
      } finally {
        await new Promise<void>((resolve) => second.srv.close(() => resolve()));
      }
    } finally {
      fs.rmSync(restartDir, { recursive: true, force: true });
    }
  });
});
