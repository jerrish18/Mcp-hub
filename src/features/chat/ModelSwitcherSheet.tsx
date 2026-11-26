import { useMemo, useState } from 'react';
import { Check, Cpu, KeyRound, Search, Sparkles } from 'lucide-react';
import { getShortModelName, PROVIDER_INFO } from '../../config/models';
import { getAvailableModels, getApiKeyForProvider } from '../../services/llm/provider';
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
  onOpenSettings?: () => void;
}

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'groq', 'openrouter', 'cloudflare', 'nvidia', 'kilo', 'local', 'demo'];

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}

export function ModelSwitcherSheet({
  open,
  onClose,
  dynamicModels,
  activeModelId,
  providerKeys,
  onSelectModel,
  onOpenSettings,
}: ModelSwitcherSheetProps) {
  const [query, setQuery] = useState('');
  const allModels = useMemo(() => getAvailableModels(providerKeys, dynamicModels), [dynamicModels, providerKeys]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allModels;
    return allModels.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        getShortModelName(m).toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        PROVIDER_INFO[m.provider].name.toLowerCase().includes(q)
    );
  }, [allModels, query]);

  const grouped = useMemo(() => {
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      title: PROVIDER_INFO[provider].name,
      hasKey: provider === 'demo' || Boolean(getApiKeyForProvider(provider, providerKeys)),
      items: filteredModels.filter((m) => m.provider === provider),
    })).filter((g) => g.items.length > 0);
  }, [filteredModels, providerKeys]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Choose AI Model"
      subtitle="Models are managed independently from your selected agent"
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter models (Gemini, GPT-OSS, Qwen, Llama...)"
            aria-label="Search models"
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="w-full min-h-[42px] pl-10 pr-3.5 rounded-2xl border text-sm text-slate-900 dark:text-white"
          />
        </div>

        {allModels.some((item) => item.routes?.length) && (
          <button type="button" onClick={() => { onSelectModel('cloud-auto'); onClose(); }} className="workspace-secondary">
            Automatic free model
          </button>
        )}
        {!allModels.some((item) => item.routes?.length) && <p className="text-sm text-slate-500 dark:text-slate-400">
          Verified cloud models appear here after their free routes pass verification.
        </p>}
        <div className="space-y-5">
          {grouped.map((group) => {
            const quota = open ? getProviderQuotaStatus(group.provider) : null;
            return (
            <section key={group.provider} className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                    {group.title}
                  </h3>
                  {quota && (quota.rpmUsed > 0 || quota.rpdUsed > 0 || quota.rateLimitedRecently) && (
                    <span
                      className={`text-[10px] font-mono tabular-nums ${
                        quota.rateLimitedRecently
                          ? 'text-rose-600 dark:text-rose-400 font-semibold'
                          : quota.nearLimit
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-slate-400'
                      }`}
                    >
                      {quota.rpmUsed}/{quota.rpmLimit} RPM
                    </span>
                  )}
                </div>
                {group.hasKey ? (
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                    Connected
                  </span>
                ) : onOpenSettings ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenSettings();
                    }}
                    className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 inline-flex items-center gap-1 hover:underline shrink-0"
                  >
                    <KeyRound className="w-3 h-3" />
                    Add API key
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400 shrink-0">Key needed</span>
                )}
              </div>
              {quota?.warningText && (
                <div className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300">
                  {quota.warningText}
                </div>
              )}

              <div className="space-y-1.5">
                {group.items.map((model) => {
                  const selected = model.id === activeModelId;
                  const shortName = getShortModelName(model);
                  return (
                    <button
                      key={model.id}
                      type="button"
                      data-testid={`select-model-${model.id}`}
                      onClick={() => {
                        onSelectModel(model.id);
                        onClose();
                      }}
                      style={
                        selected
                          ? {
                              backgroundColor: 'var(--m3-primary-container)',
                              borderColor: 'var(--m3-primary)',
                            }
                          : {
                              backgroundColor: 'var(--m3-surface-container)',
                              borderColor: 'var(--m3-outline)',
                            }
                      }
                      className="w-full min-h-[58px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          style={
                            selected
                              ? { backgroundColor: 'var(--m3-primary)', color: 'var(--m3-on-primary)' }
                              : undefined
                          }
                          className="w-9 h-9 rounded-xl bg-slate-200/70 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200"
                        >
                          {model.provider === 'gemini' ? (
                            <Sparkles className="w-4 h-4" />
                          ) : (
                            <Cpu className="w-4 h-4" />
                          )}
                        </span>{model.routes?.some((route) => route.dataTerms) && <span className="block text-[11px] text-amber-700 dark:text-amber-300">A free route may retain prompts for training.</span>}
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {shortName}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                            {formatContextWindow(model.contextWindow)}
                            {(model.supportsThinkingLevel || model.supportsReasoningEffort) && (
                              <>
                                <span aria-hidden="true"> · </span>
                                <span>Reasoning control</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {selected && (
                        <Check style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}
