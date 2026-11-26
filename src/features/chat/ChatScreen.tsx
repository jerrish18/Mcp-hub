import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUp,
  AtSign,
  Bookmark,
  BookmarkCheck,
  BookMarked,
  BookOpen,
  Briefcase,
  Check,
  ChevronDown,
  ChevronUp,
  Columns,
  Copy,
  Cpu,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  GitFork,
  Globe,
  HelpCircle,
  History,
  Info,
  Layers,
  LayoutGrid,
  ListChecks,
  Loader2,
  Maximize2,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Presentation,
  RotateCcw,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  Timer,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Command,
} from 'lucide-react';
import { getModelById, getShortModelName } from '../../config/models';
import { buildAgentToolCatalog } from '../../services/llm/agentLoop';
import { getMcpPrompt, readMcpResource } from '../../services/mcp/client';
import { getAvailableModels } from '../../services/llm/provider';
import { loadServerSecrets, saveServerSecrets } from '../../services/storage/secureStorage';
import { DEFAULT_STUDY_INSTRUCTIONS, STUDY_INSTRUCTION_PRESETS } from '../../store/defaults';
import { type CompareResultItem, useHubStore } from '../../store/useHubStore';
import type {
  A2uiMode,
  ChatAttachment,
  ChatMessage,
  ChatMode,
  EffortLevel,
  KnowledgeSourceMode,
  McpPrompt,
  McpResource,
  McpServerConfig,
  RunTrace,
} from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { MarkdownRenderer, type MarkdownCanvasRequest } from '../../ui/MarkdownRenderer';
import { ThinkingBlock } from '../../ui/ThinkingBlock';
import { ToolCallCard } from '../../ui/ToolCallCard';
import { WriteApprovalBanner } from '../../ui/WriteApprovalBanner';
import { resolveA2uiMode } from '../../utils/a2ui';
import { formatFileSize, processUploadedFiles } from '../../utils/attachments';
import { parseDelimitedDataset } from '../../utils/dataAnalysis';
import { downloadDocumentSpec, markdownToDocSpec, type DocFormat } from '../../utils/docExport';
import { triggerHaptic } from '../../utils/haptics';
import { stripMarkdownForSpeech } from '../../utils/markdownParser';
import { M3_EMPHASIZED_EASE } from '../../utils/motion';
import {
  buildExecutionPlanDraft,
  buildPlanGuidedPrompt,
  shouldOfferProPlan,
  type PlanStepItem,
} from '../../utils/proFeatures';
import {
  buildFlashcardsGenerationPrompt,
  buildQuickStudyActionPrompt,
  buildQuizGenerationPrompt,
  extractFlashcardsFromMarkdown,
  extractQuizFromMarkdown,
  type StudyFlashcard,
  type StudyQuizQuestion,
} from '../../utils/studyTools';
import { QuickConnectSheet } from '../servers/QuickConnectSheet';
import { ChatActionGroup } from './ChatActionGroup';
import { AgentSwitcherSheet } from './AgentSwitcherSheet';
import { CommandPaletteModal } from './CommandPaletteModal';
import { CompareModelsPane } from './CompareModelsPane';
import { HistoryListContent, HistorySheet } from './HistorySheet';
import { InlineRunTraceBar } from './InlineRunTraceBar';
import { ModelSwitcherSheet } from './ModelSwitcherSheet';
import { ProCanvasPanel } from './ProCanvasPanel';
import { useCanvasDraft } from './useCanvasDraft';
import { getAccountScope } from '../../services/storage/accountSync';
import { ProjectsModal } from './ProjectsModal';
import { PromptMacrosSheet } from './PromptMacrosSheet';
import { RunTraceSheet, type ConversationTraceEntry } from './RunTraceSheet';
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
  { id: 'coding', label: 'Code', Icon: Terminal },
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
  coding: [{ label: 'Build a website', prompt: 'Build a responsive project dashboard with a runnable HTML, CSS, and JavaScript preview.' },
    { label: 'Review a repository', prompt: 'Inspect the repository and existing tests. Identify the highest-impact correctness issue and suggest a focused fix.' }],
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
      label: 'Build Multi-File Web App (IDE + GitHub)',
      prompt: 'Build a multi-file web app Sprint Taskboard (index.html, styles.css, app.js) ready for Pro Canvas IDE and GitHub sync.',
    },
    {
      label: 'Build Executive Deck (.PPTX)',
      prompt: 'Build a 4-slide Q3 executive presentation deck (.pptx) with KPI metrics and rollout milestones.',
    },
    {
      label: 'Create Excel Forecast (.XLSX)',
      prompt: 'Generate a multi-sheet Q3 financial Excel workbook (.xlsx) with P&L and department budgets.',
    },
    {
      label: 'Create Sprint Note (Write Approval)',
      prompt: 'Create a note titled "Sprint Checklist" with my MCP testing priorities.',
    },
  ],
  study: [
    {
      label: 'Explain with Flowchart & Math',
      prompt: 'Teach me how Transformer self-attention works with a visual flowchart diagram and formulas.',
    },
    {
      label: 'Visual Guide with Web Images',
      prompt: 'Show me real web images and a flowchart explaining human heart anatomy.',
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
    authUser,
    agents,
    servers,
    conversations,
    activeConversationId,
    providerKeys,
    dynamicModels,
    settings,
    savedStudyNotes,
    savedPrompts,
    projects,
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
    setConversationProject,
    saveProject,
    deleteProject,
    updateMessageA2uiState,
    saveStudyNote,
    removeSavedStudyNote,
    savePromptMacro,
    deletePromptMacro,
    runCompareTurn,
    acceptComparedReply,
    verifyAssistantMessage,
    editAndRerunUserMessage,
    regenerateAssistantMessage,
    forkConversationFromMessage,
    retryToolCall,
    updateSettings,
  } = useHubStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<string | null>(null);
  const selectedAttachment = attachments.find(item => item.id === previewAttachment);
  const [isDragging, setIsDragging] = useState(false);

  // Separate sheets for Models vs Agents
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [agentSheetOpen, setAgentSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  // MCP @ Resource & / Prompt pickers
  const [mcpPickerMode, setMcpPickerMode] = useState<'resource' | 'prompt' | null>(null);
  const [mcpPickerQuery, setMcpPickerQuery] = useState('');
  const [mcpBusy, setMcpBusy] = useState(false);
  const [promptArgsTarget, setPromptArgsTarget] = useState<{
    server: McpServerConfig;
    prompt: McpPrompt;
  } | null>(null);
  const [promptArgsValues, setPromptArgsValues] = useState<Record<string, string>>({});

  // Study Suite state
  const [studyPlanOpen, setStudyPlanOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);

  // Pro Canvas & Document Export state
  const [canvasOpen, setCanvasOpen] = useState(false);
  const canvasScope = getAccountScope(authUser);
  const {
    artifact: canvasArtifact, change: setCanvasArtifact, saveFailed: canvasSaveFailed,
    loaded: canvasDraftLoaded, flush: saveCanvasDraft,
  } = useCanvasDraft(canvasScope, activeConversationId);
  const [githubConnectOpen, setGithubConnectOpen] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  // Phase 4: Run Trace, Saved Macros & Compare Mode
  const [traceSheetState, setTraceSheetState] = useState<{
    trace: RunTrace;
    title: string;
  } | null>(null);
  const [macrosSheetOpen, setMacrosSheetOpen] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareModelIds, setCompareModelIds] = useState<string[]>(['demo-sandbox', 'gemini-4-hydrogen']);
  const [compareLastPrompt, setCompareLastPrompt] = useState('');
  const [compareLastAttachments, setCompareLastAttachments] = useState<ChatAttachment[]>([]);
  const [compareResults, setCompareResults] = useState<CompareResultItem[]>([]);

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
  const [voiceReplies, setVoiceReplies] = useState(false);
  const spokenReplyId = useRef<string | undefined>(undefined);
  const voiceConversationId = useRef<string | null>(null);
  const [speechNotice, setSpeechNotice] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  // Part 3: Projects, Command Palette, Plan-then-execute, Message Branching & Verify
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [pendingPlanDraft, setPendingPlanDraft] = useState<{
    prompt: string;
    attachments: ChatAttachment[];
    steps: PlanStepItem[];
  } | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingMsgText, setEditingMsgText] = useState('');
  const [verifyingMsgId, setVerifyingMsgId] = useState<string | null>(null);
  const [regenPickerMsgId, setRegenPickerMsgId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const lastThread = useRef(activeConversationId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const speechTimerRef = useRef<number | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId) ?? conversations[0];
  const activeAgent = agents.find((a) => a.id === activeConv?.agentId) ?? agents[0];
  const activeProject = activeConv?.projectId
    ? projects.find((p) => p.id === activeConv.projectId) ?? null
    : null;
  const allCatalogModels = useMemo(() => getAvailableModels(providerKeys, dynamicModels), [dynamicModels, providerKeys]);
  const activeModel = getModelById(activeConv?.modelId ?? activeAgent.defaultModelId, dynamicModels);
  const activeModelShort = getShortModelName(activeModel);
  const activeEffort: EffortLevel = activeConv?.effort ?? activeAgent.defaultEffort;
  const activeChatMode: ChatMode = activeConv?.chatMode ?? 'professional';
  const activeKnowledgeSource: KnowledgeSourceMode = activeConv?.knowledgeSource ?? 'auto';
  const activeStudyInstructions = activeConv?.studyInstructions ?? DEFAULT_STUDY_INSTRUCTIONS;
  const resolvedA2uiMode: A2uiMode = resolveA2uiMode(settings);

  const cycleA2uiMode = () => {
    const nextMode: A2uiMode =
      resolvedA2uiMode === 'smart'
        ? 'always'
        : resolvedA2uiMode === 'always'
          ? 'off'
          : 'smart';
    triggerHaptic(settings.hapticsEnabled, 'light');
    updateSettings({ a2uiMode: nextMode, a2uiEnabled: nextMode !== 'off' });
  };

  const activeSourceOption =
    KNOWLEDGE_SOURCE_OPTIONS.find((o) => o.id === activeKnowledgeSource) ??
    KNOWLEDGE_SOURCE_OPTIONS[0];

  const { tools } = buildAgentToolCatalog(
    activeAgent,
    servers,
    activeProject?.allowedServerIds ?? null
  );
  const activeToolsCount = (activeChatMode === 'professional' || activeChatMode === 'coding') ? tools.length : 0;
  const lastMsg = activeConv?.messages[activeConv.messages.length - 1];
  useEffect(() => {
    if (!voiceReplies || voiceConversationId.current !== activeConversationId || isRunning || lastMsg?.role !== 'assistant' || lastMsg.isStreaming || lastMsg.error || !lastMsg.content || spokenReplyId.current === lastMsg.id || !('speechSynthesis' in window)) return;
    spokenReplyId.current = lastMsg.id;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(lastMsg.content));
    utterance.lang = navigator.language;
    utterance.onend = utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(lastMsg.id);
    window.speechSynthesis.speak(utterance);
  }, [voiceReplies, lastMsg, isRunning, activeConversationId]);


  const availableResources = useMemo(() => {
    const items: Array<{ server: McpServerConfig; resource: McpResource }> = [];
    for (const srv of servers) {
      if (!srv.enabled || srv.status !== 'connected') continue;
      for (const res of srv.resources) {
        items.push({ server: srv, resource: res });
      }
    }
    return items;
  }, [servers]);

  const availablePrompts = useMemo(() => {
    const items: Array<{ server: McpServerConfig; prompt: McpPrompt }> = [];
    for (const srv of servers) {
      if (!srv.enabled || srv.status !== 'connected') continue;
      for (const prompt of srv.prompts) {
        items.push({ server: srv, prompt });
      }
    }
    return items;
  }, [servers]);

  const filteredMcpResources = useMemo(() => {
    const q = mcpPickerQuery.trim().toLowerCase();
    if (!q) return availableResources;
    return availableResources.filter(
      ({ resource, server }) =>
        resource.name.toLowerCase().includes(q) ||
        resource.uri.toLowerCase().includes(q) ||
        server.name.toLowerCase().includes(q)
    );
  }, [availableResources, mcpPickerQuery]);

  const filteredMcpPrompts = useMemo(() => {
    const q = mcpPickerQuery.trim().toLowerCase();
    if (!q) return availablePrompts;
    return availablePrompts.filter(
      ({ prompt, server }) =>
        prompt.name.toLowerCase().includes(q) ||
        (prompt.description ?? '').toLowerCase().includes(q) ||
        server.name.toLowerCase().includes(q)
    );
  }, [availablePrompts, mcpPickerQuery]);

  const savedByMessageId = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of savedStudyNotes) {
      if (note.messageId) map.set(note.messageId, note.id);
    }
    return map;
  }, [savedStudyNotes]);

  const conversationTraces = useMemo<ConversationTraceEntry[]>(() => {
    const msgs = activeConv?.messages ?? [];
    const entries: ConversationTraceEntry[] = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== 'assistant' || !m.runTrace) continue;
      const mModel = getShortModelName(getModelById(m.modelId ?? activeModel.id, dynamicModels));
      const prevUser = msgs
        .slice(0, i)
        .reverse()
        .find((u) => u.role === 'user');
      const promptSnippet = (prevUser?.displayContent ?? prevUser?.content ?? 'Turn').slice(0, 36);
      entries.push({
        id: m.id,
        label: `${promptSnippet} · ${mModel}`,
        trace: m.runTrace,
      });
    }
    return entries;
  }, [activeConv?.messages, activeModel.id, dynamicModels]);

  useEffect(() => {
    const el = scrollRef.current;
    if (lastThread.current !== activeConversationId) {
      lastThread.current = activeConversationId;
      followLatest.current = true;
    }
    if (!el || !followLatest.current) return;
    const raf = window.requestAnimationFrame(() => {
      if (followLatest.current) el.scrollTop = el.scrollHeight;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    activeConversationId,
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
    setCanvasOpen(false);
    setVoiceReplies(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
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
    const handleGlobalKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
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
    if (files.length + attachments.length > 4) errors.push('Up to four attachments can be added per message.');
    if (errors.length > 0) setUploadError(errors.join(' '));
    if (parsed.length > 0) {
      setAttachments((prev) => {
        const unique = [...prev];
        for (const file of parsed) if (!unique.some(existing => existing.name === file.name && existing.size === file.size && existing.textContent === file.textContent && existing.dataBase64 === file.dataBase64)) unique.push(file);
        return unique.slice(0, 4);
      });
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
    followLatest.current = true;
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
    setMcpPickerMode(null);
    triggerHaptic(settings.hapticsEnabled, 'light');

    if (
      (activeChatMode === 'professional' || activeChatMode === 'coding') &&
      planMode &&
      !compareEnabled &&
      msg.trim().length > 0
    ) {
      setPendingPlanDraft({
        prompt: msg,
        attachments: currentAttachments,
        steps: buildExecutionPlanDraft(msg, activeToolsCount),
      });
      return;
    }

    if (compareEnabled && compareModelIds.length > 0) {
      setCompareLastPrompt(msg);
      setCompareLastAttachments(currentAttachments);
      setCompareResults(
        compareModelIds.map((mId) => ({
          modelId: mId,
          status: 'running',
          content: '',
          reasoning: '',
          citations: [],
          durationMs: 0,
        }))
      );
      await runCompareTurn(msg, compareModelIds, {
        attachments: currentAttachments,
        onModelUpdate: (mId, updatedItem) => {
          setCompareResults((prev) => {
            const exists = prev.some((r) => r.modelId === mId);
            return exists
              ? prev.map((r) => (r.modelId === mId ? updatedItem : r))
              : [...prev, updatedItem];
          });
        },
      });
      return;
    }

    await sendMessage(msg, { attachments: currentAttachments });
  };

  const handleComposerChange = (value: string) => {
    setInput(value);
    const resMatch = value.match(/(?:^|\s)@([^\s]*)$/);
    if (resMatch && availableResources.length > 0) {
      setMcpPickerMode('resource');
      setMcpPickerQuery(resMatch[1] ?? '');
      return;
    }
    const promptMatch = value.match(/(?:^|\s)\/([^\s]*)$/);
    if (promptMatch && availablePrompts.length > 0) {
      setMcpPickerMode('prompt');
      setMcpPickerQuery(promptMatch[1] ?? '');
      return;
    }
    if (mcpPickerMode) {
      setMcpPickerMode(null);
      setMcpPickerQuery('');
    }
  };

  const handleSelectMcpResource = async (server: McpServerConfig, resource: McpResource) => {
    setMcpBusy(true);
    setUploadError('');
    try {
      const secrets = await loadServerSecrets(server.id);
      const res = await readMcpResource({
        server,
        secrets,
        saveUpdatedSecrets: (u) => saveServerSecrets(server.id, u),
        uri: resource.uri,
      });
      const content = `[MCP Resource: ${resource.name} (${resource.uri}) from ${server.name}]\n${res.textSummary}`;
      const attachment: ChatAttachment = {
        id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: `@${resource.name}`,
        mimeType: resource.mimeType ?? 'text/plain',
        kind: 'file',
        size: new Blob([content]).size,
        textContent: content,
      };
      setAttachments((prev) => [...prev, attachment].slice(0, 4));
      setInput((prev) => prev.replace(/(?:^|\s)@[^\s]*$/, (m) => (m.startsWith(' ') ? ' ' : '')).trimStart());
      setMcpPickerMode(null);
      setMcpPickerQuery('');
      triggerHaptic(settings.hapticsEnabled, 'light');
      setTimeout(() => composerRef.current?.focus(), 30);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to read MCP resource.');
    } finally {
      setMcpBusy(false);
    }
  };

  const executeGetMcpPrompt = async (
    server: McpServerConfig,
    prompt: McpPrompt,
    args: Record<string, string>
  ) => {
    setMcpBusy(true);
    setUploadError('');
    try {
      const secrets = await loadServerSecrets(server.id);
      const res = await getMcpPrompt({
        server,
        secrets,
        saveUpdatedSecrets: (u) => saveServerSecrets(server.id, u),
        name: prompt.name,
        arguments: args,
      });
      const baseWithoutTrigger = input
        .replace(/(?:^|\s)\/[^\s]*$/, (m) => (m.startsWith(' ') ? ' ' : ''))
        .trim();
      const nextText = baseWithoutTrigger
        ? `${baseWithoutTrigger}\n\n${res.composedText}`
        : res.composedText || `Run prompt "${prompt.name}"`;
      setInput(nextText);
      setMcpPickerMode(null);
      setMcpPickerQuery('');
      setPromptArgsTarget(null);
      setPromptArgsValues({});
      triggerHaptic(settings.hapticsEnabled, 'light');
      setTimeout(() => composerRef.current?.focus(), 40);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to load MCP prompt.');
    } finally {
      setMcpBusy(false);
    }
  };

  const handleSelectMcpPrompt = async (server: McpServerConfig, prompt: McpPrompt) => {
    if (prompt.arguments && prompt.arguments.length > 0) {
      const defaults: Record<string, string> = {};
      for (const arg of prompt.arguments) defaults[arg.name] = '';
      setPromptArgsValues(defaults);
      setPromptArgsTarget({ server, prompt });
      setMcpPickerMode(null);
      return;
    }
    await executeGetMcpPrompt(server, prompt, {});
  };

  const handleQuickPrompt = async (promptText: string, displayText?: string) => {
    if (isRunning) return;
    followLatest.current = true;
    setStudyPlanOpen(false);
    setSourceMenuOpen(false);
    setMcpPickerMode(null);
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

  const handleOpenInCanvas = (payload: MarkdownCanvasRequest, messageId: string, block: number) => {
    const id = JSON.stringify([messageId, block]);
    if (canvasArtifact?.id !== id) setCanvasArtifact({ ...payload, id });
    setCanvasOpen(true);
    triggerHaptic(settings.hapticsEnabled, 'light');
  };

  const isTabularAttachment = (att: ChatAttachment) =>
    Boolean(att.textContent) && /\.(csv|tsv|xlsx|xls)$/i.test(att.name);

  const handleAnalyzeDatasetAttachment = (att: ChatAttachment) => {
    if (!att.textContent) return;
    const spec = parseDelimitedDataset(att.textContent, att.name);
    if (!spec) {
      setUploadError(`Could not parse tabular rows from ${att.name}.`);
      return;
    }
    setCanvasArtifact({
      kind: 'dataset',
      id: `canvas_ds_${Date.now()}`,
      title: spec.title,
      spec,
    });
    setCanvasOpen(true);
    triggerHaptic(settings.hapticsEnabled, 'light');
  };

  const handleToggleHeaderCanvas = () => {
    if (canvasArtifact) {
      saveCanvasDraft();
      setCanvasOpen((v) => !v);
      return;
    }
    setCanvasArtifact({
      kind: 'code',
      id: `canvas_${Date.now()}`,
      title: 'Pro Canvas Scratchpad',
      language: 'html',
      code: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <style>\n    body { font-family: system-ui, sans-serif; padding: 24px; background: #f8fafc; color: #0f172a; }\n    .card { max-width: 480px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; }\n  </style>\n</head>\n<body>\n  <div class="card">\n    <h2>Interactive Pro Canvas</h2>\n    <p>Ask the Pro agent to build HTML widgets, SVG diagrams, PPTX decks, XLSX workbooks, or PDF/DOCX reports.</p>\n  </div>\n</body>\n</html>`,
    });
    setCanvasOpen(true);
  };

  const handleQuickExportPro = async (msgId: string, content: string, format: DocFormat) => {
    const key = `${msgId}:${format}`;
    setExportingKey(key);
    try {
      const spec = markdownToDocSpec(content, activeConv?.title || 'MCP Hub Report', format);
      await downloadDocumentSpec(spec);
      triggerHaptic(settings.hapticsEnabled, 'success');
    } finally {
      setExportingKey(null);
    }
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
      className="chat-workspace flex h-full min-h-0"
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
      {/* Desktop Conversation History Sidebar (yields space cleanly when Pro Canvas is open) */}
      <aside
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className={`${canvasOpen || settings.chatLayout === 'focus' ? 'hidden' : 'hidden xl:flex'} chat-history shrink-0 flex-col border-r`}
      >
        <div className="mb-3">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Conversations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {authUser ? 'Account synced' : 'Local history'} · {conversations.length} saved
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
          className="chat-toolbar shrink-0 px-3 sm:px-5 py-2.5 border-b space-y-2"
        >
          {/* Row 1: Primary Model Picker | Separate Agent Picker | History + New Chat */}
          <div className="chat-toolbar-top flex items-center justify-between gap-2">
            <div className="chat-identities flex items-center gap-1.5 min-w-0 flex-1">
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

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                data-testid="command-palette-btn"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Open command palette"
                title="Command Palette (Ctrl/Cmd+K)"
                style={{
                  backgroundColor: 'var(--m3-surface-container-high)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[34px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 hover:opacity-90"
              >
                <Command className="w-3.5 h-3.5" />
                <span className="hidden sm:inline font-mono text-[11px]">⌘K</span>
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                aria-label="Open chat history"
                className={`${settings.chatLayout === 'focus' || canvasOpen ? '' : 'xl:hidden'} min-h-[40px] min-w-[40px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors`}
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

          <div className="chat-toolbar-modes">
            <div
              role="tablist"
              aria-label="Chat mode"
              style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
              className="inline-flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] p-0.5 rounded-full"
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
                    {(id === 'professional' || id === 'coding') && (
                      <span className="tab-tool-count text-[10px] opacity-75 font-mono tabular-nums">
                        {tools.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="chat-toolbar-actions">
              {((activeChatMode === 'professional' || activeChatMode === 'coding') || canvasArtifact) && (
                <button
                  type="button"
                  data-testid="pro-canvas-toggle-btn"
                  disabled={!canvasDraftLoaded}
                  onClick={handleToggleHeaderCanvas}
                  aria-label="Canvas"
                  aria-pressed={canvasOpen}
                  style={
                    canvasOpen
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
                  className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-90"
                >
                  <PanelRight className="w-3.5 h-3.5" />
                  <span className="chat-canvas-label">Canvas</span>
                </button>
              )}

              <ChatActionGroup placement="toolbar" label="Chat tools">
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

                {(activeChatMode === 'professional' || activeChatMode === 'coding') && (
                  <button
                    type="button"
                    data-testid="pro-plan-toggle"
                    onClick={() => {
                      triggerHaptic(settings.hapticsEnabled, 'light');
                      setPlanMode((v) => !v);
                    }}
                    aria-pressed={planMode}
                    title="Plan-then-execute: draft editable steps before running Pro tasks"
                    style={
                      planMode
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
                    className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-90"
                  >
                    <ListChecks className="w-3.5 h-3.5" />
                    <span>Plan</span>
                  </button>
                )}

                {/* Active Project Workspace Pill */}
                <button
                  type="button"
                  data-testid="project-picker-btn"
                  onClick={() => setProjectsModalOpen(true)}
                  aria-label={`Project workspace: ${activeProject ? activeProject.name : 'None'}`}
                  style={
                    activeProject
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
                  className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-90"
                >
                  <FolderKanban className="w-3.5 h-3.5" />
                  <span className="truncate max-w-[104px]">
                    {activeProject ? activeProject.name : 'Project'}
                  </span>
                </button>

                {/* Live A2UI Interactive Widgets Mode Cycler (Smart / Always / Off) */}
                <button
                  type="button"
                  data-testid="a2ui-toggle-btn"
                  aria-pressed={resolvedA2uiMode !== 'off'}
                  aria-label={`Interactive A2UI widgets: ${resolvedA2uiMode}. Tap to switch mode`}
                  title={`A2UI Mode: ${resolvedA2uiMode.toUpperCase()} (tap to cycle Smart → Always → Off)`}
                  onClick={cycleA2uiMode}
                  style={
                    resolvedA2uiMode !== 'off'
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
                  className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-90"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>
                    {resolvedA2uiMode === 'smart'
                      ? 'A2UI · Smart'
                      : resolvedA2uiMode === 'always'
                        ? 'A2UI · Always'
                        : 'A2UI · Off'}
                  </span>
                </button>

                {/* Multi-Model Side-by-Side Compare Toggle */}
                <button
                  type="button"
                  data-testid="compare-toggle-btn"
                  aria-pressed={compareEnabled}
                  title="Compare 2-3 models side by side"
                  onClick={() => {
                    triggerHaptic(settings.hapticsEnabled, 'light');
                    setCompareEnabled((v) => !v);
                  }}
                  style={
                    compareEnabled
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
                  className="min-h-[32px] px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap shrink-0 hover:opacity-90"
                >
                  <Columns className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Compare</span>
                </button>

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
              </ChatActionGroup>
            </div>
          </div>

          {/* Collapsible Study Style & Response Structure Drawer */}
          {activeChatMode === 'study' && studyPlanOpen && (
            <div
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="chat-study-style rounded-2xl border p-3 space-y-2.5"
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

        {compareEnabled && (
          <CompareModelsPane
            allModels={allCatalogModels}
            selectedModelIds={compareModelIds}
            results={compareResults}
            lastPrompt={compareLastPrompt}
            isRunning={isRunning}
            a2uiEnabled={resolvedA2uiMode !== 'off'}
            onToggleModel={(mId) => {
              setCompareModelIds((prev) => {
                if (prev.includes(mId)) {
                  return prev.length > 1 ? prev.filter((id) => id !== mId) : prev;
                }
                return prev.length >= 3 ? [...prev.slice(1), mId] : [...prev, mId];
              });
            }}
            onAcceptReply={(item) => {
              void acceptComparedReply(compareLastPrompt, item, compareLastAttachments).then(() => {
                setCompareResults([]);
                setCompareEnabled(false);
              });
            }}
            onClearResults={() => setCompareResults([])}
            onCloseCompare={() => setCompareEnabled(false)}
          />
        )}

        {/* Scrollable Editorial Message Stream */}
        <div ref={scrollRef} onScroll={({ currentTarget }) => {
          followLatest.current = currentTarget.scrollHeight - currentTarget.clientHeight - currentTarget.scrollTop <= 72;
        }} className="chat-thread flex-1 min-h-0 overflow-y-auto px-3.5 sm:px-6 py-5 space-y-6">
          {(!activeConv || activeConv.messages.length === 0) && (
            <div className="chat-empty max-w-xl mx-auto py-8 sm:py-12 text-center space-y-6">
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
                  {(activeChatMode === 'professional' || activeChatMode === 'coding')
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

              <div className="chat-starter-grid text-left w-full min-w-0">
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
              const isEditingThis = editingMsgId === msg.id;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={M3_EMPHASIZED_EASE}
                  className="max-w-3xl mx-auto flex flex-col items-end gap-1.5 group"
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
                          <div
                            key={att.id}
                            style={{
                              backgroundColor: 'var(--m3-surface-container-high)',
                              borderColor: 'var(--m3-outline)',
                            }}
                            className="px-3 py-1.5 rounded-xl border text-xs text-slate-800 dark:text-slate-200 inline-flex items-center gap-2"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate max-w-[160px]">{att.name}</span>
                            {isTabularAttachment(att) && (
                              <button
                                type="button"
                                onClick={() => handleAnalyzeDatasetAttachment(att)}
                                className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-semibold inline-flex items-center gap-1 hover:bg-blue-700"
                              >
                                <FileSpreadsheet className="w-3 h-3" />
                                <span>Analyze</span>
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )}
                  {isEditingThis ? (
                    <div
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="w-full max-w-[92%] rounded-2xl border p-3 space-y-2"
                    >
                      <textarea
                        rows={3}
                        value={editingMsgText}
                        onChange={(e) => setEditingMsgText(e.target.value)}
                        style={{
                          backgroundColor: 'var(--m3-surface)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="w-full p-2.5 rounded-xl border text-sm text-slate-900 dark:text-white"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMsgId(null);
                            setEditingMsgText('');
                          }}
                          className="min-h-[34px] px-3 rounded-full text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={!editingMsgText.trim() || isRunning}
                          onClick={() => {
                            const nextText = editingMsgText.trim();
                            setEditingMsgId(null);
                            setEditingMsgText('');
                            void editAndRerunUserMessage(msg.id, nextText);
                          }}
                          style={{
                            backgroundColor: 'var(--m3-primary)',
                            color: 'var(--m3-on-primary)',
                          }}
                          className="min-h-[34px] px-4 rounded-full text-xs font-semibold disabled:opacity-50"
                        >
                          Save & Rerun
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          backgroundColor: 'var(--m3-primary)',
                          color: 'var(--m3-on-primary)',
                        }}
                        className="max-w-[86%] rounded-[22px] rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed shadow-xs"
                      >
                        {msg.displayContent ?? msg.content}
                      </div>
                      {!isRunning && (
                        <button
                          type="button"
                          data-testid={`edit-user-msg-${msg.id}`}
                          onClick={() => {
                            setEditingMsgId(msg.id);
                            setEditingMsgText(msg.displayContent ?? msg.content);
                          }}
                          className="min-h-[28px] px-2 rounded-full text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                      )}
                    </>
                  )}
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
                className="chat-reply max-w-3xl mx-auto min-w-0 space-y-2.5"
              >
                <div className="chat-reply-byline flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <Sparkles
                      style={{ color: 'var(--m3-primary)' }}
                      className="chat-reply-mark w-3.5 h-3.5 shrink-0"
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

                <ThinkingBlock
                  reasoning={msg.reasoning ?? ''}
                  isStreaming={msg.isStreaming}
                  isStillThinking={Boolean(
                    msg.isStreaming &&
                      !msg.content &&
                      (!msg.toolCalls || msg.toolCalls.length === 0)
                  )}
                  durationMs={msg.thinkingDurationMs}
                />

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-1">
                    {msg.toolCalls.map((tc) => (
                      <ToolCallCard key={tc.id} record={tc} />
                    ))}
                  </div>
                )}

                {msg.content && (
                  <div className="space-y-3">
                    <article
                      data-testid="assistant-response-card"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest('button, a, pre, code, table, summary, details, svg')) return;
                        if (isStudyResponse && !msg.isStreaming && msg.content.trim()) {
                          setReaderState({
                            title: activeConv?.title || 'Study Notes',
                            content: msg.content,
                            modelLabel: msgModelShort,
                            citations: msg.citations,
                          });
                        }
                      }}
                      className={`chat-reply-content min-w-0 ${isStudyResponse && !msg.isStreaming ? 'cursor-pointer' : ''}`}
                    >
                      <MarkdownRenderer
                        content={msg.content}
                        isStreaming={msg.isStreaming}
                        a2uiEnabled={resolvedA2uiMode !== 'off'}
                        a2uiWidgetState={msg.a2uiWidgetState}
                        onUpdateA2uiWidgetState={(patch) => updateMessageA2uiState(msg.id, patch)}
                        onToggleA2ui={() => updateSettings({ a2uiMode: 'smart', a2uiEnabled: true })}
                        onA2UIAction={(promptText, displayLabel) => {
                          void handleQuickPrompt(promptText, displayLabel);
                        }}
                        onOpenInteractiveFlashcards={() =>
                          openFlashcardsFromText(activeConv?.title || 'Flashcards', msg.content)
                        }
                        onOpenInteractiveQuiz={() =>
                          openQuizFromText(activeConv?.title || 'Practice Quiz', msg.content)
                        }
                        onOpenInCanvas={(payload, block) => handleOpenInCanvas(payload, msg.id, block)}
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
                      <div className="chat-reply-actions flex flex-wrap items-center gap-1 pt-0.5">
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

                        <ChatActionGroup placement="reply" label="More response actions">
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

                          {/* Verify Reply with 2nd Model */}
                          <button
                            type="button"
                            data-testid="verify-msg-btn"
                            disabled={isRunning || verifyingMsgId === msg.id}
                            onClick={() => {
                              setVerifyingMsgId(msg.id);
                              void verifyAssistantMessage(msg.id).finally(() => setVerifyingMsgId(null));
                            }}
                            aria-label="Verify response accuracy"
                            className="min-h-[34px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                          >
                            {verifyingMsgId === msg.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <ShieldCheck className="w-3.5 h-3.5" />
                            )}
                            <span>{verifyingMsgId === msg.id ? 'Verifying…' : 'Verify'}</span>
                          </button>

                          {/* Regenerate (or pick different model) */}
                          <div className="relative inline-flex items-center">
                            <button
                              type="button"
                              data-testid="regen-msg-btn"
                              disabled={isRunning}
                              onClick={() =>
                                setRegenPickerMsgId((curr) => (curr === msg.id ? null : msg.id))
                              }
                              aria-label="Regenerate response"
                              className="min-h-[34px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Regen</span>
                            </button>
                            {regenPickerMsgId === msg.id && (
                              <div
                                style={{
                                  backgroundColor: 'var(--m3-surface-container-high)',
                                  borderColor: 'var(--m3-outline)',
                                }}
                                className="absolute left-0 bottom-full mb-1.5 z-30 w-56 rounded-2xl border p-1.5 shadow-xl space-y-0.5"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRegenPickerMsgId(null);
                                    void regenerateAssistantMessage(msg.id);
                                  }}
                                  className="w-full min-h-[36px] px-2.5 rounded-xl text-left text-xs font-semibold text-slate-900 dark:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800/70"
                                >
                                  Retry with {activeModelShort}
                                </button>
                                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                  Or try another model
                                </div>
                                {allCatalogModels.slice(0, 6).map((m) => (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => {
                                      setRegenPickerMsgId(null);
                                      void regenerateAssistantMessage(msg.id, m.id);
                                    }}
                                    className="w-full min-h-[34px] px-2.5 rounded-xl text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/70 truncate"
                                  >
                                    {getShortModelName(m)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Fork Conversation Branch */}
                          <button
                            type="button"
                            data-testid="fork-msg-btn"
                            disabled={isRunning}
                            onClick={() => void forkConversationFromMessage(msg.id)}
                            aria-label="Fork conversation from this reply"
                            className="min-h-[34px] px-2.5 rounded-full text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors disabled:opacity-50"
                          >
                            <GitFork className="w-3.5 h-3.5" />
                            <span>Fork</span>
                          </button>

                          {['professional', 'coding'].includes(msg.chatMode ?? activeChatMode) && (
                            <div className="ml-1 flex items-center gap-1 flex-wrap">
                              {(
                                [
                                  { fmt: 'pdf', label: 'PDF', Icon: FileText },
                                  { fmt: 'docx', label: 'DOCX', Icon: FileText },
                                  { fmt: 'xlsx', label: 'XLSX', Icon: FileSpreadsheet },
                                  { fmt: 'pptx', label: 'PPTX', Icon: Presentation },
                                ] as const
                              ).map(({ fmt, label, Icon }) => {
                                const busy = exportingKey === `${msg.id}:${fmt}`;
                                return (
                                  <button
                                    key={fmt}
                                    type="button"
                                    disabled={busy}
                                    data-testid={`export-msg-${fmt}`}
                                    onClick={() => void handleQuickExportPro(msg.id, msg.content, fmt)}
                                    aria-label={`Export response as ${label}`}
                                    style={{
                                      backgroundColor: 'var(--m3-surface-container)',
                                      borderColor: 'var(--m3-outline)',
                                    }}
                                    className="min-h-[30px] px-2 rounded-full border text-[11px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 whitespace-nowrap hover:opacity-85 disabled:opacity-50"
                                  >
                                    <Icon className="w-3 h-3" />
                                    <span>{busy ? '…' : label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </ChatActionGroup>
                      </div>
                    )}

                    {/* Second-Model Verification Result Card */}
                    {msg.verification && (
                      <div
                        data-testid="msg-verification-card"
                        className={`rounded-2xl border px-3.5 py-2.5 text-xs space-y-1 ${
                          msg.verification.verdict === 'verified'
                            ? 'border-emerald-300/70 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                            : msg.verification.verdict === 'issues'
                              ? 'border-rose-300/70 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200'
                              : 'border-amber-300/70 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <span className="inline-flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>
                              {msg.verification.verdict === 'verified'
                                ? 'Verified'
                                : msg.verification.verdict === 'issues'
                                  ? 'Issues Flagged'
                                  : 'Caution / Review'}
                            </span>
                          </span>
                          <span className="text-[11px] opacity-80 font-normal">
                            Reviewed by {getShortModelName(getModelById(msg.verification.modelId, dynamicModels))}
                          </span>
                        </div>
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.verification.summary}</p>
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

                {msg.runTrace && (
                  <InlineRunTraceBar
                    trace={msg.runTrace}
                    dynamicModels={dynamicModels}
                    onOpenFullWaterfall={() =>
                      setTraceSheetState({
                        trace: msg.runTrace!,
                        title: `${msgModelShort} · ${activeAgent.name}`,
                      })
                    }
                  />
                )}

                {msg.error && (
                  <div role="alert" className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-200 flex flex-wrap items-start justify-between gap-3">
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
                    {!msg.content && !isRunning && !msg.error.toLowerCase().includes('api key') && (
                      <button type="button" onClick={() => void regenerateAssistantMessage(msg.id)}
                        className="shrink-0 text-xs font-semibold underline">
                        Try again
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
              onDecision={(resolution) => {
                triggerHaptic(
                  settings.hapticsEnabled,
                  resolution.decision === 'deny' ? 'warning' : 'success'
                );
                resolvePendingApproval(resolution);
              }}
            />
          )}
        </AnimatePresence>

        {speechNotice && (
          <div className="px-4 pb-1 text-center text-xs text-slate-500 dark:text-slate-400">
            {speechNotice}
          </div>
        )}

        {/* Inline Editable Plan-Then-Execute Card */}
        {pendingPlanDraft && (
          <div className="px-3 sm:px-6 pb-2">
            <div
              data-testid="execution-plan-card"
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-primary)',
              }}
              className="max-w-3xl mx-auto rounded-2xl border p-3.5 space-y-2.5 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                  <ListChecks className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Execution Plan — Review & Edit Before Running</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPlanDraft((curr) =>
                      curr
                        ? {
                            ...curr,
                            steps: [
                              ...curr.steps,
                              {
                                id: `plan_${Date.now()}`,
                                title: 'Additional step',
                                done: false,
                              },
                            ],
                          }
                        : null
                    );
                  }}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add step
                </button>
              </div>
              <div className="space-y-1.5">
                {pendingPlanDraft.steps.map((step, sIdx) => (
                  <div key={step.id} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-400 w-5 shrink-0">
                      {sIdx + 1}.
                    </span>
                    <input
                      type="text"
                      value={step.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPendingPlanDraft((curr) =>
                          curr
                            ? {
                                ...curr,
                                steps: curr.steps.map((st, idx) =>
                                  idx === sIdx ? { ...st, title: val } : st
                                ),
                              }
                            : null
                        );
                      }}
                      style={{
                        backgroundColor: 'var(--m3-surface)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="flex-1 min-h-[34px] px-2.5 rounded-xl border text-xs text-slate-900 dark:text-white"
                    />
                    {pendingPlanDraft.steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPendingPlanDraft((curr) =>
                            curr
                              ? { ...curr, steps: curr.steps.filter((_, idx) => idx !== sIdx) }
                              : null
                          )
                        }
                        aria-label="Remove plan step"
                        className="text-slate-400 hover:text-rose-500 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setInput(pendingPlanDraft.prompt);
                    setAttachments(pendingPlanDraft.attachments);
                    setPendingPlanDraft(null);
                  }}
                  className="min-h-[36px] px-3 rounded-full text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const draft = pendingPlanDraft;
                    setPendingPlanDraft(null);
                    void sendMessage(draft.prompt, { attachments: draft.attachments });
                  }}
                  style={{
                    backgroundColor: 'var(--m3-surface-container-high)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="min-h-[36px] px-3.5 rounded-full border text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  Run Direct
                </button>
                <button
                  type="button"
                  data-testid="approve-plan-execute-btn"
                  onClick={() => {
                    const draft = pendingPlanDraft;
                    setPendingPlanDraft(null);
                    void sendMessage(buildPlanGuidedPrompt(draft.prompt, draft.steps), {
                      attachments: draft.attachments,
                      displayText: draft.prompt,
                    });
                  }}
                  style={{
                    backgroundColor: 'var(--m3-primary)',
                    color: 'var(--m3-on-primary)',
                  }}
                  className="min-h-[36px] px-4 rounded-full text-xs font-semibold"
                >
                  Approve & Execute
                </button>
              </div>
            </div>
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
            accept="image/*,.txt,.md,.markdown,.csv,.tsv,.xlsx,.xls,.json,.yaml,.yml,.pdf,.py,.js,.ts,.tsx,.jsx,.html,.css,.sql,.log"
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

            {/* Upward MCP Resource (@) & Prompt (/) Picker Popover */}
            <AnimatePresence>
              {mcpPickerMode && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={M3_EMPHASIZED_EASE}
                  data-testid={`mcp-${mcpPickerMode}-popover`}
                  style={{
                    backgroundColor: 'var(--m3-surface-container-high)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="absolute left-0 bottom-full mb-2 w-80 max-w-[calc(100vw-24px)] max-h-64 overflow-y-auto rounded-2xl border p-1.5 shadow-xl z-30"
                >
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {mcpPickerMode === 'resource' ? 'Attach MCP Resource (@)' : 'Insert MCP Prompt (/)'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMcpPickerMode(null)}
                      aria-label="Close MCP picker"
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {mcpBusy && (
                    <div className="px-3 py-2 text-xs text-blue-600 dark:text-blue-400 inline-flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Fetching from MCP server...</span>
                    </div>
                  )}

                  {mcpPickerMode === 'resource' ? (
                    filteredMcpResources.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                        No matching MCP resources found.
                      </div>
                    ) : (
                      filteredMcpResources.map(({ server, resource }) => (
                        <button
                          key={`${server.id}:${resource.uri}`}
                          type="button"
                          onClick={() => void handleSelectMcpResource(server, resource)}
                          className="w-full min-h-[44px] px-3 py-2 rounded-xl text-left hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors"
                        >
                          <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            @{resource.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                            {server.name} · {resource.uri}
                          </div>
                        </button>
                      ))
                    )
                  ) : filteredMcpPrompts.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      No matching MCP prompts found.
                    </div>
                  ) : (
                    filteredMcpPrompts.map(({ server, prompt }) => (
                      <button
                        key={`${server.id}:${prompt.name}`}
                        type="button"
                        onClick={() => void handleSelectMcpPrompt(server, prompt)}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl text-left hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors"
                      >
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          /{prompt.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {server.name}
                          {prompt.description ? ` · ${prompt.description}` : ''}
                        </div>
                      </button>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div
              style={{
                backgroundColor: 'var(--m3-surface-container-high)',
                borderColor: 'var(--m3-outline)',
              }}
              className="chat-composer border px-3.5 pt-3 pb-2.5 space-y-2"
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
                        <button type="button" className="truncate font-medium underline max-w-full" onClick={() => setPreviewAttachment(att.id)}>{att.name}</button>
                        <div className="text-[10px] text-slate-500">{formatFileSize(att.size)}</div>
                      </div>
                      {isTabularAttachment(att) && (
                        <button
                          type="button"
                          onClick={() => handleAnalyzeDatasetAttachment(att)}
                          title="Open tabular explorer in Canvas"
                          className="min-h-[24px] px-2 rounded-full bg-blue-600 text-white text-[10px] font-semibold inline-flex items-center gap-1 hover:bg-blue-700"
                        >
                          <FileSpreadsheet className="w-3 h-3" />
                          <span>Analyze</span>
                        </button>
                      )}
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

              {selectedAttachment && <section className="rounded-xl border p-2 space-y-2 text-xs"><div className="flex justify-between gap-2"><strong className="truncate">{selectedAttachment.name}</strong><button type="button" className="underline" onClick={() => setPreviewAttachment(null)}>Close preview</button></div>{selectedAttachment.kind === 'image' && selectedAttachment.previewUrl ? <img src={selectedAttachment.previewUrl} alt={selectedAttachment.name} className="max-h-40 object-contain" /> : <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">{selectedAttachment.textContent?.slice(0, 5000) || 'No text preview available.'}</pre>}</section>}

              {shouldOfferProPlan(input, activeChatMode) && !planMode && !pendingPlanDraft && (
                <div className="px-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>Multi-step Pro task detected — want to review a plan first?</span>
                  <button
                    type="button"
                    onClick={() => setPlanMode(true)}
                    className="font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
                  >
                    Enable Plan Mode
                  </button>
                </div>
              )}

              <textarea
                ref={composerRef}
                rows={1}
                value={input}
                onChange={(e) => handleComposerChange(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData?.files ?? []);
                  if (files.length > 0) {
                    void handleFilesSelected(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && mcpPickerMode) {
                    setMcpPickerMode(null);
                    return;
                  }
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
                        : `Ask ${activeAgent.name}... (@ resource, / prompt)`
                }
                aria-label="Chat message input"
                className="w-full min-h-[38px] max-h-36 px-1.5 py-1 leading-[22px] bg-transparent text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 resize-none focus:outline-none"
              />

              {/* Compact Bottom Action Toolbar inside Composer */}
              <div className="chat-composer-actions flex items-end justify-between gap-2">
                <div className="chat-composer-tools flex flex-wrap items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Upload picture or file"
                    title="Attach pics or files (max 5 MB)"
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="min-h-[36px] min-w-[36px] sm:min-h-[38px] sm:min-w-[38px] rounded-full border flex items-center justify-center shrink-0 text-slate-700 dark:text-slate-200 hover:opacity-90 transition-opacity"
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
                    className="min-h-[36px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <activeSourceOption.Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{activeSourceOption.shortLabel}</span>
                    <ChevronUp className="w-3 h-3 opacity-70 shrink-0" />
                  </button>

                  <ChatActionGroup placement="composer" label="More composer tools">
                    <button
                      type="button"
                      data-testid="macros-picker-btn"
                      onClick={() => setMacrosSheetOpen(true)}
                      aria-label="Open saved prompt macros"
                      title="Saved Prompt Macros ({{var}})"
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="min-h-[36px] min-w-[36px] sm:min-h-[38px] sm:px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1 shrink-0 hover:opacity-90"
                    >
                      <BookMarked className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Macros</span>
                    </button>

                    {availableResources.length > 0 && (
                      <button
                        type="button"
                        data-testid="mcp-resource-picker-btn"
                        onClick={() => {
                          setMcpPickerQuery('');
                          setMcpPickerMode((m) => (m === 'resource' ? null : 'resource'));
                        }}
                        aria-label="Attach MCP resource"
                        title="Attach MCP resource (@)"
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="min-h-[36px] min-w-[36px] sm:min-h-[38px] sm:px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1 shrink-0 hover:opacity-90"
                      >
                        <AtSign className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Resource</span>
                      </button>
                    )}

                    {availablePrompts.length > 0 && (
                      <button
                        type="button"
                        data-testid="mcp-prompt-picker-btn"
                        onClick={() => {
                          setMcpPickerQuery('');
                          setMcpPickerMode((m) => (m === 'prompt' ? null : 'prompt'));
                        }}
                        aria-label="Insert MCP prompt template"
                        title="Insert MCP prompt (/)"
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="min-h-[36px] min-w-[36px] sm:min-h-[38px] sm:px-2.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1 shrink-0 hover:opacity-90"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Prompt</span>
                      </button>
                    )}

                    {'speechSynthesis' in window && (
                      <button type="button" aria-pressed={voiceReplies} onClick={() => {
                        spokenReplyId.current = lastMsg?.id;
                        voiceConversationId.current = activeConversationId;
                        if (voiceReplies) {
                          window.speechSynthesis.cancel();
                          setSpeakingMsgId(null);
                        }
                        setVoiceReplies(!voiceReplies);
                      }} className="self-start inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700">
                        <Volume2 className="w-3.5 h-3.5" />
                        Voice replies {voiceReplies ? 'on' : 'off'}
                      </button>
                    )}
                  </ChatActionGroup>

                  {activeKnowledgeSource === 'uploaded' && attachments.length === 0 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="chat-attach-reminder text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline truncate"
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

      {/* Pro Coding & Document Canvas Split Pane / Mobile Sheet */}
      {canvasOpen && canvasSaveFailed && <div role="alert" className="absolute bottom-20 right-4 z-50 rounded-xl bg-rose-700 text-white p-3 text-xs">Canvas autosave failed. Export your work to retain a copy.</div>}
      <ProCanvasPanel
        key={JSON.stringify([canvasScope, activeConversationId])}
        open={canvasOpen}
        artifact={canvasArtifact}
        storageScope={JSON.stringify([canvasScope, activeConversationId])}
        isRunning={isRunning}
        githubConnected={Boolean(
          servers.find((s) => s.presetId === 'github' || s.id === 'srv_github')?.status ===
            'connected'
        )}
        onRequestConnectGithub={() => setGithubConnectOpen(true)}
        onChangeArtifact={setCanvasArtifact}
        onSaveDraft={saveCanvasDraft}
        onAskCanvasAction={(promptText, label) => {
          void handleQuickPrompt(promptText, label);
        }}
        onClose={() => { saveCanvasDraft(); setCanvasOpen(false); }}
      />

      <QuickConnectSheet
        presetId={githubConnectOpen ? 'github' : null}
        server={servers.find((s) => s.presetId === 'github' || s.id === 'srv_github')}
        onClose={() => setGithubConnectOpen(false)}
      />

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
        isSynced={Boolean(authUser)}
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
        isSynced={Boolean(authUser)}
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

      <BottomSheet
        open={Boolean(promptArgsTarget)}
        onClose={() => setPromptArgsTarget(null)}
        title={promptArgsTarget ? `/${promptArgsTarget.prompt.name}` : 'Prompt Arguments'}
        subtitle={promptArgsTarget?.prompt.description ?? 'Provide arguments for this MCP prompt'}
      >
        {promptArgsTarget && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void executeGetMcpPrompt(
                promptArgsTarget.server,
                promptArgsTarget.prompt,
                promptArgsValues
              );
            }}
            className="space-y-3"
          >
            {(promptArgsTarget.prompt.arguments ?? []).map((arg) => (
              <div key={arg.name}>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {arg.name} {arg.required ? '*' : '(optional)'}
                </label>
                <input
                  type="text"
                  required={Boolean(arg.required)}
                  value={promptArgsValues[arg.name] ?? ''}
                  onChange={(e) =>
                    setPromptArgsValues((prev) => ({ ...prev, [arg.name]: e.target.value }))
                  }
                  placeholder={arg.description ?? `Enter ${arg.name}`}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
                />
              </div>
            ))}
            <button
              type="submit"
              disabled={mcpBusy}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="w-full min-h-[46px] rounded-full text-sm font-semibold disabled:opacity-50"
            >
              {mcpBusy ? 'Loading prompt...' : 'Insert into Composer'}
            </button>
          </form>
        )}
      </BottomSheet>

      <RunTraceSheet
        open={Boolean(traceSheetState)}
        trace={traceSheetState?.trace ?? null}
        messageTitle={traceSheetState?.title}
        dynamicModels={dynamicModels}
        conversationTraces={conversationTraces}
        onSelectTrace={(entry) =>
          setTraceSheetState({
            trace: entry.trace,
            title: entry.label,
          })
        }
        onRetryToolCall={retryToolCall}
        onClose={() => setTraceSheetState(null)}
      />

      <PromptMacrosSheet
        open={macrosSheetOpen}
        macros={savedPrompts}
        onClose={() => setMacrosSheetOpen(false)}
        onInsertMacro={(resolved) => {
          setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${resolved}` : resolved));
          setTimeout(() => composerRef.current?.focus(), 40);
        }}
        onSaveMacro={savePromptMacro}
        onDeleteMacro={deletePromptMacro}
      />

      <ProjectsModal
        open={projectsModalOpen}
        onClose={() => setProjectsModalOpen(false)}
        projects={projects}
        activeProjectId={activeConv?.projectId ?? null}
        agents={agents}
        servers={servers}
        onSelectProject={(projectId) => setConversationProject(projectId)}
        onSaveProject={saveProject}
        onDeleteProject={deleteProject}
      />

      <CommandPaletteModal
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        savedPrompts={savedPrompts}
        servers={servers}
        projects={projects}
        onInsertPrompt={(text) => {
          setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
          setTimeout(() => composerRef.current?.focus(), 40);
        }}
        onSwitchMode={(mode) => setChatMode(mode)}
        onSelectProject={(projectId) => setConversationProject(projectId)}
        onStartNewChat={() => startNewConversation(activeAgent.id, activeModel.id)}
        onToggleCompare={() => setCompareEnabled((v) => !v)}
        onOpenTrace={() => {
          if (conversationTraces[0]) {
            setTraceSheetState({
              trace: conversationTraces[conversationTraces.length - 1].trace,
              title: conversationTraces[conversationTraces.length - 1].label,
            });
          }
        }}
        onOpenCanvas={handleToggleHeaderCanvas}
      />
    </div>
  );
}
