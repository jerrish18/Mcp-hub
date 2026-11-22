import { BookOpen, Check, Compass, Sparkles, Terminal } from 'lucide-react';
import type { AgentProfile, EffortLevel } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';

interface AgentSwitcherSheetProps {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
  activeAgentId: string;
  activeEffort: EffortLevel;
  onSelectAgent: (agentId: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
}

function getAgentModeSummary(agent: AgentProfile): string {
  if (agent.defaultChatMode === 'study') return 'Study Session · MCPs off';
  if (agent.defaultChatMode === 'general') return 'General Chat · MCPs off';
  return agent.allowedServerIds === null
    ? 'Professional · All MCP servers'
    : `Professional · ${agent.allowedServerIds.length} server${agent.allowedServerIds.length === 1 ? '' : 's'}`;
}

export function AgentSwitcherSheet({
  open,
  onClose,
  agents,
  activeAgentId,
  activeEffort,
  onSelectAgent,
  onSelectEffort,
}: AgentSwitcherSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Choose Agent & Effort"
      subtitle="Agents control system instructions, chat mode, and MCP tool scope"
    >
      <div className="space-y-6">
        <section>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
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
                  className={`min-h-[40px] rounded-full text-sm font-semibold capitalize transition-colors ${
                    active ? 'shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {level}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            Low: fast direct answer · Medium: structured plan · High: deep verification
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Agent Personas ({agents.length})
          </h3>
          <div className="space-y-2">
            {agents.map((agent) => {
              const selected = agent.id === activeAgentId;
              const Icon =
                agent.defaultChatMode === 'study' || agent.icon === 'book-open'
                  ? BookOpen
                  : agent.icon === 'terminal'
                    ? Terminal
                    : agent.icon === 'compass'
                      ? Compass
                      : Sparkles;
              return (
                <button
                  key={agent.id}
                  type="button"
                  data-testid={`select-agent-${agent.id}`}
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
                  className="w-full min-h-[60px] p-3.5 rounded-2xl border text-left flex items-center justify-between gap-3 transition-colors"
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
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {agent.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {getAgentModeSummary(agent)}
                      </div>
                      {agent.description && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {agent.description}
                        </div>
                      )}
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
