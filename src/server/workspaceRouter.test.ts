import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createWorkspaceRouter } from './workspaceRouter';
import type { PublicAppUser } from './authRouter';

function startTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-ws-test-'));
  const app = express();
  const users: Record<string, PublicAppUser> = {
    token_a: { id: 'user_alpha_1', email: 'alpha@example.com', displayName: 'Alpha', provider: 'app', createdAt: 1700000000000 },
    token_b: { id: 'user_beta_2', email: 'beta@example.com', displayName: 'Beta', provider: 'app', createdAt: 1700000000000 },
    token_bad: { id: '../escape', email: 'bad@example.com', displayName: 'Bad', provider: 'app', createdAt: 1700000000000 },
  };
  app.use(
    '/api',
    createWorkspaceRouter({
      storageDir: tmpDir,
      verifyBearerToken: (authHeader) => {
        if (!authHeader?.startsWith('Bearer ')) return null;
        return users[authHeader.slice(7).trim()] ?? null;
      },
    })
  );

  return new Promise<{ server: http.Server; baseUrl: string; cleanup: () => void }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}/api`,
        cleanup: () => {
          server.close();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        },
      });
    });
  });
}

test('workspaceRouter enforces auth, isolates accounts, and rejects traversal IDs', async () => {
  const { baseUrl, cleanup } = await startTestServer();
  try {
    const unauth = await fetch(`${baseUrl}/workspace`);
    assert.equal(unauth.status, 401);

    const missingUiHeader = await fetch(`${baseUrl}/workspace`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer token_a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ settings: { theme: 'dark' } }),
    });
    assert.equal(missingUiHeader.status, 403);

    const badTraversal = await fetch(`${baseUrl}/workspace`, {
      headers: { Authorization: 'Bearer token_bad' },
    });
    assert.equal(badTraversal.status, 400);

    // Save workspace for Account A
    const putA = await fetch(`${baseUrl}/workspace`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer token_a',
        'Content-Type': 'application/json',
        'x-mcphub-ui': '1',
      },
      body: JSON.stringify({
        settings: { theme: 'dark', a2uiEnabled: false },
        conversations: [{ id: 'conv_a1', title: 'Alpha Study' }],
        savedStudyNotes: [{ id: 'note_a1', title: 'Alpha Note' }],
      }),
    });
    assert.equal(putA.status, 200);

    // Account B has empty workspace
    const getB = await fetch(`${baseUrl}/workspace`, {
      headers: { Authorization: 'Bearer token_b' },
    });
    assert.equal(getB.status, 200);
    const jsonB = (await getB.json()) as { workspace: unknown };
    assert.equal(jsonB.workspace, null);

    // Account A restores exact saved state
    const getA = await fetch(`${baseUrl}/workspace`, {
      headers: { Authorization: 'Bearer token_a' },
    });
    assert.equal(getA.status, 200);
    const jsonA = (await getA.json()) as {
      workspace: {
        ownerId: string;
        settings: { a2uiEnabled: boolean };
        conversations: Array<{ id: string }>;
        savedStudyNotes: Array<{ id: string }>;
      };
    };
    assert.equal(jsonA.workspace.ownerId, 'user_alpha_1');
    assert.equal(jsonA.workspace.settings.a2uiEnabled, false);
    assert.equal(jsonA.workspace.conversations[0].id, 'conv_a1');
    assert.equal(jsonA.workspace.savedStudyNotes[0].id, 'note_a1');
  } finally {
    cleanup();
  }
});
