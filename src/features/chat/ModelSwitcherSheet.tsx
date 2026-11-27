import { useState } from 'react';
import { Check, Cpu, RefreshCw, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { CODING_ROLE_METADATA, getShortModelName, normalizeModelId, PROVIDER_INFO } from '../../config/models';
import {
  getAvailableModels,
  getUnavailableCatalogModelsWithDetails,
  isModelManuallyOverridden,
  type UnavailableCatalogEntry,
} from '../../services/llm/provider';
import type {
  CloudProvider,
  CodingRole,
  ModelConfig,
  ProviderId,
  ProviderKeys,
  ProviderKeyStatus,
  ProviderValidationResult,
} from '../../types';
import { supportsCodingRole } from '../../services/llm/codingOrchestrator';
import { BottomSheet } from '../../ui/BottomSheet';
import { getProviderQuotaStatus } from '../../utils/quotaTracker';

interface ModelSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  dynamicModels: ModelConfig[];
  activeModelId: string;
  providerKeys: ProviderKeys;
  manualModelOverrides?: string[];
  providerValidation?: Partial<Record<CloudProvider, ProviderValidationResult>>;
  modelFailures?: Record<string, { status: ProviderKeyStatus; badge: string; detail: string }>;
  onToggleManualOverride?: (modelId: string) => void;
  onSelectModel: (modelId: string) => void;
  onRefresh: () => Promise<{ transient: boolean }>;
  codingRole?: CodingRole;
  roleIsAutomatic?: boolean;
  onUseAutomatic?: () => void;
  catalogRefreshing?: boolean;
  onOpenSettings?: () => void;
}

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'groq', 'openrouter', 'cloudflare', 'nvidia', 'kilo', 'modelscope', 'amd', 'local', 'demo'];

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}

function statusBadgeTone(status: ProviderKeyStatus | 'unverified_route'): string {
  if (status === 'invalid_key' || status === 'rate_limited') {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-200 border-rose-300 dark:border-rose-800';
  }
  if (status === 'unsupported_param' || status === 'cors_blocked' || status === 'paid_route' || status === 'network_error') {
    return 'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-200 border-amber-300 dark:border-amber-800';
  }
  return 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700';
}

export function ModelSwitcherSheet({
  open,
  onClose,
  dynamicModels,
  activeModelId,
  providerKeys,
  manualModelOverrides = [],
  providerValidation = {},
  modelFailures = {},
  onToggleManualOverride,
  onSelectModel,
  onRefresh,
  codingRole,
  roleIsAutomatic,
  onUseAutomatic,
  catalogRefreshing = false,
  onOpenSettings,
}: ModelSwitcherSheetProps) {
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');
  const models = getAvailableModels(providerKeys, dynamicModels, manualModelOverrides, providerValidation);
  const unavailable = getUnavailableCatalogModelsWithDetails(
    models,
    providerKeys,
    dynamicModels,
    providerValidation,
    modelFailures
  );
  const selectedId = normalizeModelId(activeModelId);
  const search = query.trim().toLowerCase();
  const matching = (model: ModelConfig) => [
    getShortModelName(model), model.label, model.id, PROVIDER_INFO[model.provider].name,
    ...(model.routes ?? []).map((route) => PROVIDER_INFO[route.provider].name),
  ].some((value) => value.toLowerCase().includes(search));
  const visibleModels = models.filter(matching);
  const visibleUnavailable = unavailable.filter((entry) => matching(entry.model));
  const hasCloudModels = models.some((model) => model.routes?.length);
  const busy = refreshing || catalogRefreshing;

  const select = (modelId: string) => {
    onSelectModel(modelId);
    onClose();
  };
  const refresh = async () => {
    setRefreshing(true);
    setRefreshStatus('');
    try {
      const result = await onRefresh();
      setRefreshStatus(result.transient ? 'Some catalogs are temporarily unavailable. Try again shortly.' : 'Model list refreshed and keys verified.');
    } catch {
      setRefreshStatus('Could not refresh the model list. Try again shortly.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={codingRole ? `Choose ${CODING_ROLE_METADATA[codingRole].label} model` : "Choose AI Model"}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              aria-label="Search models"
              style={{ backgroundColor: 'var(--m3-surface-container)', borderColor: 'var(--m3-outline)' }}
              className="w-full min-w-0 min-h-[44px] pl-9 pr-2 rounded-2xl border text-sm"
            />
          </div>
          <button
            type="button"
            aria-label="Refresh models"
            title="Refresh models"
            disabled={busy}
            onClick={() => void refresh()}
            className="workspace-secondary flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {refreshStatus && <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{refreshStatus}</p>}
        {!search && (onUseAutomatic || hasCloudModels) && (
          <button type="button"
            onClick={onUseAutomatic ? () => { onUseAutomatic(); onClose(); } : () => select('cloud-auto')}
            aria-pressed={onUseAutomatic ? roleIsAutomatic : selectedId === 'cloud-auto'}
            className="workspace-secondary inline-flex min-h-[44px] items-center gap-2 text-left"
          >
            {codingRole ? `Automatic ${CODING_ROLE_METADATA[codingRole].label} model` : 'Automatic free model'}
            {(onUseAutomatic ? roleIsAutomatic : selectedId === 'cloud-auto') && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
          </button>
        )}
        {!hasCloudModels && !search && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {busy ? 'Checking provider catalogs…' : 'Add or refresh provider keys to load verified free models.'}
          </p>
        )}
        {!search && onOpenSettings && (codingRole || !hasCloudModels) && (
          <button type="button" className="block text-sm font-semibold underline" onClick={() => { onClose(); onOpenSettings(); }}>
            Open provider settings
          </button>
        )}
        {search && !visibleModels.length && !visibleUnavailable.length && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No models match your search.</p>
        )}
        {PROVIDER_ORDER.map((provider) => {
          const group = visibleModels.filter((model) => model.provider === provider);
          if (!group.length) return null;
          const quota = getProviderQuotaStatus(provider);
          const pValidation = provider !== 'local' && provider !== 'demo' ? providerValidation[provider] : undefined;
          return (
            <section key={provider} aria-label={PROVIDER_INFO[provider].name} className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="break-words text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {PROVIDER_INFO[provider].name}
                </h3>
                {pValidation && pValidation.status !== 'unconfigured' && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    pValidation.status === 'valid'
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                      : statusBadgeTone(pValidation.status)
                  }`}>
                    {pValidation.badge}
                  </span>
                )}
              </div>
              {quota?.warningText && (
                <p className="break-words rounded-xl border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-300">
                  {quota.warningText}
                </p>
              )}
              {group.map((model) => {
                const selected = model.id === selectedId;
                const incompatible = Boolean(codingRole && !supportsCodingRole(model, codingRole));
                const overridden = isModelManuallyOverridden(model.id, manualModelOverrides);
                const otherProviders = [...new Set((model.routes ?? [])
                  .filter((route) => route.provider !== provider).map((route) => PROVIDER_INFO[route.provider].name))];
                return (
                  <div key={model.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      data-testid={`select-model-${model.id}`}
                      aria-pressed={selected}
                      disabled={incompatible}
                      onClick={() => select(model.id)}
                      style={{
                        backgroundColor: selected ? 'var(--m3-primary-container)' : 'var(--m3-surface-container)',
                        borderColor: selected ? 'var(--m3-primary)' : 'var(--m3-outline)',
                      }}
                      className="flex min-h-[58px] flex-1 min-w-0 items-start gap-3 rounded-2xl border p-3 text-left transition-colors disabled:opacity-65"
                    >
                      <span aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        {provider === 'gemini' ? <Sparkles className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">{getShortModelName(model)}</span>
                          {overridden && !model.routes?.length && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
                              Manual override · may incur charges
                            </span>
                          )}
                        </span>
                        <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {formatContextWindow(model.contextWindow)}
                          {model.routes?.some((route) => route.reasoning) && ' · Reasoning'}
                          {codingRole && model.routes?.some((route) => route.tools) && ' · Tool calling'}
                        </span>
                        {incompatible && (
                          <span className="block text-xs text-amber-800 dark:text-amber-300">This role requires tool calling.</span>
                        )}
                        {!!otherProviders.length && (
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            Also via {otherProviders.join(', ')}
                          </span>
                        )}
                        {model.routes?.some((route) => route.dataTerms) && (
                          <span className="block text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                            A free route may retain prompts for training.
                          </span>
                        )}
                      </span>
                      {selected && <Check aria-hidden="true" style={{ color: 'var(--m3-primary)' }} className="mt-0.5 h-5 w-5 shrink-0" />}
                    </button>
                    {overridden && onToggleManualOverride && (
                      <button
                        type="button"
                        aria-label={`Disable manual override for ${getShortModelName(model)}`}
                        onClick={() => onToggleManualOverride(model.id)}
                        className="min-h-[44px] px-3 rounded-2xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                      >
                        Disable
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
        {!!visibleUnavailable.length && (search ? (
          <section aria-label="Models needing attention or override">
            <UnavailableModels entries={visibleUnavailable} onToggleOverride={onToggleManualOverride} />
          </section>
        ) : (
          <details className="rounded-2xl border px-3.5 py-2.5" style={{ borderColor: 'var(--m3-outline)' }}>
            <summary className="cursor-pointer text-sm font-semibold">
              Unavailable / Unverified Models ({visibleUnavailable.length})
            </summary>
            <UnavailableModels entries={visibleUnavailable} onToggleOverride={onToggleManualOverride} />
          </details>
        ))}
      </div>
    </BottomSheet>
  );
}

function UnavailableModels({
  entries,
  onToggleOverride,
}: {
  entries: UnavailableCatalogEntry[];
  onToggleOverride?: (modelId: string) => void;
}) {
  return (
    <div className="space-y-2.5 pt-2.5 text-xs text-slate-500 dark:text-slate-400">
      <p className="flex items-start gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>
          {onToggleOverride
            ? 'Manual override can send requests to a paid or unverified route.'
            : 'These models remain unavailable until there is a verified free route or a manual override in the chat model picker.'}
        </span>
      </p>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li
            key={entry.model.id}
            style={{ backgroundColor: 'var(--m3-surface)', borderColor: 'var(--m3-outline)' }}
            className="rounded-2xl border p-2.5 space-y-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 [overflow-wrap:anywhere]">
                    {getShortModelName(entry.model)}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {PROVIDER_INFO[entry.model.provider].name}
                  </span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeTone(entry.status)}`}>
                    {entry.badge}
                  </span>
                </div>
                <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 [overflow-wrap:anywhere]">
                  {entry.detail}
                </p>
              </div>
              {entry.canOverride && onToggleOverride && (
                <button
                  type="button"
                  data-testid={`override-model-${entry.model.id}`}
                  onClick={() => onToggleOverride(entry.model.id)}
                  style={{
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-semibold shrink-0 hover:opacity-90"
                >
                  Enable
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

