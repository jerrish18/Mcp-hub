import type { McpServerConfig, OAuthMetadata, OAuthTokenSet, ServerSecretPayload } from '../../types';
import { assertSecureServerUrl, redactSecrets } from '../../utils/redact';

export type FetchLike = typeof fetch;

const refreshInFlight = new Map<string, Promise<OAuthTokenSet>>();

function base64UrlEncode(bytes: Uint8Array): string {
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64');
  } else {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    b64 = btoa(bin);
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generatePkcePair(): Promise<{ verifier: string; challenge: string; state: string }> {
  const randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(randomBytes);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  const challenge = base64UrlEncode(new Uint8Array(digest));
  const state = base64UrlEncode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  return { verifier, challenge, state };
}

/**
 * Discovers OAuth 2.1 Authorization Server metadata via:
 * 1) RFC 9728 Protected Resource Metadata (/.well-known/oauth-protected-resource)
 * 2) RFC 8414 Authorization Server Metadata (/.well-known/oauth-authorization-server)
 * 3) OpenID Connect Discovery (/.well-known/openid-configuration)
 */
export async function discoverOAuthMetadata(
  serverUrl: string,
  fetchFn: FetchLike = fetch
): Promise<OAuthMetadata> {
  assertSecureServerUrl(serverUrl);
  const parsed = new URL(serverUrl);
  const origin = parsed.origin;

  let authServerOrigin = origin;

  // Step 1: RFC 9728 Protected Resource Metadata
  try {
    const prmUrl = `${origin}/.well-known/oauth-protected-resource${parsed.pathname === '/' ? '' : parsed.pathname}`;
    const prmRes = await fetchFn(prmUrl, { headers: { Accept: 'application/json' } });
    if (prmRes.ok) {
      const prm = (await prmRes.json()) as {
        authorization_servers?: string[];
        scopes_supported?: string[];
      };
      if (prm.authorization_servers && prm.authorization_servers.length > 0) {
        authServerOrigin = prm.authorization_servers[0].replace(/\/+$/, '');
      }
    }
  } catch {
    // Fall back to server origin for RFC 8414 discovery
  }

  assertSecureServerUrl(authServerOrigin);

  // Step 2: RFC 8414 Authorization Server Metadata + OIDC fallback
  const candidates = [
    `${authServerOrigin}/.well-known/oauth-authorization-server`,
    `${authServerOrigin}/.well-known/openid-configuration`,
  ];

  for (const metaUrl of candidates) {
    try {
      const res = await fetchFn(metaUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        issuer?: string;
        authorization_endpoint?: string;
        token_endpoint?: string;
        registration_endpoint?: string;
        scopes_supported?: string[];
      };
      if (json.authorization_endpoint && json.token_endpoint) {
        assertSecureServerUrl(json.authorization_endpoint);
        assertSecureServerUrl(json.token_endpoint);
        if (json.registration_endpoint) {
          assertSecureServerUrl(json.registration_endpoint);
        }
        return {
          issuer: json.issuer,
          authorizationEndpoint: json.authorization_endpoint,
          tokenEndpoint: json.token_endpoint,
          registrationEndpoint: json.registration_endpoint,
          scopesSupported: json.scopes_supported,
        };
      }
    } catch {
      // Try next discovery candidate
    }
  }

  throw new Error('Could not discover OAuth 2.1 endpoints via RFC 9728 or RFC 8414.');
}

/**
 * RFC 7591 OAuth 2.0 Dynamic Client Registration
 */
export async function registerDynamicClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName = 'MCP Hub Mobile',
  fetchFn: FetchLike = fetch
): Promise<{ clientId: string; clientSecret?: string }> {
  assertSecureServerUrl(registrationEndpoint);
  const res = await fetchFn(registrationEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dynamic client registration failed (${res.status}): ${redactSecrets(text)}`);
  }

  const data = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!data.client_id) {
    throw new Error('Dynamic client registration response missing client_id.');
  }
  return {
    clientId: data.client_id,
    clientSecret: data.client_secret,
  };
}

export function buildAuthorizationUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scope?: string;
  resource?: string;
}): string {
  assertSecureServerUrl(params.authorizationEndpoint);
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', params.state);
  if (params.scope) url.searchParams.set('scope', params.scope);
  if (params.resource) url.searchParams.set('resource', params.resource);
  return url.toString();
}

function normalizeTokenResponse(data: Record<string, unknown>, existingRefreshToken?: string): OAuthTokenSet {
  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    throw new Error('OAuth token response missing access_token.');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : existingRefreshToken,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
}

export async function exchangeAuthorizationCode(
  params: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  },
  fetchFn: FetchLike = fetch
): Promise<OAuthTokenSet> {
  assertSecureServerUrl(params.tokenEndpoint);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if (params.clientSecret) {
    body.set('client_secret', params.clientSecret);
  }

  const res = await fetchFn(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${redactSecrets(text)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return normalizeTokenResponse(json);
}

export async function refreshOAuthToken(
  params: {
    serverId: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  },
  fetchFn: FetchLike = fetch
): Promise<OAuthTokenSet> {
  const existing = refreshInFlight.get(params.serverId);
  if (existing) return existing;

  const task = (async () => {
    assertSecureServerUrl(params.tokenEndpoint);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: params.clientId,
    });
    if (params.clientSecret) {
      body.set('client_secret', params.clientSecret);
    }

    const res = await fetchFn(params.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OAuth token refresh failed (${res.status}): ${redactSecrets(text)}`);
    }

    const json = (await res.json()) as Record<string, unknown>;
    return normalizeTokenResponse(json, params.refreshToken);
  })().finally(() => {
    refreshInFlight.delete(params.serverId);
  });

  refreshInFlight.set(params.serverId, task);
  return task;
}

export async function fetchClientCredentialsToken(
  params: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    scope?: string;
  },
  fetchFn: FetchLike = fetch
): Promise<OAuthTokenSet> {
  assertSecureServerUrl(params.tokenEndpoint);
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  if (params.scope) {
    body.set('scope', params.scope);
  }

  const res = await fetchFn(params.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Client credentials token request failed (${res.status}): ${redactSecrets(text)}`);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return normalizeTokenResponse(json);
}

export function isTokenExpiring(tokens: OAuthTokenSet | undefined, nowMs = Date.now(), skewMs = 60_000): boolean {
  if (!tokens?.accessToken) return true;
  if (!tokens.expiresAt) return false;
  return tokens.expiresAt - skewMs <= nowMs;
}

function encodeBasicCredentials(username: string, password: string): string {
  const raw = `${username}:${password}`;
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(raw, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export async function resolveServerAuthHeaders(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  forceRefresh?: boolean;
  nowMs?: number;
  fetchFn?: FetchLike;
}): Promise<{ headers: Record<string, string>; updatedSecrets?: ServerSecretPayload }> {
  const { server, secrets, saveUpdatedSecrets, forceRefresh = false, nowMs = Date.now(), fetchFn = fetch } = params;

  switch (server.authType) {
    case 'none':
      return { headers: {} };

    case 'bearer': {
      if (!secrets.bearerToken) {
        throw new Error(`Server "${server.name}" requires an API key / Bearer token.`);
      }
      return {
        headers: {
          Authorization: secrets.bearerToken.startsWith('Bearer ')
            ? secrets.bearerToken
            : `Bearer ${secrets.bearerToken}`,
        },
      };
    }

    case 'custom_headers': {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(secrets.customHeaders ?? {})) {
        if (k.trim()) headers[k.trim()] = v;
      }
      return { headers };
    }

    case 'basic': {
      const user = secrets.basicUsername ?? '';
      const pass = secrets.basicPassword ?? '';
      if (!user && !pass) {
        throw new Error(`Server "${server.name}" requires Basic auth credentials.`);
      }
      return {
        headers: {
          Authorization: `Basic ${encodeBasicCredentials(user, pass)}`,
        },
      };
    }

    case 'oauth_pkce': {
      const tokens = secrets.oauthTokens;
      if (!tokens?.accessToken) {
        throw new Error(`Server "${server.name}" is not authorized. Please sign in with OAuth.`);
      }
      if (forceRefresh || isTokenExpiring(tokens, nowMs)) {
        if (!tokens.refreshToken || !secrets.oauthMetadata?.tokenEndpoint || !secrets.oauthClientId) {
          throw new Error(`OAuth token expired for "${server.name}" and no refresh token is available.`);
        }
        const refreshed = await refreshOAuthToken(
          {
            serverId: server.id,
            tokenEndpoint: secrets.oauthMetadata.tokenEndpoint,
            clientId: secrets.oauthClientId,
            clientSecret: secrets.oauthClientSecret,
            refreshToken: tokens.refreshToken,
          },
          fetchFn
        );
        const nextSecrets: ServerSecretPayload = {
          ...secrets,
          oauthTokens: refreshed,
        };
        if (saveUpdatedSecrets) {
          await saveUpdatedSecrets(nextSecrets);
        }
        return {
          headers: { Authorization: `Bearer ${refreshed.accessToken}` },
          updatedSecrets: nextSecrets,
        };
      }
      return {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      };
    }

    case 'oauth_client_credentials': {
      const tokens = secrets.oauthTokens;
      if (forceRefresh || !tokens?.accessToken || isTokenExpiring(tokens, nowMs)) {
        if (!secrets.oauthMetadata?.tokenEndpoint || !secrets.oauthClientId || !secrets.oauthClientSecret) {
          throw new Error(`Client credentials configuration incomplete for "${server.name}".`);
        }
        const minted = await fetchClientCredentialsToken(
          {
            tokenEndpoint: secrets.oauthMetadata.tokenEndpoint,
            clientId: secrets.oauthClientId,
            clientSecret: secrets.oauthClientSecret,
            scope: secrets.oauthScopes,
          },
          fetchFn
        );
        const nextSecrets: ServerSecretPayload = {
          ...secrets,
          oauthTokens: minted,
        };
        if (saveUpdatedSecrets) {
          await saveUpdatedSecrets(nextSecrets);
        }
        return {
          headers: { Authorization: `Bearer ${minted.accessToken}` },
          updatedSecrets: nextSecrets,
        };
      }
      return {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      };
    }
  }
}
