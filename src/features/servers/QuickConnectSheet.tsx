import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  KeyRound,
  Palette,
  PlaySquare,
  ShieldCheck,
} from 'lucide-react';
import { CONNECTOR_PRESETS } from '../../config/connectors';
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  exchangeAuthorizationCode,
  extractAuthCodeFromInput,
  generatePkcePair,
  registerDynamicClient,
} from '../../services/auth/oauth';
import { loadServerSecrets } from '../../services/storage/secureStorage';
import { useHubStore } from '../../store/useHubStore';
import type { McpServerConfig, ServerSecretPayload } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { triggerHaptic } from '../../utils/haptics';
import { safeErrorMessage } from '../../utils/redact';

interface QuickConnectSheetProps {
  presetId: 'youtube' | 'github' | 'canva' | null;
  server?: McpServerConfig;
  onClose: () => void;
  onConnected?: () => void;
}

function PresetGlyph({ presetId }: { presetId: 'youtube' | 'github' | 'canva' }) {
  if (presetId === 'youtube') return <PlaySquare className="w-5 h-5" />;
  if (presetId === 'github') return <GitBranch className="w-5 h-5" />;
  return <Palette className="w-5 h-5" />;
}

export function QuickConnectSheet({ presetId, server, onClose, onConnected }: QuickConnectSheetProps) {
  const { settings, quickConnectServer } = useHubStore();
  const preset = presetId ? CONNECTOR_PRESETS[presetId] : null;

  const [authMode, setAuthMode] = useState<'bearer' | 'oauth_pkce'>('bearer');
  const [endpointMode, setEndpointMode] = useState<'direct' | 'remote'>('direct');
  const [customUrl, setCustomUrl] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  // OAuth PKCE state
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthScopes, setOauthScopes] = useState('');
  const [oauthAuthEp, setOauthAuthEp] = useState('');
  const [oauthTokenEp, setOauthTokenEp] = useState('');
  const [pendingPkce, setPendingPkce] = useState<{ verifier: string; authUrl: string } | null>(null);
  const [authCodeInput, setAuthCodeInput] = useState('');
  const [oauthAccessToken, setOauthAccessToken] = useState('');
  const [oauthRefreshToken, setOauthRefreshToken] = useState('');

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!preset) return;
    setErrorMsg('');
    setSuccessMsg('');
    setPendingPkce(null);
    setAuthCodeInput('');

    const currentAuth =
      server?.authType === 'oauth_pkce' || server?.authType === 'bearer'
        ? server.authType
        : preset.defaultAuthType === 'oauth_pkce'
          ? 'oauth_pkce'
          : 'bearer';
    setAuthMode(currentAuth);

    const activeUrl = server?.url || preset.defaultUrl;
    if (preset.alternateRemoteUrl && activeUrl === preset.alternateRemoteUrl) {
      setEndpointMode('remote');
      setCustomUrl(activeUrl);
    } else if (activeUrl !== preset.defaultUrl) {
      setEndpointMode('remote');
      setCustomUrl(activeUrl);
    } else {
      setEndpointMode('direct');
      setCustomUrl(preset.alternateRemoteUrl ?? preset.defaultUrl);
    }

    setOauthScopes(preset.defaultScopes ?? 'mcp:tools');
    setOauthAuthEp('');
    setOauthTokenEp('');
    setOauthClientId('');
    setOauthAccessToken('');
    setOauthRefreshToken('');
    setTokenInput('');

    const targetId = server?.id ?? preset.serverId;
    void loadServerSecrets(targetId).then((sec) => {
      if (sec.bearerToken) setTokenInput(sec.bearerToken);
      if (sec.oauthClientId) setOauthClientId(sec.oauthClientId);
      if (sec.oauthScopes) setOauthScopes(sec.oauthScopes);
      if (sec.oauthMetadata?.authorizationEndpoint) setOauthAuthEp(sec.oauthMetadata.authorizationEndpoint);
      if (sec.oauthMetadata?.tokenEndpoint) setOauthTokenEp(sec.oauthMetadata.tokenEndpoint);
      if (sec.oauthTokens?.accessToken) setOauthAccessToken(sec.oauthTokens.accessToken);
      if (sec.oauthTokens?.refreshToken) setOauthRefreshToken(sec.oauthTokens.refreshToken);
    });
  }, [preset, server]);

  if (!preset) return null;

  const targetServerId = server?.id ?? preset.serverId;
  const resolvedUrl =
    endpointMode === 'direct'
      ? preset.defaultUrl
      : customUrl.trim() || preset.alternateRemoteUrl || preset.defaultUrl;

  const handleDiscoverAndStartOAuth = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      const discoveryTarget = resolvedUrl.startsWith('virtual://')
        ? preset.alternateRemoteUrl || 'https://github.com'
        : resolvedUrl;
      const meta = await discoverOAuthMetadata(discoveryTarget);
      setOauthAuthEp(meta.authorizationEndpoint);
      setOauthTokenEp(meta.tokenEndpoint);

      const redirectUri = `${window.location.origin}/oauth-callback`;
      let clientId = oauthClientId.trim();
      if (meta.registrationEndpoint && !clientId) {
        const reg = await registerDynamicClient(meta.registrationEndpoint, redirectUri, 'MCP Hub');
        clientId = reg.clientId;
        setOauthClientId(clientId);
      }
      if (!clientId) {
        throw new Error(
          'This provider requires a Client ID for OAuth PKCE, or switch to Paste Token for instant setup.'
        );
      }
      const pkce = await generatePkcePair();
      const authUrl = buildAuthorizationUrl({
        authorizationEndpoint: meta.authorizationEndpoint,
        clientId,
        redirectUri,
        codeChallenge: pkce.challenge,
        state: pkce.state,
        scope: oauthScopes.trim() || meta.scopesSupported?.join(' '),
      });
      setPendingPkce({ verifier: pkce.verifier, authUrl });
    } catch (err) {
      setErrorMsg(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExchangeCode = async () => {
    const code = extractAuthCodeFromInput(authCodeInput);
    if (!pendingPkce || !code) return;
    setBusy(true);
    setErrorMsg('');
    try {
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: oauthTokenEp,
        clientId: oauthClientId.trim(),
        code,
        redirectUri: `${window.location.origin}/oauth-callback`,
        codeVerifier: pendingPkce.verifier,
      });
      setOauthAccessToken(tokens.accessToken);
      setOauthRefreshToken(tokens.refreshToken ?? '');
      setPendingPkce(null);
      setAuthCodeInput('');
    } catch (err) {
      setErrorMsg(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const secretsPayload: ServerSecretPayload =
        authMode === 'bearer'
          ? { bearerToken: tokenInput.trim() }
          : {
              oauthClientId: oauthClientId.trim() || undefined,
              oauthScopes: oauthScopes.trim() || undefined,
              oauthMetadata:
                oauthAuthEp && oauthTokenEp
                  ? {
                      authorizationEndpoint: oauthAuthEp.trim(),
                      tokenEndpoint: oauthTokenEp.trim(),
                    }
                  : undefined,
              oauthTokens: oauthAccessToken.trim()
                ? {
                    accessToken: oauthAccessToken.trim(),
                    refreshToken: oauthRefreshToken.trim() || undefined,
                    tokenType: 'Bearer',
                  }
                : undefined,
            };

      const res = await quickConnectServer(
        targetServerId,
        {
          url: resolvedUrl,
          authType: authMode,
          enabled: true,
        },
        secretsPayload
      );

      if (!res.ok) {
        triggerHaptic(settings.hapticsEnabled, 'warning');
        setErrorMsg(res.error ?? 'Connection check failed.');
      } else {
        triggerHaptic(settings.hapticsEnabled, 'success');
        setSuccessMsg(`${preset.name} connected and ready for agents.`);
        onConnected?.();
        setTimeout(() => onClose(), 550);
      }
    } catch (err) {
      setErrorMsg(safeErrorMessage(err, [tokenInput, oauthAccessToken]));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={Boolean(presetId)}
      onClose={onClose}
      title={`Connect ${preset.name}`}
      subtitle={preset.tagline}
    >
      <form onSubmit={handleConnect} className="space-y-4">
        <div
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border p-3.5 flex items-start gap-3"
        >
          <span
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          >
            <PresetGlyph presetId={preset.presetId} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {preset.setupSummary}
            </p>
            <a
              href={preset.keyUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--m3-primary)' }}
              className="inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            >
              <span>{preset.keyUrlLabel}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Auth Method Selector when multiple modes are supported */}
        {preset.supportedAuthModes.length > 1 && (
          <div
            style={{ backgroundColor: 'var(--m3-surface)' }}
            className="grid grid-cols-2 gap-1 p-1 rounded-full border border-slate-200 dark:border-slate-800"
          >
            {preset.supportedAuthModes.map((mode) => {
              const active = authMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAuthMode(mode)}
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                        }
                      : undefined
                  }
                  className={`min-h-[44px] rounded-full text-xs font-semibold transition-colors ${
                    active ? 'shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {mode === 'bearer' ? 'Paste Key / Token' : 'OAuth 2.1 + PKCE'}
                </button>
              );
            })}
          </div>
        )}

        {/* GitHub / YouTube endpoint choice */}
        {preset.presetId === 'github' && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Connection Mode
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEndpointMode('direct')}
                style={
                  endpointMode === 'direct'
                    ? {
                        backgroundColor: 'var(--m3-primary-container)',
                        borderColor: 'var(--m3-primary)',
                        color: 'var(--m3-on-primary-container)',
                      }
                    : {
                        backgroundColor: 'var(--m3-surface)',
                        borderColor: 'var(--m3-outline)',
                      }
                }
                className="min-h-[44px] px-3 rounded-xl border text-left text-xs font-medium"
              >
                <div className="font-semibold">Direct GitHub REST</div>
                <div className="opacity-75 text-[11px]">Works in all browsers</div>
              </button>
              <button
                type="button"
                onClick={() => setEndpointMode('remote')}
                style={
                  endpointMode === 'remote'
                    ? {
                        backgroundColor: 'var(--m3-primary-container)',
                        borderColor: 'var(--m3-primary)',
                        color: 'var(--m3-on-primary-container)',
                      }
                    : {
                        backgroundColor: 'var(--m3-surface)',
                        borderColor: 'var(--m3-outline)',
                      }
                }
                className="min-h-[44px] px-3 rounded-xl border text-left text-xs font-medium"
              >
                <div className="font-semibold">GitHub Remote MCP</div>
                <div className="opacity-75 text-[11px]">api.githubcopilot.com</div>
              </button>
            </div>
          </div>
        )}

        {endpointMode === 'remote' && (
          <div>
            <label htmlFor="qc-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Remote MCP Endpoint URL
            </label>
            <input
              id="qc-url"
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://..."
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[44px] px-3.5 rounded-2xl border text-xs font-mono text-slate-900 dark:text-white"
            />
          </div>
        )}

        {authMode === 'bearer' ? (
          <div>
            <label htmlFor="qc-token" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {preset.keyLabel}
            </label>
            <input
              id="qc-token"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={preset.keyPlaceholder}
              required
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[46px] px-3.5 rounded-2xl border text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>
        ) : (
          <div
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-2xl border p-3.5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                OAuth 2.1 + PKCE
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDiscoverAndStartOAuth()}
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="min-h-[44px] px-3.5 rounded-full text-xs font-semibold"
              >
                {busy ? 'Discovering...' : 'Discover & Start Sign-In'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={oauthClientId}
                onChange={(e) => setOauthClientId(e.target.value)}
                placeholder="Client ID (auto-filled via DCR if supported)"
                aria-label="OAuth Client ID"
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-white"
              />
              <input
                type="text"
                value={oauthScopes}
                onChange={(e) => setOauthScopes(e.target.value)}
                placeholder="Scopes"
                aria-label="OAuth Scopes"
                className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-white"
              />
            </div>

            {pendingPkce && (
              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800 text-xs">
                <a
                  href={pendingPkce.authUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--m3-primary)' }}
                  className="inline-flex items-center gap-1 font-semibold underline"
                >
                  <span>1. Open {preset.name} Authorization Page</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={authCodeInput}
                    onChange={(e) => setAuthCodeInput(e.target.value)}
                    placeholder="2. Paste redirect URL or auth code"
                    aria-label="OAuth authorization code or redirect URL"
                    className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => void handleExchangeCode()}
                    style={{
                      backgroundColor: 'var(--m3-primary)',
                      color: 'var(--m3-on-primary)',
                    }}
                    className="min-h-[44px] px-3.5 rounded-xl font-semibold"
                  >
                    Exchange
                  </button>
                </div>
              </div>
            )}

            {oauthAccessToken && (
              <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                <span>OAuth access token encrypted in local vault</span>
              </div>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="[overflow-wrap:anywhere]">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || (authMode === 'bearer' ? !tokenInput.trim() : !oauthAccessToken.trim())}
          style={{
            backgroundColor: 'var(--m3-primary)',
            color: 'var(--m3-on-primary)',
          }}
          className="w-full min-h-[48px] rounded-full text-sm font-semibold disabled:opacity-45 transition-opacity hover:opacity-90"
        >
          {busy ? 'Testing Connection...' : `Save & Connect ${preset.name}`}
        </button>
      </form>
    </BottomSheet>
  );
}
