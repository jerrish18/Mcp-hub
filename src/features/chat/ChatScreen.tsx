import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  History,
  Info,
  MessageSquarePlus,
  Square,
  Wrench,
} from 'lucide-react';
import { getModelById } from '../../config/models';
import { buildAgentToolCatalog } from '../../services/llm/agentLoop';
import { useHubStore } from '../../store/useHubStore';
import type { EffortLevel } from '../../types';
import { MarkdownRenderer } from '../../ui/MarkdownRenderer';
import { ToolCallCard } from '../../ui/ToolCallCard';
import { WriteApprovalBanner } from '../../ui/WriteApprovalBanner';
import { triggerHaptic } from '../../utils/haptics';
import { AgentModelSwitcherSheet } from './AgentModelSwitcherSheet';
import { HistoryListContent, HistorySheet } from './HistorySheet';

interface ChatScreenProps {
  onOpenSettings: () => void;
}

const STARTER_PROMPTS = [
  {
    label: 'Search workspace notes',
    prompt: 'Search my workspace notes and summarize what is currently saved.',
  },
  {
    label: 'Calculate with MCP tool',
    prompt: 'Calculate (24 * 7) + 12 using the calculator tool.',
  },
  {
    label: 'Create a note (write action)',
    prompt: 'Create a note titled "Sprint Checklist" with my MCP testing priorities.',
  },
];

export function ChatScreen({ onOpenSettings }: ChatScreenProps) {
  const {
    agents,
    servers,
    conversations,
    activeConversationId,
    providerKeys,
    settings,
    isRunning,
    pendingApproval,
    sendMessage,
    stopRun,
    resolvePendingApproval,
    startNewConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    setActiveAgent,
    setActiveModel,
    setActiveEffort,
  } = useHubStore();

  const [input, setInput] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeAgent = agents.find((a) => a.id === activeConv?.agentId) ?? agents[0];
  const activeModel = getModelById(activeConv?.modelId ?? activeAgent.defaultModelId);
  const activeEffort: EffortLevel = activeConv?.effort ?? activeAgent.defaultEffort;

  const { tools } = buildAgentToolCatalog(activeAgent, servers);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeConv?.messages.length, activeConv?.messages[activeConv.messages.length - 1]?.content]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isRunning) return;
    const msg = input;
    setInput('');
    triggerHaptic(settings.hapticsEnabled, 'light');
    await sendMessage(msg);
  };

  const handleCycleEffort = () => {
    const order: EffortLevel[] = ['low', 'medium', 'high'];
    const next = order[(order.indexOf(activeEffort) + 1) % order.length];
    triggerHaptic(settings.hapticsEnabled, 'light');
    setActiveEffort(next);
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50 dark:bg-slate-950">
      {/* Desktop Conversation History Sidebar */}
      <aside className="hidden lg:flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4">
        <div className="mb-3">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Conversations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Local history · {conversations.length} saved
          </p>
        </div>
        <div className="flex-1 min-h-0">
          <HistoryListContent
            conversations={conversations}
            activeConversationId={activeConv?.id ?? null}
            onSelect={selectConversation}
            onNewChat={() => startNewConversation(activeAgent.id, activeModel.id)}
            onRename={renameConversation}
            onDelete={deleteConversation}
          />
        </div>
      </aside>

      {/* Main Chat Pane */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Compact Top Bar with Tappable Agent / Model / Effort Chips */}
        <header className="shrink-0 h-13 px-2.5 sm:px-5 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md flex items-center justify-between gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              aria-label={`Active agent ${activeAgent.name}, tap to switch`}
              className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] sm:text-xs font-medium text-slate-900 dark:text-slate-100 inline-flex items-center gap-1 whitespace-nowrap min-w-0 transition-colors"
            >
              <span className="max-w-[68px] sm:max-w-[140px] truncate">{activeAgent.name}</span>
              <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              aria-label={`Active model ${activeModel.label}, tap to switch`}
              className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap min-w-0 transition-colors"
            >
              <span className="max-w-[74px] sm:max-w-[160px] truncate">{activeModel.label}</span>
              <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={handleCycleEffort}
              aria-label={`Effort level ${activeEffort}, tap to cycle`}
              data-testid="effort-chip"
              className="min-h-[36px] sm:min-h-[38px] px-2 sm:px-2.5 py-1 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-[11px] sm:text-xs font-semibold text-blue-700 dark:text-blue-300 capitalize whitespace-nowrap shrink-0 transition-colors"
            >
              {activeEffort}
            </button>
          </div>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="Open chat history"
              className="lg:hidden min-h-[44px] min-w-[40px] sm:min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <History className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => startNewConversation(activeAgent.id, activeModel.id)}
              aria-label="New conversation"
              className="min-h-[44px] min-w-[40px] sm:min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
          {(!activeConv || activeConv.messages.length === 0) && (
            <div className="max-w-xl mx-auto py-8 sm:py-14 text-center space-y-5">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto">
                <Wrench className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h1 className="font-display text-xl font-semibold text-slate-900 dark:text-white text-balance">
                  {activeAgent.name} is ready
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeModel.label} · {tools.length} active MCP tool{tools.length === 1 ? '' : 's'} ·{' '}
                  <span className="capitalize">{activeEffort}</span> effort
                </p>
              </div>

              <div className="flex flex-col gap-2 text-left pt-2 w-full min-w-0">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void sendMessage(item.prompt)}
                    className="w-full min-w-0 min-h-[48px] px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-700 text-sm text-slate-800 dark:text-slate-200 transition-colors overflow-hidden"
                  >
                    <div className="font-medium text-slate-900 dark:text-white truncate">{item.label}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.prompt}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeConv?.messages.map((msg) => {
            if (msg.role === 'system_notice') {
              return (
                <div
                  key={msg.id}
                  data-testid="fallback-notice"
                  className="max-w-2xl mx-auto rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-3.5 py-2 text-xs text-blue-800 dark:text-blue-200 flex items-center gap-2"
                >
                  <Info className="w-4 h-4 shrink-0" />
                  <span>{msg.content}</span>
                </div>
              );
            }

            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="max-w-2xl mx-auto flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 text-white px-4 py-2.5 text-[15px] leading-relaxed shadow-xs">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="max-w-2xl mx-auto space-y-2">
                {msg.reasoning && (
                  <details className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/60 px-3.5 py-2 text-xs text-slate-600 dark:text-slate-400">
                    <summary className="cursor-pointer font-medium select-none">
                      Reasoning trace
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap leading-relaxed">{msg.reasoning}</div>
                  </details>
                )}

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1">
                    {msg.toolCalls.map((tc) => (
                      <ToolCallCard key={tc.id} record={tc} />
                    ))}
                  </div>
                )}

                {msg.content && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                )}

                {msg.isStreaming && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
                    Thinking...
                  </div>
                )}

                {msg.error && (
                  <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{msg.error}</span>
                    </div>
                    {msg.error.toLowerCase().includes('api key') && (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="shrink-0 text-xs font-semibold underline"
                      >
                        Open Settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Interactive Write-Action Confirmation Gate */}
        {pendingApproval && (
          <WriteApprovalBanner
            approval={pendingApproval}
            onDecision={(decision) => {
              triggerHaptic(settings.hapticsEnabled, decision === 'deny' ? 'warning' : 'success');
              resolvePendingApproval(decision);
            }}
          />
        )}

        {/* Thumb-Zone Composer */}
        <form
          onSubmit={handleSend}
          className="shrink-0 px-3 sm:px-6 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        >
          <div className="max-w-2xl mx-auto flex items-end gap-2">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={`Message ${activeAgent.name}...`}
              aria-label="Chat message input"
              className="flex-1 min-h-[44px] max-h-32 px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {isRunning ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 'warning');
                  stopRun();
                }}
                aria-label="Stop generation"
                className="min-h-[44px] min-w-[44px] px-3.5 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                className="min-h-[44px] min-w-[44px] rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white flex items-center justify-center shrink-0 transition-colors"
              >
                <ArrowUp className="w-5 h-5" />
              </button>
            )}
          </div>
        </form>
      </div>

      <AgentModelSwitcherSheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        agents={agents}
        activeAgentId={activeAgent.id}
        activeModelId={activeModel.id}
        activeEffort={activeEffort}
        providerKeys={providerKeys}
        onSelectAgent={setActiveAgent}
        onSelectModel={setActiveModel}
        onSelectEffort={setActiveEffort}
      />

      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        activeConversationId={activeConv?.id ?? null}
        onSelect={selectConversation}
        onNewChat={() => startNewConversation(activeAgent.id, activeModel.id)}
        onRename={renameConversation}
        onDelete={deleteConversation}
      />
    </div>
  );
}
