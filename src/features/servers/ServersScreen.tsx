import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  exchangeAuthorizationCode,
  generatePkcePair,
  registerDynamicClient,
} from '../../services/auth/oauth';
import { loadServerSecrets } from '../../services/storage/secureStorage';
import { useHubStore } from '../../store/useHubStore';
import {
  type AuthType,
  type McpServerConfig,
  McpServerConfigSchema,
  type ServerSecretPayload,
} from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { M3Switch } from '../../ui/M3Switch';
import { SkeletonCard } from '../../ui/Skeleton';
import { triggerHaptic } from '../../utils/haptics';
import { safeErrorMessage } from '../../utils/redact';

const AUTH_LABELS: Record<AuthType, string> = {
  oauth_pkce: 'OAuth 2.1 + PKCE',
  bearer: 'API Key / Bearer Token',
  custom_headers: 'Custom Headers',
  basic: 'Basic Auth',
  oauth_client_credentials: 'OAuth Client Credentials',
  none: 'No Auth',
};

function ServerStatusLabel({ status }: { status: McpServerConfig['status'] }) {
  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Connected
        </span>
      );
    case 'auth_expired':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <ShieldAlert className="w-3.5 h-3.5" />
          Auth Expired
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-400">
          <AlertCircle className="w-3.5 h-3.5" />
          Error
        </span>
      );
    case 'connecting':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Connecting
        </span>
      );
    default:
      return <span className="text-xs text-slate-500 dark:text-slate-400">Disconnected</span>;
  }
}

export function ServersScreen() {
  const { servers, settings, addOrUpdateServer, deleteServer, connectServer, toggleServerTool } =
    useHubStore();

  const [expandedId, setExpandedId] = useState<string | null>(servers[0]?.id ?? null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [authType, setAuthType] = useState<AuthType>('bearer');
  const [transport, setTransport] = useState<'auto' | 'streamable_http' | 'sse'>('auto');
  const [bearerToken, setBearerToken] = useState('');
  const [basicUser, setBasicUser] = useState('');
  const [basicPass, setBasicPass] = useState('');
  const [headerRows, setHeaderRows] = useState<Array<{ key: string; value: string }>>([
    { key: 'X-API-Key', value: '' },
  ]);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthScopes, setOauthScopes] = useState('mcp:tools');
  const [oauthAuthEp, setOauthAuthEp] = useState('');
  const [oauthTokenEp, setOauthTokenEp] = useState('');
  const [oauthRegEp, setOauthRegEp] = useState('');
  const [oauthAccessToken, setOauthAccessToken] = useState('');
  const [oauthRefreshToken, setOauthRefreshToken] = useState('');
  const [authCodeInput, setAuthCodeInput] = useState('');
  const [pendingPkce, setPendingPkce] = useState<{ verifier: string; authUrl: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [oauthBusy, setOauthBusy] = useState(false);

  const openNewEditor = () => {
    setEditingServerId(null);
    setName('');
    setUrl('https://');
    setAuthType('bearer');
    setTransport('auto');
    setBearerToken('');
    setBasicUser('');
    setBasicPass('');
    setHeaderRows([{ key: 'X-API-Key', value: '' }]);
    setOauthClientId('');
    setOauthClientSecret('');
    setOauthScopes('mcp:tools');
    setOauthAuthEp('');
    setOauthTokenEp('');
    setOauthRegEp('');
    setOauthAccessToken('');
    setOauthRefreshToken('');
    setPendingPkce(null);
    setAuthCodeInput('');
    setFormError('');
    setEditorOpen(true);
  };

  const openEditEditor = async (srv: McpServerConfig) => {
    const secrets = await loadServerSecrets(srv.id);
    setEditingServerId(srv.id);
    setName(srv.name);
    setUrl(srv.url);
    setAuthType(srv.authType);
    setTransport(srv.transportPreference);
    setBearerToken(secrets.bearerToken ?? '');
    setBasicUser(secrets.basicUsername ?? '');
    setBasicPass(secrets.basicPassword ?? '');
    const customPairs = Object.entries(secrets.customHeaders ?? {}).map(([key, value]) => ({
      key,
      value,
    }));
    setHeaderRows(customPairs.length > 0 ? customPairs : [{ key: 'X-API-Key', value: '' }]);
    setOauthClientId(secrets.oauthClientId ?? '');
    setOauthClientSecret(secrets.oauthClientSecret ?? '');
    setOauthScopes(secrets.oauthScopes ?? 'mcp:tools');
    setOauthAuthEp(secrets.oauthMetadata?.authorizationEndpoint ?? '');
    setOauthTokenEp(secrets.oauthMetadata?.tokenEndpoint ?? '');
    setOauthRegEp(secrets.oauthMetadata?.registrationEndpoint ?? '');
    setOauthAccessToken(secrets.oauthTokens?.accessToken ?? '');
    setOauthRefreshToken(secrets.oauthTokens?.refreshToken ?? '');
    setPendingPkce(null);
    setAuthCodeInput('');
    setFormError('');
    setEditorOpen(true);
  };

  const handleDiscoverOAuth = async () => {
    setFormError('');
    setOauthBusy(true);
    try {
      const meta = await discoverOAuthMetadata(url);
      setOauthAuthEp(meta.authorizationEndpoint);
      setOauthTokenEp(meta.tokenEndpoint);
      setOauthRegEp(meta.registrationEndpoint ?? '');
      if (meta.scopesSupported && meta.scopesSupported.length > 0) {
        setOauthScopes(meta.scopesSupported.join(' '));
      }
      if (meta.registrationEndpoint && !oauthClientId) {
        const redirectUri = `${window.location.origin}/oauth-callback`;
        const reg = await registerDynamicClient(meta.registrationEndpoint, redirectUri, 'MCP Hub');
        setOauthClientId(reg.clientId);
        if (reg.clientSecret) setOauthClientSecret(reg.clientSecret);
      }
    } catch (err) {
      setFormError(safeErrorMessage(err));
    } finally {
      setOauthBusy(false);
    }
  };

  const handleStartPkceFlow = async () => {
    setFormError('');
    try {
      if (!oauthAuthEp || !oauthClientId) {
        throw new Error('Run OAuth Discovery or enter Authorization Endpoint & Client ID first.');
      }
      const pkce = await generatePkcePair();
      const redirectUri = `${window.location.origin}/oauth-callback`;
      const authUrl = buildAuthorizationUrl({
        authorizationEndpoint: oauthAuthEp,
        clientId: oauthClientId,
        redirectUri,
        codeChallenge: pkce.challenge,
        state: pkce.state,
        scope: oauthScopes,
      });
      setPendingPkce({ verifier: pkce.verifier, authUrl });
    } catch (err) {
      setFormError(safeErrorMessage(err));
    }
  };

  const handleExchangePkceCode = async () => {
    if (!pendingPkce || !authCodeInput.trim()) return;
    setOauthBusy(true);
    setFormError('');
    try {
      const tokens = await exchangeAuthorizationCode({
        tokenEndpoint: oauthTokenEp,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret || undefined,
        code: authCodeInput.trim(),
        redirectUri: `${window.location.origin}/oauth-callback`,
        codeVerifier: pendingPkce.verifier,
      });
      setOauthAccessToken(tokens.accessToken);
      setOauthRefreshToken(tokens.refreshToken ?? '');
      setPendingPkce(null);
      setAuthCodeInput('');
    } catch (err) {
      setFormError(safeErrorMessage(err));
    } finally {
      setOauthBusy(false);
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const existing = editingServerId ? servers.find((s) => s.id === editingServerId) : undefined;
    const id = existing?.id ?? `srv_${Date.now()}`;

    const candidate: McpServerConfig = {
      id,
      name: name.trim(),
      url: url.trim(),
      authType,
      enabled: existing?.enabled ?? true,
      transportPreference: transport,
      status: existing?.status ?? 'disconnected',
      tools: existing?.tools ?? [],
      resources: existing?.resources ?? [],
      prompts: existing?.prompts ?? [],
      disabledTools: existing?.disabledTools ?? [],
    };

    const parsed = McpServerConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid server configuration.');
      return;
    }

    const customHeaders: Record<string, string> = {};
    for (const row of headerRows) {
      if (row.key.trim()) customHeaders[row.key.trim()] = row.value;
    }

    const secrets: ServerSecretPayload = {
      bearerToken: bearerToken.trim() || undefined,
      basicUsername: basicUser.trim() || undefined,
      basicPassword: basicPass || undefined,
      customHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
      oauthClientId: oauthClientId.trim() || undefined,
      oauthClientSecret: oauthClientSecret.trim() || undefined,
      oauthScopes: oauthScopes.trim() || undefined,
      oauthMetadata:
        oauthAuthEp || oauthTokenEp
          ? {
              authorizationEndpoint: oauthAuthEp.trim(),
              tokenEndpoint: oauthTokenEp.trim(),
              registrationEndpoint: oauthRegEp.trim() || undefined,
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

    await addOrUpdateServer(parsed.data, secrets);
    triggerHaptic(settings.hapticsEnabled, 'success');
    setEditorOpen(false);
    setExpandedId(parsed.data.id);
    await connectServer(parsed.data.id);
  };

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="h-full overflow-y-auto p-4 sm:p-6"
    >
      <div className="max-w-4xl mx-auto space-y-5 pb-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              MCP Servers
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Remote Streamable HTTP & SSE servers · {servers.filter((s) => s.status === 'connected').length} connected
            </p>
          </div>
          <button
            type="button"
            onClick={openNewEditor}
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            <span>Add Server</span>
          </button>
        </div>

        {servers.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-[24px] border p-8 text-center space-y-3"
          >
            <Server className="w-8 h-8 text-slate-400 mx-auto" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              No MCP servers configured
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Connect any remote HTTPS MCP server using OAuth 2.1 PKCE, Bearer token, Basic auth, or custom headers.
            </p>
            <button
              type="button"
              onClick={openNewEditor}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-5 py-2 rounded-full text-sm font-semibold"
            >
              Add your first MCP server
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((srv) => {
              const isExpanded = expandedId === srv.id;
              const enabledToolCount = srv.tools.length - srv.disabledTools.length;

              return (
                <div
                  key={srv.id}
                  data-testid="server-card"
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-[24px] border overflow-hidden"
                >
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : srv.id)}
                      aria-expanded={expandedId === srv.id}
                      className="flex items-center gap-3 min-w-0 w-full sm:flex-1 text-left min-h-[44px]"
                    >
                      <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200">
                        <Server className="w-5 h-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display text-base font-semibold text-slate-900 dark:text-white truncate">
                            {srv.name}
                          </span>
                          <ServerStatusLabel status={srv.status} />
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          <span className="font-mono">{srv.url}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{AUTH_LABELS[srv.authType]}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="tabular-nums">
                            {enabledToolCount}/{srv.tools.length} tools
                          </span>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
                      )}
                    </button>

                    <div className="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t border-slate-100 dark:border-slate-800 sm:border-t-0">
                      <button
                        type="button"
                        onClick={() => void connectServer(srv.id)}
                        aria-label={`Test connection for ${srv.name}`}
                        className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${srv.status === 'connecting' ? 'animate-spin' : ''}`}
                        />
                        <span>Test</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void openEditEditor(srv)}
                        aria-label={`Edit ${srv.name}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteServer(srv.id)}
                        aria-label={`Delete ${srv.name}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {srv.lastError && (
                    <div className="mx-4 mb-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                      {srv.lastError}
                    </div>
                  )}

                  {srv.status === 'connecting' && (
                    <div className="p-4 pt-0">
                      <SkeletonCard rows={2} />
                    </div>
                  )}

                  {isExpanded && srv.status !== 'connecting' && (
                    <div
                      style={{ backgroundColor: 'var(--m3-surface)' }}
                      className="border-t border-slate-200/70 dark:border-slate-800 p-4 space-y-4"
                    >
                      <div>
                        <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                          Tools ({srv.tools.length})
                        </h3>
                        {srv.tools.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            No tools discovered yet. Tap Test to connect and inspect tools.
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {srv.tools.map((tool) => {
                              const enabled = !srv.disabledTools.includes(tool.name);
                              const readOnly = tool.annotations?.readOnlyHint === true;
                              return (
                                <div
                                  key={tool.name}
                                  style={{
                                    backgroundColor: 'var(--m3-surface-container)',
                                    borderColor: 'var(--m3-outline)',
                                  }}
                                  className="min-h-[52px] px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-3"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium font-mono text-slate-900 dark:text-slate-100 truncate">
                                      {tool.name}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                      {readOnly ? 'Read-only' : 'Write action'}
                                      {tool.description ? ` · ${tool.description}` : ''}
                                    </div>
                                  </div>
                                  <M3Switch
                                    checked={enabled}
                                    ariaLabel={`Toggle tool ${tool.name}`}
                                    onChange={() => {
                                      triggerHaptic(settings.hapticsEnabled, 'light');
                                      toggleServerTool(srv.id, tool.name);
                                    }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {srv.resources.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                            Resources ({srv.resources.length})
                          </h3>
                          <div className="space-y-1">
                            {srv.resources.map((r) => (
                              <div key={r.uri} className="text-xs text-slate-600 dark:text-slate-300 font-mono">
                                {r.name} · {r.uri}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {srv.prompts.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                            Prompts ({srv.prompts.length})
                          </h3>
                          <div className="space-y-1">
                            {srv.prompts.map((p) => (
                              <div key={p.name} className="text-xs text-slate-600 dark:text-slate-300">
                                <span className="font-mono font-medium">{p.name}</span>
                                {p.description ? ` · ${p.description}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <BottomSheet
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingServerId ? 'Edit MCP Server' : 'Add MCP Server'}
        subtitle="Credentials are encrypted locally; only HTTPS remote URLs are allowed"
      >
        <form onSubmit={handleSaveServer} className="space-y-4">
          {formError && (
            <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {formError}
            </div>
          )}

          <div>
            <label htmlFor="srv-name" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Server Name
            </label>
            <input
              id="srv-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GitHub MCP"
              required
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label htmlFor="srv-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Server Endpoint URL
            </label>
            <input
              id="srv-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp"
              required
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="srv-auth" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Authentication
              </label>
              <select
                id="srv-auth"
                value={authType}
                onChange={(e) => setAuthType(e.target.value as AuthType)}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              >
                {Object.entries(AUTH_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="srv-transport" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Transport
              </label>
              <select
                id="srv-transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value as 'auto' | 'streamable_http' | 'sse')}
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              >
                <option value="auto">Streamable HTTP (SSE fallback)</option>
                <option value="streamable_http">Streamable HTTP only</option>
                <option value="sse">Legacy SSE only</option>
              </select>
            </div>
          </div>

          {authType === 'bearer' && (
            <div>
              <label htmlFor="srv-bearer" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                API Key / Bearer Token
              </label>
              <input
                id="srv-bearer"
                type="password"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                placeholder="Paste static bearer token"
                className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm font-mono text-slate-900 dark:text-white"
              />
            </div>
          )}

          {authType === 'basic' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="srv-buser" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Username
                </label>
                <input
                  id="srv-buser"
                  type="text"
                  value={basicUser}
                  onChange={(e) => setBasicUser(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="srv-bpass" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Password
                </label>
                <input
                  id="srv-bpass"
                  type="password"
                  value={basicPass}
                  onChange={(e) => setBasicPass(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {authType === 'custom_headers' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Custom Request Headers
                </span>
                <button
                  type="button"
                  onClick={() => setHeaderRows((r) => [...r, { key: '', value: '' }])}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400"
                >
                  + Add header
                </button>
              </div>
              {headerRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Header name"
                    value={row.key}
                    onChange={(e) =>
                      setHeaderRows((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item))
                      )
                    }
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
                  />
                  <input
                    type="password"
                    placeholder="Header value"
                    value={row.value}
                    onChange={(e) =>
                      setHeaderRows((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, value: e.target.value } : item))
                      )
                    }
                    className="min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono text-slate-900 dark:text-white"
                  />
                </div>
              ))}
            </div>
          )}

          {(authType === 'oauth_pkce' || authType === 'oauth_client_credentials') && (
            <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50 dark:bg-slate-950/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  OAuth 2.1 Configuration
                </span>
                <button
                  type="button"
                  disabled={oauthBusy}
                  onClick={handleDiscoverOAuth}
                  className="min-h-[36px] px-3 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-medium"
                >
                  {oauthBusy ? 'Discovering...' : 'Auto-Discover (RFC 8414)'}
                </button>
              </div>

              {authType === 'oauth_pkce' && (
                <input
                  type="text"
                  placeholder="Authorization Endpoint (https://...)"
                  value={oauthAuthEp}
                  onChange={(e) => setOauthAuthEp(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                />
              )}
              <input
                type="text"
                placeholder="Token Endpoint (https://...)"
                value={oauthTokenEp}
                onChange={(e) => setOauthTokenEp(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Client ID"
                  value={oauthClientId}
                  onChange={(e) => setOauthClientId(e.target.value)}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                />
                <input
                  type="password"
                  placeholder={authType === 'oauth_pkce' ? 'Client Secret (optional)' : 'Client Secret'}
                  value={oauthClientSecret}
                  onChange={(e) => setOauthClientSecret(e.target.value)}
                  className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                />
              </div>
              <input
                type="text"
                placeholder="Scopes (e.g. mcp:tools offline_access)"
                value={oauthScopes}
                onChange={(e) => setOauthScopes(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
              />

              {authType === 'oauth_pkce' && (
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={handleStartPkceFlow}
                    className="w-full min-h-[42px] rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-semibold"
                  >
                    Generate PKCE Authorization URL
                  </button>
                  {pendingPkce && (
                    <div className="space-y-2 text-xs">
                      <a
                        href={pendingPkce.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block underline text-blue-600 dark:text-blue-400 break-all"
                      >
                        Open OAuth Consent Page
                      </a>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Paste returned authorization code"
                          value={authCodeInput}
                          onChange={(e) => setAuthCodeInput(e.target.value)}
                          className="flex-1 min-h-[40px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        />
                        <button
                          type="button"
                          onClick={handleExchangePkceCode}
                          className="min-h-[40px] px-3 rounded-xl bg-blue-600 text-white font-medium"
                        >
                          Exchange
                        </button>
                      </div>
                    </div>
                  )}
                  {oauthAccessToken && (
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                      OAuth access token stored securely
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="w-full min-h-[48px] rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
          >
            {editingServerId ? 'Save & Test Connection' : 'Add & Connect Server'}
          </button>
        </form>
      </BottomSheet>
    </div>
  );
}
