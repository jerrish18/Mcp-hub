import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUp,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  ExternalLink,
  FileText,
  Globe,
  HelpCircle,
  History,
  Info,
  Layers,
  Maximize2,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  Upload,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from 'lucide-react';
import { getModelById, getShortModelName } from '../../config/models';
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
import { stripMarkdownForSpeech } from '../../utils/markdownParser';
import { M3_EMPHASIZED_EASE } from '../../utils/motion';
import {
  buildFlashcardsGenerationPrompt,
  buildQuickStudyActionPrompt,
  buildQuizGenerationPrompt,
  extractFlashcardsFromMarkdown,
  extractQuizFromMarkdown,
  type StudyFlashcard,
  type StudyQuizQuestion,
} from '../../utils/studyTools';
import { AgentSwitcherSheet } from './AgentSwitcherSheet';
import { HistoryListContent, HistorySheet } from './HistorySheet';
import { ModelSwitcherSheet } from './ModelSwitcherSheet';
import { SavedNotesModal } from './SavedNotesModal';
import { StudyFlashcardsModal } from './StudyFlashcardsModal';
import { StudyQuizModal } from './StudyQuizModal';
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
  Icon: typeof MessageCircle;
}> = [
  { id: 'general', label: 'General', Icon: MessageCircle },
  { id: 'professional', label: 'Pro', Icon: Briefcase },
  { id: 'study', label: 'Study', Icon: BookOpen },
];

const KNOWLEDGE_SOURCE_OPTIONS: Array<{
  id: KnowledgeSourceMode;
  label: string;
  shortLabel: string;
  hint: string;
  Icon: typeof Sparkles;
}> = [
  { id: 'auto', label: 'Auto', shortLabel: 'Auto', hint: 'Smart source selection', Icon: Sparkles },
  {
    id: 'uploaded',
    label: 'Uploaded Source',
    shortLabel: 'Uploaded',
    hint: 'Ground answers in attached files or images',
    Icon: Upload,
  },
  {
    id: 'web',
    label: 'Web Search',
    shortLabel: 'Web',
    hint: 'Live Google Search citations',
    Icon: Globe,
  },
  {
    id: 'general',
    label: 'AI Knowledge',
    shortLabel: 'AI Knowledge',
    hint: 'Pure reasoning & model knowledge',
    Icon: BookOpen,
  },
];

const STARTER_PROMPTS_BY_MODE: Record<ChatMode, Array<{ label: string; prompt: string }>> = {
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
      label: 'Generate a practice quiz',
      prompt: 'Create a quick quiz to test my intuition on gradient descent and backpropagation.',
    },
    {
      label: 'Make active-recall flashcards',
      prompt: 'Create flashcards comparing TCP and UDP with memory hooks.',
    },
  ],
};

function formatPomodoroTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function ChatScreen({ onOpenSettings }: ChatScreenProps) {
  const {
    agents,
    servers,
    conversations,
    activeConversationId,
    providerKeys,
    dynamicModels,
    settings,
    savedStudyNotes,
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
    saveStudyNote,
    removeSavedStudyNote,
  } = useHubStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Separate sheets for Models vs Agents
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  // Study Suite state
  const [studyPlanOpen, setStudyPlanOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [readerState, setReaderState] = useState<{
    title: string;
    content: string;
    modelLabel?: string;
    citations?: ChatMessage['citations'];
  } | null>(null);
  const [flashcardsState, setFlashcardsState] = useState<{
    title: string;
    cards: StudyFlashcard[];
    sourceText: string;
  } | null>(null);
  const [quizState, setQuizState] = useState<{
    title: string;
    questions: StudyQuizQuestion[];
    sourceText: string;
  } | null>(null);

  // Pomodoro Focus Timer (25 min Focus / 5 min Break)
  const [focusPhase, setFocusPhase] = useState<'focus' | 'break'>('focus');
  const [focusSecondsLeft, setFocusSecondsLeft] = useState(25 * 60);
  const [focusRunning, setFocusRunning] = useState(false);

  // Voice & Message feedback
  const [isListening, setIsListening] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechTimerRef = useRef<number | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeAgent = agents.find((a) => a.id === activeConv?.agentId) ?? agents[0];
  const activeModel = getModelById(activeConv?.modelId ?? activeAgent.defaultModelId, dynamicModels);
  const activeModelShort = getShortModelName(activeModel);
  const activeEffort: EffortLevel = activeConv?.effort ?? activeAgent.defaultEffort;
  const activeChatMode: ChatMode = activeConv?.chatMode ?? 'professional';
  const activeKnowledgeSource: KnowledgeSourceMode = activeConv?.knowledgeSource ?? 'auto';
  const activeStudyInstructions = activeConv?.studyInstructions ?? DEFAULT_STUDY_INSTRUCTIONS;

  const activeSourceOption =
    KNOWLEDGE_SOURCE_OPTIONS.find((o) => o.id === activeKnowledgeSource) ??
    KNOWLEDGE_SOURCE_OPTIONS[0];

  const { tools } = buildAgentToolCatalog(activeAgent, servers);
  const activeToolsCount = activeChatMode === 'professional' ? tools.length : 0;
  const lastMsg = activeConv?.messages[activeConv.messages.length - 1];

  const savedByMessageId = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of savedStudyNotes) {
      if (note.messageId) map.set(note.messageId, note.id);
    }
    return map;
  }, [savedStudyNotes]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    activeConv?.messages.length,
    lastMsg?.content,
    lastMsg?.isStreaming,
    lastMsg?.toolCalls?.length,
    lastMsg?.error,
  ]);

  useEffect(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    setSourceMenuOpen(false);
  }, [activeConversationId]);

  useEffect(() => {
    if (!focusRunning) return;
    const timer = window.setInterval(() => {
      setFocusSecondsLeft((prev) => {
        if (prev <= 1) {
          const nextPhase = focusPhase === 'focus' ? 'break' : 'focus';
          setFocusPhase(nextPhase);
          setFocusRunning(false);
          triggerHaptic(settings.hapticsEnabled, 'success');
          return nextPhase === 'focus' ? 25 * 60 : 5 * 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [focusRunning, focusPhase, settings.hapticsEnabled]);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    const handlePointerDown = (ev: MouseEvent) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(ev.target as Node)) {
        setSourceMenuOpen(false);
      }
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setSourceMenuOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [sourceMenuOpen]);

  useEffect(() => {
    return () => {
      if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
      recognitionRef.current?.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleFilesSelected = async (files: FileList | File[]) => {
    setUploadError('');
    const { attachments: parsed, errors } = await processUploadedFiles(files);
    if (errors.length > 0) setUploadError(errors.join(' '));
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
    setStudyPlanOpen(false);
    setSourceMenuOpen(false);
    triggerHaptic(settings.hapticsEnabled, 'light');
    await sendMessage(msg, { attachments: currentAttachments });
  };

  const handleQuickPrompt = async (promptText: string, displayText?: string) => {
    if (isRunning) return;
    setStudyPlanOpen(false);
    setSourceMenuOpen(false);
    triggerHaptic(settings.hapticsEnabled, 'light');
    await sendMessage(promptText, displayText ? { displayText } : undefined);
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
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(content));
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  const handleShareMessage = async (content: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'MCP Hub Study Notes', text: content });
        return;
      } catch {
        // user cancelled share sheet
      }
    }
    await navigator.clipboard?.writeText(content);
  };

  const openFlashcardsFromText = (title: string, markdownText: string) => {
    const cards = extractFlashcardsFromMarkdown(markdownText);
    setFlashcardsState({
      title,
      cards,
      sourceText: markdownText,
    });
  };

  const openQuizFromText = (title: string, markdownText: string) => {
    const questions = extractQuizFromMarkdown(markdownText);
    setQuizState({
      title,
      questions,
      sourceText: markdownText,
    });
  };

  const starterPrompts = STARTER_PROMPTS_BY_MODE[activeChatMode];

  // Find index of latest non-streaming study response for quick follow-up chips
  const lastAssistantIdx = useMemo(() => {
    const msgs = activeConv?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && !msgs[i].isStreaming && msgs[i].content.trim()) {
        return i;
      }
    }
    return -1;
  }, [activeConv?.messages]);

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

        {/* Clean 2-Row Mobile-First Header (Models completely separate from Agents) */}
        <header
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="shrink-0 px-3 sm:px-6 py-2 border-b space-y-2 pt-safe"
        >
          {/* Row 1: Primary Model Picker | Separate Agent Picker | History + New Chat */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <button
                type="button"
                data-testid="model-picker-btn"
                onClick={() => setModelSheetOpen(true)}
                aria-label={`Model: ${activeModelShort}, switch model`}
                className="min-h-[38px] px-2.5 sm:px-3 py-1 rounded-2xl text-sm font-display font-semibold text-slate-950 dark:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800/80 inline-flex items-center gap-1.5 whitespace-nowrap min-w-0 transition-colors"
              >
                {activeModel.provider === 'gemini' ? (
                  <Sparkles style={{ color: 'var(--m3-primary)' }} className="w-4 h-4 shrink-0" />
                ) : (
                  <Cpu style={{ color: 'var(--m3-primary)' }} className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate max-w-[128px] sm:max-w-[220px]">{activeModelShort}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              <span className="text-slate-300 dark:text-slate-700 shrink-0 select-none" aria-hidden="true">
                /
              </span>

              <button
                type="button"
                data-testid="agent-picker-btn"
                onClick={() => setAgentSheetOpen(true)}
                aria-label={`Agent: ${activeAgent.name}, switch agent`}
                style={{
                  backgroundColor: 'var(--m3-surface-container-high)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[34px] px-2.5 py-1 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap min-w-0 transition-opacity hover:opacity-90"
              >
                <span className="truncate max-w-[92px] sm:max-w-[150px]">{activeAgent.name}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
              </button>
            </div>

            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-label="Open chat history"
                className="lg:hidden min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              >
                <History className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => startNewConversation(activeAgent.id, activeModel.id)}
                aria-label="New conversation"
                className="min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
              >
                <MessageSquarePlus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Row 2: Mode Segmented Tabs (left) + Effort / Study Tools (wraps cleanly on narrow mobile) */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2">
            <div
              role="tablist"
              aria-label="Chat mode"
              style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
              className="inline-flex items-center gap-0.5 p-0.5 rounded-full shrink-0"
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
                    }}
                    style={
                      active
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                          }
                        : undefined
                    }
                    className={`min-h-[32px] px-2.5 sm:px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                      active
                        ? 'shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{label}</span>
                    {id === 'professional' && (
                      <span className="text-[10px] opacity-75 font-mono tabular-nums">
                        {tools.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeChatMode === 'study' && (
                <>
                  {/* Compact Pomodoro Timer */}
                  <div
                    style={{
                      backgroundColor: focusRunning
                        ? 'var(--m3-primary-container)'
                        : 'var(--m3-surface-container-high)',
                      borderColor: 'var(--m3-outline)',
                      color: focusRunning ? 'var(--m3-on-primary-container)' : undefined,
                    }}
                    className="min-h-[32px] px-2 rounded-full border inline-flex items-center gap-1 text-[11px] font-medium tabular-nums shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(settings.hapticsEnabled, 'light');
                        setFocusRunning((r) => !r);
                      }}
                      aria-label={focusRunning ? 'Pause focus timer' : 'Start 25m focus timer'}
                      className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200"
                    >
                      <Timer className="w-3.5 h-3.5 shrink-0" />
                      <span>{formatPomodoroTime(focusSecondsLeft)}</span>
                      {focusRunning ? (
                        <Pause className="w-3 h-3 shrink-0" />
                      ) : (
                        <Play className="w-3 h-3 shrink-0" />
                      )}
                    </button>
                    {focusSecondsLeft !== (focusPhase === 'focus' ? 25 * 60 : 5 * 60) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFocusRunning(false);
                          setFocusPhase('focus');
                          setFocusSecondsLeft(25 * 60);
                        }}
                        aria-label="Reset focus timer"
                        className="p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Saved Study Vault */}
                  <button
                    type="button"
                    data-testid="study-vault-btn"
                    onClick={() => setVaultOpen(true)}
                    aria-label={`Saved study notes (${savedStudyNotes.length})`}
                    style={{
                      backgroundColor: 'var(--m3-surface-container-high)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Vault</span>
                    {savedStudyNotes.length > 0 && (
                      <span className="text-[11px] font-mono tabular-nums opacity-80">
                        {savedStudyNotes.length}
                      </span>
                    )}
                  </button>

                  {/* Study Plan Preset Toggle */}
                  <button
                    type="button"
                    data-testid="study-plan-btn"
                    onClick={() => setStudyPlanOpen((v) => !v)}
                    aria-expanded={studyPlanOpen}
                    style={
                      studyPlanOpen
                        ? {
                            backgroundColor: 'var(--m3-primary-container)',
                            color: 'var(--m3-on-primary-container)',
                            borderColor: 'var(--m3-primary)',
                          }
                        : {
                            backgroundColor: 'var(--m3-surface-container-high)',
                            borderColor: 'var(--m3-outline)',
                          }
                    }
                    className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Style</span>
                    {studyPlanOpen ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </>
              )}

              {/* Effort Cycle Chip */}
              <button
                type="button"
                onClick={handleCycleEffort}
                aria-label={`Reasoning effort: ${activeEffort}, tap to cycle`}
                data-testid="effort-chip"
                style={{
                  backgroundColor: 'var(--m3-surface-container-high)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium capitalize text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 hover:opacity-90"
              >
                {activeEffort}
              </button>
            </div>
          </div>

          {/* Collapsible Study Style & Response Structure Drawer */}
          {activeChatMode === 'study' && studyPlanOpen && (
            <div
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-2xl border p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  Study Teaching Method & Response Structure
                </span>
                <button
                  type="button"
                  onClick={() => setStudyPlanOpen(false)}
                  aria-label="Close study style panel"
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  Done
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {STUDY_INSTRUCTION_PRESETS.map((preset) => {
                  const isActive = activeStudyInstructions.trim() === preset.instructions.trim();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.shortHint}
                      onClick={() => {
                        setStudyInstructions(preset.instructions);
                        triggerHaptic(settings.hapticsEnabled, 'light');
                      }}
                      style={
                        isActive
                          ? {
                              backgroundColor: 'var(--m3-primary-container)',
                              color: 'var(--m3-on-primary-container)',
                              borderColor: 'var(--m3-primary)',
                            }
                          : {
                              backgroundColor: 'var(--m3-surface-container-high)',
                              borderColor: 'var(--m3-outline)',
                            }
                      }
                      className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 hover:opacity-90"
                    >
                      {preset.label}
                    </button>
                  );
                })}
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
                placeholder="Define the exact teaching style & structure..."
                style={{
                  backgroundColor: 'var(--m3-surface-container)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="w-full p-2.5 rounded-xl border text-xs leading-relaxed text-slate-900 dark:text-slate-100"
              />
            </div>
          )}
        </header>

        {/* Scrollable Editorial Message Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-5 space-y-6">
          {(!activeConv || activeConv.messages.length === 0) && (
            <div className="max-w-xl mx-auto py-8 sm:py-14 text-center space-y-6">
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
                <h1 className="font-display text-2xl font-bold text-slate-950 dark:text-white text-balance">
                  {activeChatMode === 'study'
                    ? 'What do you want to master?'
                    : activeChatMode === 'general'
                      ? 'How can I help today?'
                      : `${activeAgent.name} is ready`}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {activeModelShort} ·{' '}
                  {activeChatMode === 'professional'
                    ? `${activeToolsCount} active MCP tool${activeToolsCount === 1 ? '' : 's'}`
                    : activeChatMode === 'study'
                      ? 'Study Mode with Flashcards, Quizzes & Reader'
                      : 'Direct conversation'}
                </p>
              </div>

              {activeChatMode === 'study' && (
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {STUDY_INSTRUCTION_PRESETS.slice(0, 4).map((preset) => {
                    const selected = activeStudyInstructions.trim() === preset.instructions.trim();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setStudyInstructions(preset.instructions);
                          triggerHaptic(settings.hapticsEnabled, 'light');
                        }}
                        style={
                          selected
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
                        className="min-h-[34px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-2 text-left w-full min-w-0">
                {starterPrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => void handleQuickPrompt(item.prompt)}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="w-full min-w-0 min-h-[52px] px-4 py-3 rounded-2xl border text-sm text-slate-800 dark:text-slate-200 transition-transform active:scale-[0.99] overflow-hidden"
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

          {activeConv?.messages.map((msg, msgIdx) => {
            if (msg.role === 'system_notice') {
              return (
                <div
                  key={msg.id}
                  data-testid="fallback-notice"
                  style={{
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }}
                  className="max-w-3xl mx-auto rounded-2xl px-3.5 py-2.5 text-xs flex items-center gap-2"
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
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={M3_EMPHASIZED_EASE}
                  className="max-w-3xl mx-auto flex flex-col items-end gap-1.5"
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
                    className="max-w-[86%] rounded-[22px] rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed shadow-xs"
                  >
                    {msg.displayContent ?? msg.content}
                  </div>
                </motion.div>
              );
            }

            const isStudyResponse = (msg.chatMode ?? activeChatMode) === 'study';
            const msgModel = getModelById(msg.modelId ?? activeModel.id, dynamicModels);
            const msgModelShort = getShortModelName(msgModel);
            const savedNoteId = savedByMessageId.get(msg.id);
            const isLatestCompleted = msgIdx === lastAssistantIdx;

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={M3_EMPHASIZED_EASE}
                className="max-w-3xl mx-auto space-y-2.5"
              >
                {/* Quiet Editorial Attribution Line (never static pill sandwiches) */}
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <Sparkles
                      style={{ color: 'var(--m3-primary)' }}
                      className="w-3.5 h-3.5 shrink-0"
                    />
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {activeAgent.name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{msgModelShort}</span>
                  </div>

                  {isStudyResponse && msg.content.trim() && !msg.isStreaming && (
                    <button
                      type="button"
                      onClick={() =>
                        setReaderState({
                          title: activeConv?.title || 'Study Notes',
                          content: msg.content,
                          modelLabel: msgModelShort,
                          citations: msg.citations,
                        })
                      }
                      className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white inline-flex items-center gap-1 shrink-0"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span>Focus Read</span>
                    </button>
                  )}
                </div>

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
                  <div className="space-y-3">
                    {/* Open, uncluttered ChatGPT/Gemini/Claude editorial prose (no outer card box!) */}
                    <article
                      data-testid="assistant-response-card"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, a, pre, code, table, summary, details')) return;
                        if (isStudyResponse && !msg.isStreaming && msg.content.trim()) {
                          setReaderState({
                            title: activeConv?.title || 'Study Notes',
                            content: msg.content,
                            modelLabel: msgModelShort,
                            citations: msg.citations,
                          });
                        }
                      }}
                      className={`min-w-0 ${isStudyResponse && !msg.isStreaming ? 'cursor-pointer' : ''}`}
                    >
                      <MarkdownRenderer
                        content={msg.content}
                        onOpenInteractiveFlashcards={() =>
                          openFlashcardsFromText(activeConv?.title || 'Flashcards', msg.content)
                        }
                        onOpenInteractiveQuiz={() =>
                          openQuizFromText(activeConv?.title || 'Practice Quiz', msg.content)
                        }
                      />

                      {msg.citations && msg.citations.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
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
                                backgroundColor: 'var(--m3-surface-container)',
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

                    {/* Clean Compact Response Action Bar */}
                    {!msg.isStreaming && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {(isStudyResponse || msg.content.length > 260) && (
                          <button
                            type="button"
                            onClick={() =>
                              setReaderState({
                                title: activeConv?.title || 'Study Notes',
                                content: msg.content,
                                modelLabel: msgModelShort,
                                citations: msg.citations,
                              })
                            }
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
                        )}

                        {isStudyResponse && (
                          <>
                            <button
                              type="button"
                              data-testid="open-flashcards-btn"
                              onClick={() =>
                                openFlashcardsFromText(
                                  activeConv?.title || 'Flashcards',
                                  msg.content
                                )
                              }
                              className="min-h-[34px] px-2.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800 inline-flex items-center gap-1 transition-colors"
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span>Flashcards</span>
                            </button>

                            <button
                              type="button"
                              data-testid="open-quiz-btn"
                              onClick={() =>
                                openQuizFromText(activeConv?.title || 'Practice Quiz', msg.content)
                              }
                              className="min-h-[34px] px-2.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800 inline-flex items-center gap-1 transition-colors"
                            >
                              <HelpCircle className="w-3.5 h-3.5" />
                              <span>Quiz Me</span>
                            </button>

                            <button
                              type="button"
                              data-testid="save-study-note-btn"
                              onClick={() => {
                                triggerHaptic(settings.hapticsEnabled, 'light');
                                if (savedNoteId) {
                                  removeSavedStudyNote(savedNoteId);
                                } else {
                                  saveStudyNote({
                                    title: activeConv?.title || 'Study Note',
                                    content: msg.content,
                                    modelLabel: msgModelShort,
                                    messageId: msg.id,
                                  });
                                }
                              }}
                              className="min-h-[34px] px-2.5 rounded-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800 inline-flex items-center gap-1 transition-colors"
                            >
                              {savedNoteId ? (
                                <BookmarkCheck
                                  style={{ color: 'var(--m3-primary)' }}
                                  className="w-3.5 h-3.5"
                                />
                              ) : (
                                <Bookmark className="w-3.5 h-3.5" />
                              )}
                              <span>{savedNoteId ? 'Saved' : 'Save'}</span>
                            </button>
                          </>
                        )}

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

                    {/* One-tap Study Quick Actions on the Latest Study Reply */}
                    {isStudyResponse && isLatestCompleted && !isRunning && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            void handleQuickPrompt(
                              buildQuickStudyActionPrompt('simplify', msg.content),
                              'Explain this much more simply'
                            )
                          }
                          style={{
                            backgroundColor: 'var(--m3-surface-container)',
                            borderColor: 'var(--m3-outline)',
                          }}
                          className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 hover:opacity-85"
                        >
                          Explain simpler
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleQuickPrompt(
                              buildQuickStudyActionPrompt('analogy', msg.content),
                              'Give me vivid real-world analogies for this'
                            )
                          }
                          style={{
                            backgroundColor: 'var(--m3-surface-container)',
                            borderColor: 'var(--m3-outline)',
                          }}
                          className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 hover:opacity-85"
                        >
                          Real-world analogy
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleQuickPrompt(
                              buildQuizGenerationPrompt(msg.content),
                              'Create a 4-question practice quiz from these notes'
                            )
                          }
                          style={{
                            backgroundColor: 'var(--m3-surface-container)',
                            borderColor: 'var(--m3-outline)',
                          }}
                          className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 hover:opacity-85"
                        >
                          Quiz me on this
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleQuickPrompt(
                              buildQuickStudyActionPrompt('takeaways', msg.content),
                              'Turn this into a quick revision cheat sheet'
                            )
                          }
                          style={{
                            backgroundColor: 'var(--m3-surface-container)',
                            borderColor: 'var(--m3-outline)',
                          }}
                          className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 hover:opacity-85"
                        >
                          Cheat sheet
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {msg.isStreaming && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                  <div className="py-2 text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                    <span>Thinking...</span>
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

        {/* Unified Rounded ChatGPT/Gemini Composer with Upward Source Popover */}
        <form
          onSubmit={handleSend}
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="shrink-0 px-3 sm:px-6 pt-1 pb-2.5"
        >
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

          <div className="max-w-3xl mx-auto relative">
            {/* Upward Knowledge Source Popover (Never clips on mobile) */}
            <AnimatePresence>
              {sourceMenuOpen && (
                <motion.div
                  ref={sourceMenuRef}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={M3_EMPHASIZED_EASE}
                  role="menu"
                  aria-label="Choose knowledge source"
                  style={{
                    backgroundColor: 'var(--m3-surface-container-high)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="absolute left-0 bottom-full mb-2 w-72 max-w-[calc(100vw-24px)] rounded-2xl border p-1.5 shadow-xl z-30"
                >
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Answer Knowledge Source
                  </div>
                  {KNOWLEDGE_SOURCE_OPTIONS.map(({ id, label, hint, Icon }) => {
                    const selected = activeKnowledgeSource === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        data-testid={`source-chip-${id}`}
                        onClick={() => {
                          triggerHaptic(settings.hapticsEnabled, 'light');
                          setKnowledgeSource(id);
                          setSourceMenuOpen(false);
                        }}
                        style={
                          selected
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                              }
                            : undefined
                        }
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl text-left flex items-center justify-between gap-2.5 hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className="w-4 h-4 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{label}</div>
                            <div className="text-[11px] opacity-75 truncate">{hint}</div>
                          </div>
                        </div>
                        {selected && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            <div
              style={{
                backgroundColor: 'var(--m3-surface-container-high)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-[26px] border px-3 pt-2.5 pb-2 shadow-xs space-y-2"
            >
              {uploadError && (
                <div className="text-xs text-rose-600 dark:text-rose-400 px-1">{uploadError}</div>
              )}

              {/* Attached Files & Images Preview Strip */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-1">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
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
                      ? 'Ask anything to study, quiz, or outline...'
                      : activeChatMode === 'general'
                        ? 'Message directly...'
                        : `Ask ${activeAgent.name}...`
                }
                aria-label="Chat message input"
                className="w-full min-h-[38px] max-h-36 px-1.5 py-1 leading-[22px] bg-transparent text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 resize-none focus:outline-none"
              />

              {/* Compact Bottom Action Toolbar inside Composer */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Upload picture or file"
                    title="Attach pics or files (max 5 MB)"
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="min-h-[38px] min-w-[38px] rounded-full border flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200 hover:opacity-90 transition-opacity"
                  >
                    <Plus className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    data-testid="source-menu-trigger"
                    onClick={() => setSourceMenuOpen((o) => !o)}
                    aria-expanded={sourceMenuOpen}
                    aria-label={`Knowledge source: ${activeSourceOption.label}`}
                    style={
                      activeKnowledgeSource !== 'auto'
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
                    className="min-h-[38px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <activeSourceOption.Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{activeSourceOption.shortLabel}</span>
                    <ChevronUp className="w-3 h-3 opacity-70 shrink-0" />
                  </button>

                  {activeKnowledgeSource === 'uploaded' && attachments.length === 0 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline truncate"
                    >
                      Attach file
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
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
                    className={`min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      isListening
                        ? 'animate-pulse'
                        : 'text-slate-500 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
                    }`}
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>

                  {isRunning ? (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic(settings.hapticsEnabled, 'warning');
                        stopRun();
                      }}
                      aria-label="Stop generation"
                      className="min-h-[40px] px-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
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
                      className="min-h-[40px] min-w-[40px] rounded-full disabled:bg-slate-300/60 dark:disabled:bg-slate-700/60 disabled:text-slate-400 flex items-center justify-center shrink-0 transition-all active:scale-95"
                    >
                      <ArrowUp className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>

      {/* Dedicated Model Switcher Sheet (Completely Separate from Agents) */}
      <ModelSwitcherSheet
        open={modelSheetOpen}
        onClose={() => setModelSheetOpen(false)}
        dynamicModels={dynamicModels}
        activeModelId={activeModel.id}
        providerKeys={providerKeys}
        onSelectModel={setActiveModel}
        onOpenSettings={onOpenSettings}
      />

      {/* Dedicated Agent & Effort Switcher Sheet */}
      <AgentSwitcherSheet
        open={agentSheetOpen}
        onClose={() => setAgentSheetOpen(false)}
        agents={agents}
        activeAgentId={activeAgent.id}
        activeEffort={activeEffort}
        onSelectAgent={setActiveAgent}
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

      <SavedNotesModal
        open={vaultOpen}
        notes={savedStudyNotes}
        onClose={() => setVaultOpen(false)}
        onOpenReader={(note) =>
          setReaderState({
            title: note.title,
            content: note.content,
            modelLabel: note.modelLabel,
          })
        }
        onOpenFlashcards={(note) => openFlashcardsFromText(note.title, note.content)}
        onDeleteNote={removeSavedStudyNote}
      />

      <AnimatePresence>
        {readerState && (
          <StudyReaderModal
            open={Boolean(readerState)}
            title={readerState.title}
            content={readerState.content}
            modelLabel={readerState.modelLabel}
            citations={readerState.citations}
            onClose={() => setReaderState(null)}
            onAskFollowUp={() => {
              setInput('Follow-up question on the previous study notes: ');
              setTimeout(() => composerRef.current?.focus(), 60);
            }}
            onOpenFlashcards={() => {
              const target = readerState;
              if (target) openFlashcardsFromText(target.title, target.content);
            }}
            onOpenQuiz={() => {
              const target = readerState;
              if (target) openQuizFromText(target.title, target.content);
            }}
          />
        )}
      </AnimatePresence>

      {flashcardsState && (
        <StudyFlashcardsModal
          open={Boolean(flashcardsState)}
          title={flashcardsState.title}
          cards={flashcardsState.cards}
          onClose={() => setFlashcardsState(null)}
          onGenerateDeepDeck={() => {
            const source = flashcardsState.sourceText;
            setFlashcardsState(null);
            void handleQuickPrompt(
              buildFlashcardsGenerationPrompt(source),
              'Generate 6 active-recall flashcards from these notes'
            );
          }}
        />
      )}

      {quizState && (
        <StudyQuizModal
          open={Boolean(quizState)}
          title={quizState.title}
          questions={quizState.questions}
          onClose={() => setQuizState(null)}
          onGenerateAiQuiz={() => {
            const source = quizState.sourceText;
            setQuizState(null);
            void handleQuickPrompt(
              buildQuizGenerationPrompt(source),
              'Create a 4-question practice quiz from these notes'
            );
          }}
          onReviewMistakes={(missedSummary) => {
            setQuizState(null);
            void handleQuickPrompt(
              buildQuickStudyActionPrompt('review_mistakes', missedSummary),
              'Review the quiz questions I missed'
            );
          }}
        />
      )}
    </div>
  );
}
