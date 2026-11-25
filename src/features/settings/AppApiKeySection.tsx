import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { ControlActivityEntry, PublicApiKeyInfo } from '../../server/controlRouter';
import { CONTROL_ACTIONS, type ControlKeyScope } from '../../services/control/actionsCatalog';
import {
  createAppApiKey,
  listAppApiKeys,
  revokeAppApiKey,
  setControlAdminToken,
} from '../../services/control/browserBridge';
import { useHubStore } from '../../store/useHubStore';
import { triggerHaptic } from '../../utils/haptics';

interface AppApiKeySectionProps {
  compact?: boolean;
}

const SCOPE_LABELS: Record<ControlKeyScope, { title: string; desc: string }> = {
  full: {
    title: 'Full App Control',
    desc: 'All 19 actions: chat, MCP tool execution, server & agent CRUD, settings, and approvals.',
  },
  chat_and_tools: {
    title: 'Chat & Tools Only',
    desc: 'Navigate tabs, connect servers, invoke MCP tools, and run chat loops (no server/agent deletion or settings edits).',
  },
  read_only: {
    title: 'Read-Only Telemetry',
    desc: 'Inspect workspace state, servers, agents, models, and saved conversations only.',
  },
};

export function AppApiKeySection({ compact = false }: AppApiKeySectionProps) {
  const { settings, signOutAccount } = useHubStore();
  const [keys, setKeys] = useState<PublicApiKeyInfo[]>([]);
  const [activity, setActivity] = useState<ControlActivityEntry[]>([]);
  const [bridgeConnectedCount, setBridgeConnectedCount] = useState(0);
  const [adminTokenRequired, setAdminTokenRequired] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [adminTokenInput, setAdminTokenInput] = useState('');

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<ControlKeyScope>('full');
  const [revealedKey, setRevealedKey] = useState<{ label: string; raw: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [showActionsRef, setShowActionsRef] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const mcpUrl = `${origin}/mcp`;
  const restExecuteUrl = `${origin}/api/control/execute`;

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const data = await listAppApiKeys();
      setKeys(data.keys);
      setActivity(data.activity);
      setBridgeConnectedCount(data.bridgeConnectedCount);
      setAdminTokenRequired(data.adminTokenRequired);
      setRequiresSignIn(Boolean(data.requiresSignIn));
      setCanManage(Boolean(data.canManage));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach App API server';
      setCanManage(false);
      if (msg.toLowerCase().includes('sign in')) setRequiresSignIn(true);
      if (msg.toLowerCase().includes('admin token')) setAdminTokenRequired(true);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      triggerHaptic(settings.hapticsEnabled, 'light');
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      setErrorMsg('Clipboard copy unavailable in this browser context.');
    }
  };

  const handleUnlockAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    setControlAdminToken(adminTokenInput);
    setAdminTokenInput('');
    void loadData();
  };

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const trimmed = label.trim() || 'External Agent Key';
    setCreating(true);
    setErrorMsg('');
    try {
      const res = await createAppApiKey(trimmed, scope);
      setRevealedKey({ label: res.key.label, raw: res.plaintextKey });
      setLabel('');
      triggerHaptic(settings.hapticsEnabled, 'success');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate key.');
      triggerHaptic(settings.hapticsEnabled, 'warning');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setErrorMsg('');
    try {
      await revokeAppApiKey(id);
      triggerHaptic(settings.hapticsEnabled, 'light');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to revoke key.');
    }
  };

  const buildMcpJsonConfig = (rawKey: string) =>
    JSON.stringify(
      {
        mcpServers: {
          'mcp-hub-remote': {
            type: 'streamable-http',
            url: mcpUrl,
            headers: {
              Authorization: `Bearer ${rawKey}`,
            },
          },
        },
      },
      null,
      2
    );

  const buildCurlSnippet = (rawKey: string) =>
    `curl -X POST "${restExecuteUrl}" \\\n  -H "Authorization: Bearer ${rawKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"action":"navigate_tab","params":{"tab":"chat"}}'`;

  const containerClass = compact
    ? 'space-y-4'
    : 'rounded-[24px] border p-5 space-y-4';

  const containerStyle = compact
    ? undefined
    : {
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      };

  return (
    <section
      id="app-api-control"
      data-testid="app-api-section"
      style={containerStyle}
      className={containerClass}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Terminal style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              App API & External Agent Control
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Generate a key so any external AI agent can control all {CONTROL_ACTIONS.length} app actions via REST or MCP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
              bridgeConnectedCount > 0
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            }`}
          >
            <Wifi className="w-3 h-3" />
            {bridgeConnectedCount > 0 ? 'Live Hub Bridge' : 'Mirror Standby'}
          </span>
          <button
            type="button"
            onClick={() => void loadData()}
            aria-label="Refresh App API keys and activity"
            className="min-h-[38px] min-w-[38px] rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Endpoints Quick Copy */}
      <div className={compact ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-2'}>
        <div
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border px-3 py-2 flex items-center justify-between gap-2 min-w-0"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Remote MCP Endpoint
            </div>
            <div className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">
              {mcpUrl}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void copyText('mcp-url', mcpUrl)}
            aria-label="Copy Remote MCP endpoint URL"
            className="min-h-[38px] min-w-[38px] rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0"
          >
            {copiedId === 'mcp-url' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <div
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border px-3 py-2 flex items-center justify-between gap-2 min-w-0"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              REST Action Endpoint
            </div>
            <div className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate">
              {restExecuteUrl}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void copyText('rest-url', restExecuteUrl)}
            aria-label="Copy REST execute URL"
            className="min-h-[38px] min-w-[38px] rounded-full flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0"
          >
            {copiedId === 'rest-url' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {requiresSignIn && !canManage && (
        <div className="rounded-xl border border-slate-300 dark:border-slate-700 p-3 space-y-2">
          <p className="text-sm">Sign in with an MCP Hub account to create keys for your own workspace. Open that workspace when using your keys.</p>
          <button type="button" className="workspace-secondary" onClick={() => void signOutAccount()}>
            Open account sign-in
          </button>
        </div>
      )}

      {/* Optional Admin Token Prompt if server enforces MCP_HUB_ADMIN_TOKEN */}
      {adminTokenRequired && (
        <form
          onSubmit={handleUnlockAdmin}
          className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex flex-col sm:flex-row gap-2"
        >
          <input
            type="password"
            value={adminTokenInput}
            onChange={(e) => setAdminTokenInput(e.target.value)}
            placeholder="Enter MCP_HUB_ADMIN_TOKEN to manage keys"
            aria-label="Admin token"
            className="flex-1 min-h-[42px] px-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-950 text-xs font-mono"
          />
          <button
            type="submit"
            className="min-h-[42px] px-4 rounded-full bg-amber-600 text-white text-xs font-semibold whitespace-nowrap"
          >
            Unlock Management
          </button>
        </form>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-200"
        >
          {errorMsg}
        </div>
      )}

      {/* Key Generator Form */}
      <form
        onSubmit={handleGenerateKey}
        style={{
          backgroundColor: 'var(--m3-surface)',
          borderColor: 'var(--m3-outline)',
        }}
        className="rounded-2xl border p-3.5 space-y-3"
      >
        <div className={compact ? 'grid grid-cols-1 gap-2.5' : 'grid grid-cols-1 sm:grid-cols-2 gap-2.5'}>
          <div>
            <label
              htmlFor={compact ? 'app-api-label-sheet' : 'app-api-label'}
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Agent / Key Name
            </label>
            <input
              id={compact ? 'app-api-label-sheet' : 'app-api-label'}
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Claude Desktop, Cursor, Python Bot"
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[44px] px-3.5 rounded-2xl border text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label
              htmlFor={compact ? 'app-api-scope-sheet' : 'app-api-scope'}
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Permission Scope
            </label>
            <select
              id={compact ? 'app-api-scope-sheet' : 'app-api-scope'}
              value={scope}
              onChange={(e) => setScope(e.target.value as ControlKeyScope)}
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[44px] px-3 rounded-2xl border text-sm text-slate-900 dark:text-white"
            >
              <option value="full">Full Control (all 19 actions)</option>
              <option value="chat_and_tools">Chat & Tools Only</option>
              <option value="read_only">Read-Only Telemetry</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {SCOPE_LABELS[scope].desc}
          </p>
          <button
            type="submit"
            disabled={creating || !canManage}
            data-testid="generate-app-api-key-btn"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[44px] px-5 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap disabled:opacity-50 transition-opacity hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            <span>{creating ? 'Generating...' : 'Generate API Key'}</span>
          </button>
        </div>
      </form>

      {/* One-time Plaintext Key Reveal */}
      {revealedKey && (
        <div
          data-testid="revealed-app-api-key-box"
          className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/35 p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="text-xs font-semibold">
                Key created for “{revealedKey.label}” — copy now (shown once)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRevealedKey(null)}
              className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline shrink-0"
            >
              Done
            </button>
          </div>

          <div className="rounded-xl bg-white/90 dark:bg-slate-950 border border-emerald-200 dark:border-emerald-900 px-3 py-2.5 flex items-center justify-between gap-2">
            <code
              data-testid="generated-app-api-key"
              className="text-xs font-mono text-slate-900 dark:text-emerald-200 break-all"
            >
              {revealedKey.raw}
            </code>
            <button
              type="button"
              onClick={() => void copyText('raw-key', revealedKey.raw)}
              aria-label="Copy generated App API key"
              className="min-h-[38px] px-3 rounded-full bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
            >
              {copiedId === 'raw-key' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId === 'raw-key' ? 'Copied' : 'Copy Key'}</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText('mcp-json', buildMcpJsonConfig(revealedKey.raw))}
              className="min-h-[38px] px-3.5 rounded-full bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5"
            >
              {copiedId === 'mcp-json' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId === 'mcp-json' ? 'Copied MCP JSON' : 'Copy MCP Client JSON'}</span>
            </button>

            <button
              type="button"
              onClick={() => void copyText('curl', buildCurlSnippet(revealedKey.raw))}
              className="min-h-[38px] px-3.5 rounded-full bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5"
            >
              {copiedId === 'curl' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedId === 'curl' ? 'Copied cURL' : 'Copy cURL Command'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Issued Keys List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Issued App Keys ({keys.filter((k) => k.active).length} active)
          </h3>
        </div>

        {keys.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-2xl border p-4 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2.5"
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>No App API keys generated yet. Create one above to connect an external agent.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                data-testid={`app-api-key-row-${k.id}`}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="rounded-2xl border px-3.5 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {k.label}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        k.active
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 line-through'
                      }`}
                    >
                      {k.active ? SCOPE_LABELS[k.scope].title : 'Revoked'}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span>{k.prefix}</span>
                    <span aria-hidden="true">·</span>
                    <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                    {k.lastUsedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Last used {new Date(k.lastUsedAt).toLocaleTimeString()}</span>
                      </>
                    )}
                  </div>
                </div>

                {k.active && (
                  <button
                    type="button"
                    onClick={() => void handleRevoke(k.id)}
                    aria-label={`Revoke API key ${k.label}`}
                    className="min-h-[40px] px-3 rounded-full text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Revoke</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Collapsible Reference: Actions & Activity Log */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => setShowActionsRef((v) => !v)}
          style={{
            backgroundColor: 'var(--m3-surface-container-high)',
            borderColor: 'var(--m3-outline)',
          }}
          className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5"
        >
          <span>Controllable Actions ({CONTROL_ACTIONS.length})</span>
          {showActionsRef ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <button
          type="button"
          onClick={() => setShowActivity((v) => !v)}
          style={{
            backgroundColor: 'var(--m3-surface-container-high)',
            borderColor: 'var(--m3-outline)',
          }}
          className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>External Activity ({activity.length})</span>
          {showActivity ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {showActionsRef && (
        <div
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border p-3 max-h-64 overflow-y-auto divide-y divide-slate-200/60 dark:divide-slate-800"
        >
          {CONTROL_ACTIONS.map((a) => (
            <div key={a.name} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs font-mono font-semibold text-slate-900 dark:text-white">
                  {a.name}
                </code>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {a.tier}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {a.description}
              </p>
            </div>
          ))}
        </div>
      )}

      {showActivity && (
        <div
          data-testid="external-control-activity"
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border p-3 max-h-60 overflow-y-auto space-y-2"
        >
          {activity.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No external agent calls recorded yet.
            </p>
          ) : (
            activity.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-2 text-xs border-b border-slate-200/50 dark:border-slate-800 pb-1.5 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className={`font-semibold ${
                        item.status === 'ok'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      [{item.transport.toUpperCase()}]
                    </span>
                    <code className="font-mono text-slate-900 dark:text-white">{item.action}</code>
                    <span className="text-slate-500 dark:text-slate-400">· {item.keyLabel}</span>
                  </div>
                  {item.detail && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {item.detail}
                    </div>
                  )}
                </div>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                  {item.durationMs}ms
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
