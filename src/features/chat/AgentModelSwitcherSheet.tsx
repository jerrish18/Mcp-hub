import { Check, Cpu, Sparkles } from 'lucide-react';
import { PROVIDER_INFO } from '../../config/models';
import { getApiKeyForProvider, mergeModelCatalog } from '../../services/llm/provider';
import type { AgentProfile, EffortLevel, ModelConfig, ProviderKeys } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';

interface AgentModelSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
  dynamicModels: ModelConfig[];
  activeAgentId: string;
  activeModelId: string;
  activeEffort: EffortLevel;
  providerKeys: ProviderKeys;
  onSelectAgent: (agentId: string) => void;
  onSelectModel: (modelId: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
}

export function AgentModelSwitcherSheet({
  open,
  onClose,
  agents,
  dynamicModels,
  activeAgentId,
  activeModelId,
  activeEffort,
  providerKeys,
  onSelectAgent,
  onSelectModel,
  onSelectEffort,
}: AgentModelSwitcherSheetProps) {
  const models = mergeModelCatalog(dynamicModels);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Switch Agent, Model & Effort"
      subtitle="Changes apply immediately without clearing your chat"
    >
      <div className="space-y-6">
        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Reasoning Effort
          </h3>
          <div
            style={{ backgroundColor: 'var(--m3-surface-container)' }}
            className="grid grid-cols-3 gap-1.5 p-1 rounded-full"
          >
            {(['low', 'medium', 'high'] as EffortLevel[]).map((level) => {
              const active = activeEffort === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onSelectEffort(level)}
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                        }
                      : undefined
                  }
                  className={`min-h-[42px] rounded-full text-sm font-semibold capitalize transition-colors ${
                    active ? 'shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {level}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Low: direct answer · Medium: brief plan · High: plan, tool verify & self-check
          </p>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Agent Profile
          </h3>
          <div className="space-y-2">
            {agents.map((agent) => {
              const selected = agent.id === activeAgentId;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    onSelectAgent(agent.id);
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
                  className="w-full min-h-[56px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors"
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
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {agent.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {agent.description || 'Custom agent'}
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

        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Model ({models.length} available)
          </h3>
          <div className="space-y-2">
            {models.map((model) => {
              const selected = model.id === activeModelId;
              const hasKey =
                model.provider === 'demo' || Boolean(getApiKeyForProvider(model.provider, providerKeys));
              return (
                <button
                  key={model.id}
                  type="button"
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
                  className="w-full min-h-[56px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors"
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
                      <Cpu className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {model.label}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {PROVIDER_INFO[model.provider].name}
                        <span aria-hidden="true"> · </span>
                        {hasKey ? 'Ready' : 'Key needed in Settings'}
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
      </div>
    </BottomSheet>
  );
}
