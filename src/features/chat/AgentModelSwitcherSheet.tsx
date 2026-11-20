import { Check, Cpu, Sparkles } from 'lucide-react';
import { FREE_MODELS, PROVIDER_INFO } from '../../config/models';
import { getApiKeyForProvider } from '../../services/llm/provider';
import type { AgentProfile, EffortLevel, ProviderKeys } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';

interface AgentModelSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
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
  activeAgentId,
  activeModelId,
  activeEffort,
  providerKeys,
  onSelectAgent,
  onSelectModel,
  onSelectEffort,
}: AgentModelSwitcherSheetProps) {
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
          <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80">
            {(['low', 'medium', 'high'] as EffortLevel[]).map((level) => {
              const active = activeEffort === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onSelectEffort(level)}
                  className={`min-h-[44px] rounded-xl text-sm font-medium capitalize transition-colors ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
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
                  className={`w-full min-h-[56px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors ${
                    selected
                      ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200">
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
                  {selected && <Check className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2.5">
            Model
          </h3>
          <div className="space-y-2">
            {FREE_MODELS.map((model) => {
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
                  className={`w-full min-h-[56px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors ${
                    selected
                      ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200">
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
                  {selected && <Check className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </BottomSheet>
  );
}
