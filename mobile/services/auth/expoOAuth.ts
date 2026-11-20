import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  exchangeAuthorizationCode,
  generatePkcePair,
  registerDynamicClient,
} from '@core/services/auth/oauth';
import type { OAuthMetadata, OAuthTokenSet } from '@core/types';

WebBrowser.maybeCompleteAuthSession();

export async function runExpoOAuthPkceFlow(params: {
  serverUrl: string;
  existingClientId?: string;
  existingClientSecret?: string;
  scopes?: string;
}): Promise<{
  tokens: OAuthTokenSet;
  metadata: OAuthMetadata;
  clientId: string;
  clientSecret?: string;
}> {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'mcphub',
    path: 'oauth-callback',
  });

  const metadata = await discoverOAuthMetadata(params.serverUrl);

  let clientId = params.existingClientId;
  let clientSecret = params.existingClientSecret;

  if (!clientId && metadata.registrationEndpoint) {
    const registered = await registerDynamicClient(
      metadata.registrationEndpoint,
      redirectUri,
      'MCP Hub Mobile'
    );
    clientId = registered.clientId;
    clientSecret = registered.clientSecret;
  }

  if (!clientId) {
    throw new Error('OAuth client_id is required and server does not support Dynamic Client Registration.');
  }

  const pkce = await generatePkcePair();
  const authUrl = buildAuthorizationUrl({
    authorizationEndpoint: metadata.authorizationEndpoint,
    clientId,
    redirectUri,
    codeChallenge: pkce.challenge,
    state: pkce.state,
    scope: params.scopes ?? metadata.scopesSupported?.join(' ') ?? 'mcp:tools',
    resource: params.serverUrl,
  });

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
  if (result.type !== 'success' || !result.url) {
    throw new Error('OAuth sign-in was cancelled.');
  }

  const returned = new URL(result.url);
  const code = returned.searchParams.get('code');
  const returnedState = returned.searchParams.get('state');
  if (!code || returnedState !== pkce.state) {
    throw new Error('Invalid OAuth callback state or missing authorization code.');
  }

  const tokens = await exchangeAuthorizationCode({
    tokenEndpoint: metadata.tokenEndpoint,
    clientId,
    clientSecret,
    code,
    redirectUri,
    codeVerifier: pkce.verifier,
  });

  return { tokens, metadata, clientId, clientSecret };
}
