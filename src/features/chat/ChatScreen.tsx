import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUp,
  BookOpen,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  History,
  Info,
  Maximize2,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  Paperclip,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import { getModelById } from '../../config/models';
import { buildAgentToolCatalog } from '../../services/llm/agentLoop';
import { DEFAULT_STUDY_INSTRUCTIONS, STUDY_INSTRUCTION_PRESETS } from '../../store/defaults';
import { useHubStore } from '../../store/useHubStore';
import type {
  ChatAttachment,
  ChatMessage,
  ChatMode,
  EffortLevel,
  KnowledgeSourceMode,
} from '../../types';
import { MarkdownRenderer } from '../../ui/MarkdownRenderer';
import { ToolCallCard } from '../../ui/ToolCallCard';
import { WriteApprovalBanner } from '../../ui/WriteApprovalBanner';
import { formatFileSize, processUploadedFiles } from '../../utils/attachments';
import { triggerHaptic } from '../../utils/haptics';
import { M3_EMPHASIZED_EASE } from '../../utils/motion';
import { AgentModelSwitcherSheet } from './AgentModelSwitcherSheet';
import { HistoryListContent, HistorySheet } from './HistorySheet';
import { StudyReaderModal } from './StudyReaderModal';

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

const CHAT_MODE_CONFIG: Array<{
  id: ChatMode;
  label: string;
  shortDesc: string;
  Icon: typeof MessageCircle;
}> = [
  {
    id: 'general',
    label: 'General',
    shortDesc: 'Normal chat · MCP off',
    Icon: MessageCircle,
  },
  {
    id: 'professional',
    label: 'Professional',
    shortDesc: 'Connected MCP tools active',
    Icon: Briefcase,
  },
  {
    id: 'study',
    label: 'Study Session',
    shortDesc: 'Structured notes · MCP off',
    Icon: BookOpen,
  },
];

const KNOWLEDGE_SOURCE_OPTIONS: Array<{
  id: KnowledgeSourceMode;
  label: string;
  hint: string;
  Icon: typeof Sparkles;
}> = [
  { id: 'auto', label: 'Auto', hint: 'Smart default', Icon: Sparkles },
  { id: 'uploaded', label: 'Uploaded Source', hint: 'Use attached files/pics', Icon: Upload },
  { id: 'web', label: 'Web Search', hint: 'Live web grounding', Icon: Globe },
  { id: 'general', label: 'AI Knowledge', hint: 'Model knowledge', Icon: BookOpen },
];

const STARTER_PROMPTS_BY_MODE: Record<
  ChatMode,
  Array<{ label: string; prompt: string }>
> = {
  general: [
    {
      label: 'Plan my week clearly',
      prompt: 'Help me organize a calm, realistic weekly routine for deep work and rest.',
    },
    {
      label: 'Draft a crisp message',
      prompt: 'Write a polite, clear email following up on a project timeline update.',
    },
    {
      label: 'Brainstorm weekend ideas',
      prompt: 'Give me 5 creative low-cost ways to spend a relaxing Sunday.',
    },
  ],
  professional: [
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
  ],
  study: [
    {
      label: 'Master a topic step-by-step',
      prompt: 'Teach me how Transformer self-attention works from intuition to math.',
    },
    {
      label: 'Turn notes into flashcards',
      prompt: 'Summarize the attached file or topic into high-yield revision notes and self-check questions.',
    },
    {
      label: 'Compare two concepts deeply',
      prompt: 'Explain the difference between TCP and UDP with real-world analogies and a quick quiz.',
    },
  ],
};

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
    setChatMode,
    setKnowledgeSource,
    setStudyInstructions,
  } = useHubStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [studyPanelExpanded, setStudyPanelExpanded] = useState(false);
  const [readerMessage, setReaderMessage] = useState<ChatMessage | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechTimerRef = useRef<number | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeAgent = agents.find((a) => a.id === activeConv?.agentId) ?? agents[0];
  const activeModel = getModelById(activeConv?.modelId ?? activeAgent.defaultModelId, dynamicModels);
  const activeEffort: EffortLevel = activeConv?.effort ?? activeAgent.defaultEffort;
  const activeChatMode: ChatMode = activeConv?.chatMode ?? 'professional';
  const activeKnowledgeSource: KnowledgeSourceMode = activeConv?.knowledgeSource ?? 'auto';
  const activeStudyInstructions = activeConv?.studyInstructions ?? DEFAULT_STUDY_INSTRUCTIONS;

  const { tools } = buildAgentToolCatalog(activeAgent, servers);
  const activeToolsCount = activeChatMode === 'professional' ? tools.length : 0;
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

  const handleFilesSelected = async (files: FileList | File[]) => {
    setUploadError('');
    const { attachments: parsed, errors } = await processUploadedFiles(files);
    if (errors.length > 0) {
      setUploadError(errors.join(' '));
    }
    if (parsed.length > 0) {
      setAttachments((prev) => [...prev, ...parsed].slice(0, 4));
      if (activeKnowledgeSource === 'auto') {
        setKnowledgeSource('uploaded');
      }
      triggerHaptic(settings.hapticsEnabled, 'light');
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isRunning) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    const msg = input;
    const currentAttachments = attachments;
    setInput('');
    setAttachments([]);
    setUploadError('');
    setStudyPanelExpanded(false);
    triggerHaptic(settings.hapticsEnabled, 'light');
    await sendMessage(msg, { attachments: currentAttachments });
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

  const starterPrompts = STARTER_PROMPTS_BY_MODE[activeChatMode];

  return (
    <div
      style={{ backgroundColor: 'var(--m3-surface)' }}
      className="flex h-full min-h-0"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer?.files?.length) {
          void handleFilesSelected(e.dataTransfer.files);
        }
      }}
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
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {isDragging && (
          <div className="absolute inset-3 z-30 rounded-[28px] border-2 border-dashed border-blue-500 bg-blue-500/10 backdrop-blur-xs flex items-center justify-center pointer-events-none">
            <div className="px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 shadow-lg text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-blue-500" />
              Drop images or study files to attach
            </div>
          </div>
        )}

        {/* Top Bar: Agent / Model / Effort + History / New Chat */}
        <header
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="shrink-0 px-2.5 sm:px-5 py-2 border-b space-y-2 pt-safe"
        >
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
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
                <span className="max-w-[76px] sm:max-w-[140px] truncate">{activeAgent.name}</span>
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
                <span className="max-w-[82px] sm:max-w-[170px] truncate">{activeModel.label}</span>
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
                className="lg:hidden min-h-[42px] min-w-[40px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              >
                <History className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => startNewConversation(activeAgent.id, activeModel.id)}
                aria-label="New conversation"
                className="min-h-[42px] min-w-[40px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              >
                <MessageSquarePlus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 3-Option Chat Mode Bar: General | Professional (MCP) | Study Session */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="Chat mode"
              style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
              className="inline-flex items-center gap-1 p-1 rounded-full max-w-full overflow-x-auto no-scrollbar"
            >
              {CHAT_MODE_CONFIG.map(({ id, label, Icon }) => {
                const active = activeChatMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`chat-mode-${id}`}
                    onClick={() => {
                      triggerHaptic(settings.hapticsEnabled, 'light');
                      setChatMode(id);
                      if (id === 'study' && !activeConv?.messages.length) {
                        setStudyPanelExpanded(true);
                      }
                    }}
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                          }
                        : undefined
                    }
                    className={`min-h-[34px] px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      active ? 'shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                    {id === 'professional' && (
                      <span className="text-[10px] opacity-80 font-mono">({tools.length})</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {activeChatMode === 'professional' ? (
                <span>MCP tools enabled ({activeToolsCount})</span>
              ) : (
                <span>MCP tools paused in {activeChatMode === 'study' ? 'Study Session' : 'General'}</span>
              )}
            </div>
          </div>

          {/* Study Session Response Instructions Bar */}
          {activeChatMode === 'study' && (
            <div
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-2xl border px-3 py-2 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStudyPanelExpanded((v) => !v)}
                  aria-expanded={studyPanelExpanded}
                  className="flex items-center gap-2 min-w-0 text-left flex-1"
                >
                  <SlidersHorizontal
                    style={{ color: 'var(--m3-primary)' }}
                    className="w-3.5 h-3.5 shrink-0"
                  />
                  <span className="text-xs font-semibold text-slate-900 dark:text-white shrink-0">
                    Study Response Instructions
                  </span>
                  {!studyPanelExpanded && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {activeStudyInstructions.replace(/\n+/g, ' · ')}
                    </span>
                  )}
                  {studyPanelExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-400 shrink-0 ml-auto" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-auto" />
                  )}
                </button>
              </div>

              {studyPanelExpanded && (
                <div className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-800">
                  <div className="flex flex-wrap gap-1.5">
                    {STUDY_INSTRUCTION_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setStudyInstructions(preset.instructions);
                          triggerHaptic(settings.hapticsEnabled, 'light');
                        }}
                        style={{
                          backgroundColor: 'var(--m3-surface-container-high)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="min-h-[30px] px-2.5 rounded-full border text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:opacity-90"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="study-instructions-input" className="sr-only">
                    Response structure instructions for Study Session
                  </label>
                  <textarea
                    id="study-instructions-input"
                    data-testid="study-instructions-textarea"
                    rows={3}
                    value={activeStudyInstructions}
                    onChange={(e) => setStudyInstructions(e.target.value)}
                    placeholder="Define the exact structure the AI must follow (e.g., 1. Overview, 2. Analogies, 3. Practice Quiz)..."
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="w-full p-2.5 rounded-xl border text-xs leading-relaxed text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          )}
        </header>

        {/* Scrollable Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
          {(!activeConv || activeConv.messages.length === 0) && (
            <div className="max-w-xl mx-auto py-6 sm:py-12 text-center space-y-5">
              <div
                style={{
                  backgroundColor: 'var(--m3-primary-container)',
                  color: 'var(--m3-on-primary-container)',
                }}
                className="w-14 h-14 rounded-[20px] flex items-center justify-center mx-auto shadow-xs"
              >
                {activeChatMode === 'study' ? (
                  <BookOpen className="w-6 h-6" />
                ) : activeChatMode === 'general' ? (
                  <MessageCircle className="w-6 h-6" />
                ) : (
                  <Wrench className="w-6 h-6" />
                )}
              </div>
              <div className="space-y-1.5">
                <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white text-balance">
                  {activeChatMode === 'study'
                    ? 'Study Session Ready'
                    : activeChatMode === 'general'
                      ? 'Everyday Chat'
                      : `${activeAgent.name} is ready`}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeModel.label} ·{' '}
                  {activeChatMode === 'professional'
                    ? `${activeToolsCount} active MCP tool${activeToolsCount === 1 ? '' : 's'}`
                    : activeChatMode === 'study'
                      ? 'MCPs paused · Click any answer to open Study Reader'
                      : 'MCPs paused · Direct conversation'}{' '}
                  · <span className="capitalize">{activeEffort}</span> effort
                </p>
              </div>

              <div className="flex flex-col gap-2.5 text-left pt-1 w-full min-w-0">
                {starterPrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setStudyPanelExpanded(false);
                      void sendMessage(item.prompt);
                    }}
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
                  className="max-w-2xl mx-auto flex flex-col items-end gap-1.5"
                >
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-2 max-w-[85%]">
                      {msg.attachments.map((att) =>
                        att.kind === 'image' && att.previewUrl ? (
                          <img
                            key={att.id}
                            src={att.previewUrl}
                            alt={att.name}
                            className="w-28 h-28 object-cover rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs"
                          />
                        ) : (
                          <span
                            key={att.id}
                            style={{
                              backgroundColor: 'var(--m3-surface-container-high)',
                              borderColor: 'var(--m3-outline)',
                            }}
                            className="px-3 py-1.5 rounded-xl border text-xs text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[160px]">{att.name}</span>
                          </span>
                        )
                      )}
                    </div>
                  )}
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

            const isStudyResponse = (msg.chatMode ?? activeChatMode) === 'study';

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
                    <article
                      data-testid="assistant-response-card"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, a')) return;
                        if (isStudyResponse && msg.content.trim()) {
                          setReaderMessage(msg);
                        }
                      }}
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
                        borderColor: isStudyResponse ? 'var(--m3-primary)' : 'var(--m3-outline)',
                      }}
                      className={`rounded-[22px] border px-4 py-3 transition-shadow ${
                        isStudyResponse ? 'cursor-pointer hover:shadow-md' : ''
                      }`}
                    >
                      {isStudyResponse && !msg.isStreaming && (
                        <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-200/60 dark:border-slate-800">
                          <span
                            style={{ color: 'var(--m3-primary)' }}
                            className="text-[11px] font-semibold inline-flex items-center gap-1"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                            Study Note · Tap anywhere to read comfortably
                          </span>
                          <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                      )}

                      <MarkdownRenderer content={msg.content} />

                      {msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
                            Sources:
                          </span>
                          {msg.citations.map((c) => (
                            <a
                              key={c.url}
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                backgroundColor: 'var(--m3-surface-container-high)',
                                borderColor: 'var(--m3-outline)',
                              }}
                              className="px-2.5 py-1 rounded-full border text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 hover:opacity-85"
                            >
                              <span className="truncate max-w-[160px]">{c.title}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ))}
                        </div>
                      )}
                    </article>

                    {/* Pixel Assistant quick action bar */}
                    {!msg.isStreaming && (
                      <div className="flex flex-wrap items-center gap-1 px-1">
                        <button
                          type="button"
                          onClick={() => setReaderMessage(msg)}
                          data-testid="open-study-reader-btn"
                          style={
                            isStudyResponse
                              ? {
                                  backgroundColor: 'var(--m3-primary-container)',
                                  color: 'var(--m3-on-primary-container)',
                                }
                              : undefined
                          }
                          className={`min-h-[34px] px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                            isStudyResponse
                              ? ''
                              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>Study Reader</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(msg.id, msg.content)}
                          aria-label="Copy response"
                          className="min-h-[34px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
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
                          className="min-h-[34px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
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
                          className="min-h-[34px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
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

        {/* Composer Area: Knowledge Source Selector + Attachment Previews + Pill Input */}
        <form
          onSubmit={handleSend}
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="shrink-0 px-3 sm:px-6 pt-1 pb-2.5 space-y-2"
        >
          {/* Knowledge Source Selector */}
          <div className="max-w-2xl mx-auto flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 mr-0.5">
              Source:
            </span>
            {KNOWLEDGE_SOURCE_OPTIONS.map(({ id, label, hint, Icon }) => {
              const active = activeKnowledgeSource === id;
              return (
                <button
                  key={id}
                  type="button"
                  title={hint}
                  data-testid={`source-chip-${id}`}
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 'light');
                    setKnowledgeSource(id);
                  }}
                  style={
                    active
                      ? {
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                          borderColor: 'var(--m3-primary)',
                        }
                      : {
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }
                  }
                  className="min-h-[30px] px-2.5 rounded-full border text-[11px] font-medium inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {uploadError && (
            <div className="max-w-2xl mx-auto text-xs text-rose-600 dark:text-rose-400 px-2">
              {uploadError}
            </div>
          )}

          {/* Attached Files & Images Preview Strip */}
          {attachments.length > 0 && (
            <div className="max-w-2xl mx-auto flex flex-wrap gap-2 px-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  style={{
                    backgroundColor: 'var(--m3-surface-container-high)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="relative flex items-center gap-2 rounded-2xl border pl-2 pr-1.5 py-1.5 text-xs text-slate-800 dark:text-slate-200"
                >
                  {att.kind === 'image' && att.previewUrl ? (
                    <img
                      src={att.previewUrl}
                      alt={att.name}
                      className="w-8 h-8 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <div className="min-w-0 max-w-[140px]">
                    <div className="truncate font-medium">{att.name}</div>
                    <div className="text-[10px] text-slate-500">{formatFileSize(att.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    aria-label={`Remove ${att.name}`}
                    className="min-h-[26px] min-w-[26px] rounded-full flex items-center justify-center text-slate-500 hover:text-rose-600 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.pdf,.py,.js,.ts,.tsx,.jsx,.html,.css,.sql,.log"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                void handleFilesSelected(e.target.files);
                e.target.value = '';
              }
            }}
          />

          <div
            style={{
              backgroundColor: 'var(--m3-surface-container-high)',
              borderColor: 'var(--m3-outline)',
            }}
            className="max-w-2xl mx-auto flex items-end gap-1 p-1.5 rounded-[28px] border shadow-xs"
          >
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload picture or file"
              title="Attach pics or files (max 5 MB)"
              className="min-h-[44px] min-w-[44px] rounded-full flex items-center justify-center shrink-0 text-slate-500 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
            >
              <Paperclip className="w-5 h-5" />
            </button>

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
              ref={composerRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length > 0) {
                  void handleFilesSelected(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                isListening
                  ? 'Listening...'
                  : activeChatMode === 'study'
                    ? 'Ask a study question...'
                    : activeChatMode === 'general'
                      ? 'Message directly...'
                      : `Ask ${activeAgent.name}...`
              }
              aria-label="Chat message input"
              className="flex-1 min-h-[44px] max-h-32 px-2 py-2.5 leading-[22px] bg-transparent text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 resize-none focus:outline-none"
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
                disabled={!input.trim() && attachments.length === 0}
                aria-label="Send message"
                style={
                  input.trim() || attachments.length > 0
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

      <AnimatePresence>
        {readerMessage && (
          <StudyReaderModal
            open={Boolean(readerMessage)}
            title={activeConv?.title || 'Study Notes'}
            content={readerMessage.content}
            modelLabel={getModelById(readerMessage.modelId ?? activeModel.id, dynamicModels).label}
            citations={readerMessage.citations}
            onClose={() => setReaderMessage(null)}
            onAskFollowUp={() => {
              setInput('Follow-up question on the previous study notes: ');
              setTimeout(() => composerRef.current?.focus(), 60);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
