import { useState } from 'react';
import { Check, Cpu, RefreshCw, Search, Sparkles } from 'lucide-react';
import { getShortModelName, normalizeModelId, PROVIDER_INFO } from '../../config/models';
import { getAvailableModels, getUnavailableCatalogModels } from '../../services/llm/provider';
import type { ModelConfig, ProviderId, ProviderKeys } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { getProviderQuotaStatus } from '../../utils/quotaTracker';

interface ModelSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  dynamicModels: ModelConfig[];
  activeModelId: string;
  providerKeys: ProviderKeys;
  onSelectModel: (modelId: string) => void;
  onRefresh: () => Promise<{ transient: boolean }>;
  onOpenSettings?: () => void;
}

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'groq', 'openrouter', 'cloudflare', 'nvidia', 'kilo', 'modelscope', 'amd', 'local', 'demo'];

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}

export function ModelSwitcherSheet({
  open, onClose, dynamicModels, activeModelId, providerKeys, onSelectModel, onRefresh, onOpenSettings,
}: ModelSwitcherSheetProps) {
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('');
  const models = getAvailableModels(providerKeys, dynamicModels);
  const unavailable = getUnavailableCatalogModels(models, dynamicModels);
  const selectedId = normalizeModelId(activeModelId);
  const search = query.trim().toLowerCase();
  const matching = (model: ModelConfig) => [
    getShortModelName(model), model.label, model.id, PROVIDER_INFO[model.provider].name,
    ...(model.routes ?? []).map((route) => PROVIDER_INFO[route.provider].name),
  ].some((value) => value.toLowerCase().includes(search));
  const visibleModels = models.filter(matching);
  const visibleUnavailable = unavailable.filter(matching);
  const hasCloudModels = models.some((model) => model.routes?.length);

  const select = (modelId: string) => {
    onSelectModel(modelId);
    onClose();
  };
  const refresh = async () => {
    setRefreshing(true);
    setRefreshStatus('');
    try {
      const result = await onRefresh();
      setRefreshStatus(result.transient ? 'Some catalogs are temporarily unavailable. Try again shortly.' : 'Model list refreshed.');
    } catch {
      setRefreshStatus('Could not refresh the model list. Try again shortly.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Choose AI Model">
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
            disabled={refreshing}
            onClick={() => void refresh()}
            className="workspace-secondary flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {refreshStatus && <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{refreshStatus}</p>}
        {hasCloudModels && !search && (
          <button type="button" onClick={() => select('cloud-auto')} aria-pressed={selectedId === 'cloud-auto'}
            className="workspace-secondary inline-flex min-h-[44px] items-center gap-2 text-left"
          >
            Automatic free model
            {selectedId === 'cloud-auto' && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
          </button>
        )}
        {!hasCloudModels && !search && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No verified cloud models are currently available.
            {onOpenSettings && (
              <> <button type="button" className="font-semibold underline" onClick={() => { onClose(); onOpenSettings(); }}>Open provider settings</button></>
            )}
          </p>
        )}
        {search && !visibleModels.length && !visibleUnavailable.length && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No models match your search.</p>
        )}
        {PROVIDER_ORDER.map((provider) => {
          const group = visibleModels.filter((model) => model.provider === provider);
          if (!group.length) return null;
          const quota = getProviderQuotaStatus(provider);
          return (
            <section key={provider} aria-label={PROVIDER_INFO[provider].name} className="space-y-2">
              <h3 className="break-words px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                {PROVIDER_INFO[provider].name}
              </h3>
              {quota?.warningText && (
                <p className="break-words rounded-xl border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:text-amber-300">
                  {quota.warningText}
                </p>
              )}
              {group.map((model) => {
                const selected = model.id === selectedId;
                const otherProviders = [...new Set((model.routes ?? [])
                  .filter((route) => route.provider !== provider).map((route) => PROVIDER_INFO[route.provider].name))];
                return (
                  <button
                    key={model.id}
                    type="button"
                    data-testid={`select-model-${model.id}`}
                    aria-pressed={selected}
                    onClick={() => select(model.id)}
                    style={{
                      backgroundColor: selected ? 'var(--m3-primary-container)' : 'var(--m3-surface-container)',
                      borderColor: selected ? 'var(--m3-primary)' : 'var(--m3-outline)',
                    }}
                    className="flex min-h-[58px] w-full min-w-0 items-start gap-3 rounded-2xl border p-3 text-left transition-colors"
                  >
                    <span aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-200/70 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {provider === 'gemini' ? <Sparkles className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{getShortModelName(model)}</span>
                      <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {formatContextWindow(model.contextWindow)}
                        {model.routes?.some((route) => route.reasoning) && ' · Reasoning'}
                      </span>
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
                );
              })}
            </section>
          );
        })}
        {!!visibleUnavailable.length && (search ? (
          <section aria-label="Unavailable models"><UnavailableModels models={visibleUnavailable} /></section>
        ) : (
          <details className="rounded-2xl border px-3.5 py-2.5" style={{ borderColor: 'var(--m3-outline)' }}>
            <summary className="cursor-pointer text-sm font-semibold">Unavailable models ({visibleUnavailable.length})</summary>
            <UnavailableModels models={visibleUnavailable} />
          </details>
        ))}
      </div>
    </BottomSheet>
  );
}

function UnavailableModels({ models }: { models: ModelConfig[] }) {
  return (
    <div className="space-y-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
      <p>These models have no verified free route available with your current settings.</p>
      <ul className="space-y-2">
        {models.map((model) => (
          <li key={model.id} className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{getShortModelName(model)}</span>
            <span>{PROVIDER_INFO[model.provider].name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
