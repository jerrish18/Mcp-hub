import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAuthRouter } from './authRouter';

async function startAuthTestServer() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-auth-test-'));
  const app = express();
  app.use('/api', createAuthRouter({
    storageFilePath: path.join(tempDir, 'app-users.json'),
    sessionSecret: 'test-session-secret-0123456789abcdef',
  }));

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    cleanup: () => {
      server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('authRouter registers, logs in, verifies Bearer token, and revokes on logout', async () => {
  const srv = await startAuthTestServer();
  try {
    // Missing X-MCPHub-UI header should be rejected
    const csrfRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada', email: 'ada@example.com', password: 'password123' }),
    });
    assert.equal(csrfRes.status, 403);

    // Register valid user
    const regRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ displayName: 'Ada Lovelace', email: 'Ada@Example.com', password: 'password123' }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as { token: string; user: { email: string; displayName: string } };
    assert.ok(regJson.token);
    assert.equal(regJson.user.email, 'ada@example.com');

    // Duplicate registration returns 409
    const dupRes = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ displayName: 'Ada', email: 'ada@example.com', password: 'password123' }),
    });
    assert.equal(dupRes.status, 409);

    // Wrong password returns 401
    const badLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ email: 'ada@example.com', password: 'wrongpassword' }),
    });
    assert.equal(badLogin.status, 401);

    // Valid login returns new session token
    const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ email: 'ada@example.com', password: 'password123' }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = (await loginRes.json()) as { token: string; user: { id: string; email: string } };
    assert.ok(loginJson.token);

    // /api/auth/me works with Bearer token
    const meRes = await fetch(`${srv.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginJson.token}` },
    });
    assert.equal(meRes.status, 200);

    // Logout revokes token
    const logoutRes = await fetch(`${srv.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'X-MCPHub-UI': '1', Authorization: `Bearer ${loginJson.token}` },
    });
    assert.equal(logoutRes.status, 200);

    const meAfterLogout = await fetch(`${srv.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${loginJson.token}` },
    });
    assert.equal(meAfterLogout.status, 401);
  } finally {
    srv.cleanup();
  }
});

test('authRouter enforces 8-char password, rotates refresh tokens, persists revocations, and requires secret in production', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-auth-hardening-'));
  const usersPath = path.join(tempDir, 'app-users.json');
  const secret = 'test-production-session-secret-0123456789';

  assert.throws(
    () =>
      createAuthRouter({
        storageFilePath: usersPath,
        sessionSecret: '',
        isProduction: true,
      }),
    /AUTH_SESSION_SECRET/
  );

  const startWithSameStore = async () => {
    const app = express();
    app.use('/api', createAuthRouter({ storageFilePath: usersPath, sessionSecret: secret }));
    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as { port: number };
    return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
  };

  const instance1 = await startWithSameStore();
  let accessToken: string;

  try {
    // Rejects < 8 char password
    const shortPwdRes = await fetch(`${instance1.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ displayName: 'Bob', email: 'bob@example.com', password: 'short77' }),
    });
    assert.equal(shortPwdRes.status, 400);

    // Registers with 8+ char password and receives refreshToken
    const regRes = await fetch(`${instance1.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ displayName: 'Bob Builder', email: 'bob@example.com', password: 'longpassword8' }),
    });
    assert.equal(regRes.status, 201);
    const regJson = (await regRes.json()) as { token: string; refreshToken: string };
    const refreshToken = regJson.refreshToken;
    assert.ok(regJson.token && refreshToken);

    // Refresh rotates tokens and revokes old refresh token
    const refreshRes = await fetch(`${instance1.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ refreshToken }),
    });
    assert.equal(refreshRes.status, 200);
    const rotated = (await refreshRes.json()) as { token: string; refreshToken: string };
    assert.notEqual(rotated.refreshToken, refreshToken);

    // Reusing old refresh token fails
    const replayRes = await fetch(`${instance1.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCPHub-UI': '1' },
      body: JSON.stringify({ refreshToken }),
    });
    assert.equal(replayRes.status, 401);

    // Logout revokes the rotated access token
    await fetch(`${instance1.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCPHub-UI': '1',
        Authorization: `Bearer ${rotated.token}`,
      },
      body: JSON.stringify({ refreshToken: rotated.refreshToken }),
    });
    accessToken = rotated.token;
  } finally {
    await new Promise<void>((resolve) => instance1.server.close(() => resolve()));
  }

  // Reboot router against the same disk files — revocation must persist across restarts
  const instance2 = await startWithSameStore();
  try {
    const meAfterReboot = await fetch(`${instance2.baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(meAfterReboot.status, 401);
  } finally {
    await new Promise<void>((resolve) => instance2.server.close(() => resolve()));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
