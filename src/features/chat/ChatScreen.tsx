import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  History,
  Info,
  MessageSquarePlus,
  Mic,
  MicOff,
  Share2,
  Square,
  Volume2,
  VolumeX,
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
import { M3_EMPHASIZED_EASE } from '../../utils/motion';
import { AgentModelSwitcherSheet } from './AgentModelSwitcherSheet';
import { HistoryListContent, HistorySheet } from './HistorySheet';

interface ChatScreenProps {
  onOpenSettings: () => void;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
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
    dynamicModels,
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
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechTimerRef = useRef<number | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeAgent = agents.find((a) => a.id === activeConv?.agentId) ?? agents[0];
  const activeModel = getModelById(activeConv?.modelId ?? activeAgent.defaultModelId, dynamicModels);
  const activeEffort: EffortLevel = activeConv?.effort ?? activeAgent.defaultEffort;

  const { tools } = buildAgentToolCatalog(activeAgent, servers);
  const lastMsg = activeConv?.messages[activeConv.messages.length - 1];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [
    activeConv?.messages.length,
    lastMsg?.content,
    lastMsg?.toolCalls?.length,
    lastMsg?.error,
  ]);

  useEffect(() => {
    // Stop active dictation when switching conversations
    recognitionRef.current?.stop();
    setIsListening(false);
  }, [activeConversationId]);

  useEffect(() => {
    return () => {
      if (speechTimerRef.current !== null) {
        window.clearTimeout(speechTimerRef.current);
      }
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isRunning) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
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

  const handleToggleVoiceDictation = () => {
    setSpeechNotice('');
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setSpeechNotice('Voice dictation unavailable in this browser. Tap your Gboard mic key on Pixel.');
      if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
      speechTimerRef.current = window.setTimeout(() => setSpeechNotice(''), 3500);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      const baseText = input.trim();

      rec.onresult = (ev) => {
        let transcript = '';
        for (let i = 0; i < ev.results.length; i++) {
          transcript += ev.results[i][0]?.transcript ?? '';
        }
        setInput(baseText ? `${baseText} ${transcript}` : transcript);
      };
      rec.onerror = () => setIsListening(false);
      rec.onend = () => setIsListening(false);

      recognitionRef.current = rec;
      rec.start();
      triggerHaptic(settings.hapticsEnabled, 'medium');
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const handleCopyMessage = async (msgId: string, content: string) => {
    try {
      await navigator.clipboard?.writeText(content);
      setCopiedMsgId(msgId);
      triggerHaptic(settings.hapticsEnabled, 'light');
      setTimeout(() => setCopiedMsgId(null), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSpeakMessage = (msgId: string, content: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const handleShareMessage = async (content: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'MCP Hub Response', text: content });
        return;
      } catch {
        // user cancelled share sheet
      }
    }
    await navigator.clipboard?.writeText(content);
  };

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="flex h-full min-h-0"
    >
      {/* Desktop Conversation History Sidebar */}
      <aside
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="hidden lg:flex w-72 shrink-0 flex-col border-r p-4"
      >
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
        {/* Pixel Material 3 Top App Bar with Tonal Chips */}
        <header
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="shrink-0 h-14 px-2.5 sm:px-5 border-b flex items-center justify-between gap-1.5 sm:gap-2 pt-safe"
        >
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              aria-label={`Active agent ${activeAgent.name}, tap to switch`}
              style={{
                backgroundColor: 'var(--m3-surface-container-high)',
                borderColor: 'var(--m3-outline)',
              }}
              className="min-h-[36px] sm:min-h-[38px] px-2.5 py-1 rounded-full border text-[11px] sm:text-xs font-medium text-slate-900 dark:text-slate-100 inline-flex items-center gap-1 whitespace-nowrap min-w-0 transition-opacity hover:opacity-90"
            >
              <span className="max-w-[68px] sm:max-w-[140px] truncate">{activeAgent.name}</span>
              <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => setSwitcherOpen(true)}
              aria-label={`Active model ${activeModel.label}, tap to switch`}
              style={{
                backgroundColor: 'var(--m3-surface-container-high)',
                borderColor: 'var(--m3-outline)',
              }}
              className="min-h-[36px] sm:min-h-[38px] px-2.5 py-1 rounded-full border text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap min-w-0 transition-opacity hover:opacity-90"
            >
              <span className="max-w-[74px] sm:max-w-[160px] truncate">{activeModel.label}</span>
              <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={handleCycleEffort}
              aria-label={`Effort level ${activeEffort}, tap to cycle`}
              data-testid="effort-chip"
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="min-h-[36px] sm:min-h-[38px] px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold capitalize whitespace-nowrap shrink-0 transition-opacity hover:opacity-90"
            >
              {activeEffort}
            </button>
          </div>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="Open chat history"
              className="lg:hidden min-h-[44px] min-w-[40px] sm:min-w-[44px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <History className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => startNewConversation(activeAgent.id, activeModel.id)}
              aria-label="New conversation"
              className="min-h-[44px] min-w-[40px] sm:min-w-[44px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <MessageSquarePlus className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Scrollable Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
          {(!activeConv || activeConv.messages.length === 0) && (
            <div className="max-w-xl mx-auto py-8 sm:py-14 text-center space-y-5">
              <div
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="w-14 h-14 rounded-[20px] flex items-center justify-center mx-auto shadow-xs"
              >
                <Wrench className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white text-balance">
                  {activeAgent.name} is ready
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeModel.label} · {tools.length} active MCP tool{tools.length === 1 ? '' : 's'} ·{' '}
                  <span className="capitalize">{activeEffort}</span> effort
                </p>
              </div>

              <div className="flex flex-col gap-2.5 text-left pt-2 w-full min-w-0">
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void sendMessage(item.prompt)}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="w-full min-w-0 min-h-[52px] px-4 py-3 rounded-[22px] border text-sm text-slate-800 dark:text-slate-200 transition-transform active:scale-[0.99] overflow-hidden"
                  >
                    <div className="font-semibold text-slate-900 dark:text-white truncate">
                      {item.label}
                    </div>
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
                  style={{
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }}
                  className="max-w-2xl mx-auto rounded-2xl px-3.5 py-2.5 text-xs flex items-center gap-2"
                >
                  <Info className="w-4 h-4 shrink-0" />
                  <span>{msg.content}</span>
                </div>
              );
            }

            if (msg.role === 'user') {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={M3_EMPHASIZED_EASE}
                  className="max-w-2xl mx-auto flex justify-end"
                >
                  <div
                    style={{
                      backgroundColor: 'var(--m3-primary)',
                      color: 'var(--m3-on-primary)',
                    }}
                    className="max-w-[85%] rounded-[22px] rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed shadow-xs"
                  >
                    {msg.content}
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={M3_EMPHASIZED_EASE}
                className="max-w-2xl mx-auto space-y-2"
              >
                {msg.reasoning && (
                  <details
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-2xl border px-3.5 py-2 text-xs text-slate-600 dark:text-slate-400"
                  >
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
                  <div className="space-y-1.5">
                    <div
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="rounded-[22px] border px-4 py-3"
                    >
                      <MarkdownRenderer content={msg.content} />
                    </div>

                    {/* Pixel Assistant quick action bar */}
                    {!msg.isStreaming && (
                      <div className="flex items-center gap-1 px-1">
                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(msg.id, msg.content)}
                          aria-label="Copy response"
                          className="min-h-[36px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
                        >
                          {copiedMsgId === msg.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          <span>{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSpeakMessage(msg.id, msg.content)}
                          aria-label={speakingMsgId === msg.id ? 'Stop reading aloud' : 'Read aloud'}
                          className="min-h-[36px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
                        >
                          {speakingMsgId === msg.id ? (
                            <VolumeX className="w-3.5 h-3.5 text-rose-500" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5" />
                          )}
                          <span>{speakingMsgId === msg.id ? 'Stop' : 'Listen'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleShareMessage(msg.content)}
                          aria-label="Share response"
                          className="min-h-[36px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Share</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {msg.isStreaming && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                  <div
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-[22px] border px-4 py-3 text-sm text-slate-500 dark:text-slate-400"
                  >
                    Thinking...
                  </div>
                )}

                {msg.error && (
                  <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="break-words">{msg.error}</span>
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
              </motion.div>
            );
          })}
        </div>

        {/* Interactive Write-Action Confirmation Gate */}
        <AnimatePresence>
          {pendingApproval && (
            <WriteApprovalBanner
              key={pendingApproval.toolCallId}
              approval={pendingApproval}
              onDecision={(decision) => {
                triggerHaptic(settings.hapticsEnabled, decision === 'deny' ? 'warning' : 'success');
                resolvePendingApproval(decision);
              }}
            />
          )}
        </AnimatePresence>

        {speechNotice && (
          <div className="px-4 pb-1 text-center text-xs text-slate-500 dark:text-slate-400">
            {speechNotice}
          </div>
        )}

        {/* Pixel Material 3 Pill Composer with Voice Mic & Expressive FAB */}
        <form
          onSubmit={handleSend}
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="shrink-0 px-3 sm:px-6 py-2.5"
        >
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container-high)',
              borderColor: 'var(--m3-outline)',
            }}
            className="max-w-2xl mx-auto flex items-end gap-1.5 p-1.5 rounded-[28px] border shadow-xs"
          >
            <button
              type="button"
              onClick={handleToggleVoiceDictation}
              aria-label={isListening ? 'Stop voice dictation' : 'Voice dictation'}
              style={
                isListening
                  ? {
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }
                  : undefined
              }
              className={`min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center shrink-0 transition-colors ${
                isListening
                  ? 'animate-pulse'
                  : 'text-slate-500 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
              }`}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

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
              placeholder={isListening ? 'Listening...' : `Ask ${activeAgent.name}...`}
              aria-label="Chat message input"
              className="flex-1 min-h-[44px] max-h-32 px-2 py-2.5 bg-transparent text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 resize-none focus:outline-none"
            />

            {isRunning ? (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(settings.hapticsEnabled, 'warning');
                  stopRun();
                }}
                aria-label="Stop generation"
                className="min-h-[44px] min-w-[44px] px-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-medium text-sm inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
                style={
                  input.trim()
                    ? {
                        backgroundColor: 'var(--m3-primary)',
                        color: 'var(--m3-on-primary)',
                      }
                    : undefined
                }
                className="min-h-[44px] min-w-[44px] rounded-full disabled:bg-slate-300/60 dark:disabled:bg-slate-700/60 disabled:text-slate-400 flex items-center justify-center shrink-0 transition-all active:scale-95"
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
        dynamicModels={dynamicModels}
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
