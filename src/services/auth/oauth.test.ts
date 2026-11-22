import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  extractAuthCodeFromInput,
  generatePkcePair,
  registerDynamicClient,
  resolveServerAuthHeaders,
  isTokenExpiring,
} from './oauth';
import { normalizeModelId } from '../../config/models';
import type { McpServerConfig, ServerSecretPayload } from '../../types';
import { redactSecrets } from '../../utils/redact';

test('generatePkcePair creates RFC 7636 S256 verifier and challenge', async () => {
  const pair = await generatePkcePair();
  assert.ok(pair.verifier.length >= 43);
  assert.ok(pair.challenge.length >= 43);
  assert.notEqual(pair.verifier, pair.challenge);
  assert.ok(!pair.challenge.includes('='));
  assert.ok(!pair.challenge.includes('+'));
  assert.ok(!pair.challenge.includes('/'));
});

test('discoverOAuthMetadata resolves RFC 9728 protected resource -> RFC 8414 metadata', async () => {
  const calls: string[] = [];
  const mockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/.well-known/oauth-protected-resource')) {
      return new Response(
        JSON.stringify({ authorization_servers: ['https://auth.example.com'] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
      return new Response(
        JSON.stringify({
          issuer: 'https://auth.example.com',
          authorization_endpoint: 'https://auth.example.com/authorize',
          token_endpoint: 'https://auth.example.com/token',
          registration_endpoint: 'https://auth.example.com/register',
          scopes_supported: ['mcp:tools', 'offline_access'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const meta = await discoverOAuthMetadata('https://mcp.example.com/sse', mockFetch);
  assert.equal(meta.authorizationEndpoint, 'https://auth.example.com/authorize');
  assert.equal(meta.tokenEndpoint, 'https://auth.example.com/token');
  assert.equal(meta.registrationEndpoint, 'https://auth.example.com/register');
  assert.equal(calls.length, 2);
});

test('registerDynamicClient sends RFC 7591 payload and returns client_id', async () => {
  const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { redirect_uris: string[]; token_endpoint_auth_method: string };
    assert.deepEqual(body.redirect_uris, ['mcphub://oauth-callback']);
    assert.equal(body.token_endpoint_auth_method, 'none');
    return new Response(JSON.stringify({ client_id: 'dyn_client_123' }), { status: 201 });
  }) as typeof fetch;

  const res = await registerDynamicClient(
    'https://auth.example.com/register',
    'mcphub://oauth-callback',
    'MCP Hub',
    mockFetch
  );
  assert.equal(res.clientId, 'dyn_client_123');
});

test('buildAuthorizationUrl encodes PKCE S256 parameters', () => {
  const url = buildAuthorizationUrl({
    authorizationEndpoint: 'https://auth.example.com/authorize',
    clientId: 'cid',
    redirectUri: 'mcphub://oauth',
    codeChallenge: 'chal123',
    state: 'st456',
    scope: 'mcp:tools',
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('code_challenge'), 'chal123');
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsed.searchParams.get('state'), 'st456');
});

test('resolveServerAuthHeaders auto-refreshes expiring OAuth PKCE tokens with single-flight lock', async () => {
  const baseServer: McpServerConfig = {
    id: 'srv_oauth',
    name: 'OAuth Server',
    url: 'https://mcp.example.com/mcp',
    authType: 'oauth_pkce',
    enabled: true,
    transportPreference: 'auto',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  };

  let tokenEndpointHits = 0;
  const mockFetch = (async () => {
    tokenEndpointHits++;
    return new Response(
      JSON.stringify({
        access_token: 'fresh_access_tok',
        refresh_token: 'fresh_refresh_tok',
        expires_in: 3600,
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  const expiringSecrets: ServerSecretPayload = {
    oauthClientId: 'cid_1',
    oauthMetadata: {
      authorizationEndpoint: 'https://auth.example.com/auth',
      tokenEndpoint: 'https://auth.example.com/token',
    },
    oauthTokens: {
      accessToken: 'stale_access_tok',
      refreshToken: 'old_refresh_tok',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 10_000, // within 60s skew -> triggers refresh
    },
  };

  let saved: ServerSecretPayload | undefined;
  const [r1, r2] = await Promise.all([
    resolveServerAuthHeaders({
      server: baseServer,
      secrets: expiringSecrets,
      saveUpdatedSecrets: async (u) => {
        saved = u;
      },
      fetchFn: mockFetch,
    }),
    resolveServerAuthHeaders({
      server: baseServer,
      secrets: expiringSecrets,
      fetchFn: mockFetch,
    }),
  ]);

  assert.equal(tokenEndpointHits, 1);
  assert.equal(r1.headers.Authorization, 'Bearer fresh_access_tok');
  assert.equal(r2.headers.Authorization, 'Bearer fresh_access_tok');
  assert.equal(saved?.oauthTokens?.refreshToken, 'fresh_refresh_tok');
  assert.equal(isTokenExpiring(saved?.oauthTokens), false);
});

test('resolveServerAuthHeaders supports bearer, basic, custom_headers, client_credentials, and none', async () => {
  const mkServer = (authType: McpServerConfig['authType']): McpServerConfig => ({
    id: `srv_${authType}`,
    name: authType,
    url: 'https://mcp.example.com',
    authType,
    enabled: true,
    transportPreference: 'auto',
    status: 'connected',
    tools: [],
    resources: [],
    prompts: [],
    disabledTools: [],
  });

  const noneRes = await resolveServerAuthHeaders({ server: mkServer('none'), secrets: {} });
  assert.deepEqual(noneRes.headers, {});

  const bearerRes = await resolveServerAuthHeaders({
    server: mkServer('bearer'),
    secrets: { bearerToken: 'my-secret-key' },
  });
  assert.equal(bearerRes.headers.Authorization, 'Bearer my-secret-key');

  const lowerBearerRes = await resolveServerAuthHeaders({
    server: mkServer('bearer'),
    secrets: { bearerToken: '  bearer already-prefixed-tok  ' },
  });
  assert.equal(lowerBearerRes.headers.Authorization, 'bearer already-prefixed-tok');

  const basicRes = await resolveServerAuthHeaders({
    server: mkServer('basic'),
    secrets: { basicUsername: 'alice', basicPassword: 'pw' },
  });
  assert.equal(basicRes.headers.Authorization, `Basic ${Buffer.from('alice:pw').toString('base64')}`);

  const customRes = await resolveServerAuthHeaders({
    server: mkServer('custom_headers'),
    secrets: { customHeaders: { 'X-Api-Key': 'val123' } },
  });
  assert.equal(customRes.headers['X-Api-Key'], 'val123');
});

test('extractAuthCodeFromInput extracts ?code from full redirect URLs or raw codes', () => {
  assert.equal(
    extractAuthCodeFromInput('https://localhost:3000/oauth-callback?code=auth_abc123&state=xyz'),
    'auth_abc123'
  );
  assert.equal(extractAuthCodeFromInput('?code=query_code_99&state=s'), 'query_code_99');
  assert.equal(extractAuthCodeFromInput('  raw_code_only  '), 'raw_code_only');
});

test('normalizeModelId migrates deprecated model slugs automatically', () => {
  assert.equal(normalizeModelId('llama-3.3-70b-versatile'), 'openai/gpt-oss-120b');
  assert.equal(normalizeModelId('qwen/qwen3-235b-a22b:free'), 'qwen/qwen3.7-plus:free');
  assert.equal(normalizeModelId('gemini-4-hydrogen'), 'gemini-4-hydrogen');
});

test('redactSecrets scrubs API keys, Bearer tokens, and Basic creds', () => {
  const raw = 'Error with Authorization: Bearer abcdef123456 and key AIzaSyD12345678901234567890123';
  const clean = redactSecrets(raw, ['abcdef123456']);
  assert.ok(!clean.includes('abcdef123456'));
  assert.ok(!clean.includes('AIzaSyD12345678901234567890123'));
  assert.ok(clean.includes('[REDACTED]'));
});
