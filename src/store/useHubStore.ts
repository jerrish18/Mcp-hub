import { publishCanvasRevision, type CanvasPublishRequest, type CanvasPublishResult } from '../services/mcp/canvasPublish';
import type { CanvasEditLink } from '../utils/canvasArtifacts';
import type { TraceToolRetry } from '../services/llm/agentLoop';
import { readA2uiMode } from '../utils/a2ui';
import { create } from 'zustand';
import { DEFAULT_MODEL_ID, getModelById, normalizeModelId } from '../config/models';
import { logoutCurrentAccount, type AuthUser } from '../services/auth/appAuth';
import {
  buildAgentToolCatalog,
  resolveToolPermissionPolicy,
  durationToExpiresAt,
  pruneExpiredAlwaysAllowRules,
  runAgentLoop,
} from '../services/llm/agentLoop';
import { getApiKeyForProvider, streamWithRateLimitFallback, syncLiveProviderModels } from '../services/llm/provider';
import type { LlmConversationItem } from '../services/llm/types';
import type { ParsedMcpDeepLink } from '../config/connectors';
import {
  callMcpTool,
  closeAllMcpConnections,
  connectAndInspectServer,
  disconnectMcpServer,
  onMcpListChanged,
  pingMcpServer,
  reconnectWithBackoff,
  sendMcpRpc,
} from '../services/mcp/client';
import { GITHUB_TOOLS, YOUTUBE_TOOLS } from '../services/mcp/virtualConnectors';
import {
  deleteRemoteConversation,
  deleteRemoteStudyNote,
  fetchRemoteWorkspace,
  getAccountScope,
  mergeWorkspaceSnapshots,
  pushRemoteWorkspace,
  type WorkspaceSnapshot,
} from '../services/storage/accountSync';
import { historyDb } from '../services/storage/historyDb';
import {
  deleteServerSecrets,
  disablePassphraseVault,
  enablePassphraseVault,
  isPassphraseVaultEnabled,
  isVaultUnlocked,
  loadProviderKeys,
  loadServerSecrets,
  lockVault,
  saveProviderKeys,
  saveServerSecrets,
  unlockVaultWithPassphrase,
} from '../services/storage/secureStorage';
import type {
  AgentProfile,
  AppSettings,
  ApprovalDecision,
  ApprovalResolution,
  ChatAttachment,
  ChatMessage,
  ChatMode,
  Conversation,
  EffortLevel,
  GroundingCitation,
  KnowledgeSourceMode,
  McpServerConfig,
  ModelConfig,
  PendingApproval,
  ProviderId,
  ProviderKeys,
  RunTrace,
  SavedPrompt,
  ServerSecretPayload,
  ToolCallRecord,
  ToolPolicyRule,
} from '../types';
import type { SavedStudyNote } from '../utils/studyTools';
import { safeErrorMessage } from '../utils/redact';
import { finishProTaskPlan, makeProTaskPlan, normalizeProPlan, parseProTaskPlan, PRO_PLAN_SYSTEM_PROMPT, shouldPlanProTask, splitProTask, type ProTaskPlan } from '../utils/proTaskPlan';
import {
  BUILT_IN_AGENTS,
  DEFAULT_SAVED_PROMPTS,
  DEFAULT_SERVERS,
  DEFAULT_SETTINGS,
  DEFAULT_STUDY_INSTRUCTIONS,
} from './defaults';

const LEGACY_STATE_KEY = 'mcphub_app_state_v1';
const LEGACY_SAVED_NOTES_KEY = 'mcphub_saved_study_notes_v1';
const STATE_KEY_PREFIX = 'mcphub_app_state_v2::';
const SAVED_NOTES_KEY_PREFIX = 'mcphub_saved_study_notes_v2::';

function readSavedStudyNotes(scope = 'guest'): SavedStudyNote[] {
  try {
    let raw = globalThis.localStorage?.getItem(`${SAVED_NOTES_KEY_PREFIX}${scope}`);
    if (!raw && scope === 'guest') {
      raw = globalThis.localStorage?.getItem(LEGACY_SAVED_NOTES_KEY) ?? null;
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedStudyNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedStudyNotes(notes: SavedStudyNote[], scope = 'guest'): void {
  try {
    globalThis.localStorage?.setItem(`${SAVED_NOTES_KEY_PREFIX}${scope}`, JSON.stringify(notes));
  } catch {
    // ignore storage quota errors
  }
}

interface PersistedMeta {
  servers: McpServerConfig[];
  agents: AgentProfile[];
  settings: AppSettings;
  dynamicModels: ModelConfig[];
  dismissedDefaultServerIds: string[];
  savedPrompts?: SavedPrompt[];
  updatedAt?: number;
}

function mergeDefaultServers(saved: McpServerConfig[], dismissedIds: string[]): McpServerConfig[] {
  const refreshed = saved.map((srv) => {
    if (srv.url === 'virtual://github-api') {
      return { ...srv, tools: GITHUB_TOOLS };
    }
    if (srv.url === 'virtual://youtube-data-api') {
      return { ...srv, tools: YOUTUBE_TOOLS };
    }
    return srv;
  });
  const existingIds = new Set(refreshed.map((s) => s.id));
  const missing = DEFAULT_SERVERS.filter(
    (def) => !existingIds.has(def.id) && !dismissedIds.includes(def.id)
  );
  return [...refreshed, ...missing];
}

function mergeBuiltInAgents(saved: AgentProfile[]): AgentProfile[] {
  const migrated = saved.map((a) => {
    const builtInMatch = BUILT_IN_AGENTS.find((b) => b.id === a.id);
    return {
      ...a,
      defaultModelId: normalizeModelId(a.defaultModelId),
      defaultChatMode: a.defaultChatMode ?? builtInMatch?.defaultChatMode ?? 'professional',
      studyInstructions: a.studyInstructions ?? builtInMatch?.studyInstructions ?? '',
      allowedToolNames: a.allowedToolNames ?? null,
    };
  });
  const existingIds = new Set(migrated.map((a) => a.id));
  const missingBuiltIns = BUILT_IN_AGENTS.filter((b) => !existingIds.has(b.id));
  return [...migrated, ...missingBuiltIns];
}

function migrateConversation(c: Conversation): Conversation {
  const nextId = normalizeModelId(c.modelId);
  return {
    ...c,
    modelId: nextId,
    chatMode: c.chatMode ?? 'professional',
    knowledgeSource: c.knowledgeSource ?? 'auto',
    studyInstructions: c.studyInstructions ?? DEFAULT_STUDY_INSTRUCTIONS,
    messages: c.messages.map((message) => {
      const plan = message.proTaskPlan;
      if (!plan || (plan.status !== 'review' && plan.status !== 'running')) return message;
      return { ...message, isStreaming: false, proTaskPlan: finishProTaskPlan(plan, true) };
    }),
  };
}

function readPersistedMeta(scope = 'guest'): PersistedMeta {
  try {
    let raw = globalThis.localStorage?.getItem(`${STATE_KEY_PREFIX}${scope}`);
    if (!raw && scope === 'guest') {
      raw = globalThis.localStorage?.getItem(LEGACY_STATE_KEY) ?? null;
    }
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedMeta>;
      const dismissed = parsed.dismissedDefaultServerIds ?? [];
      const savedServers = parsed.servers && parsed.servers.length > 0 ? parsed.servers : [];
      const mergedServers =
        savedServers.length > 0 ? mergeDefaultServers(savedServers, dismissed) : DEFAULT_SERVERS;
      const migratedAgents =
        parsed.agents && parsed.agents.length > 0
          ? mergeBuiltInAgents(parsed.agents)
          : BUILT_IN_AGENTS;
      const mergedSettings: AppSettings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}), a2uiMode: readA2uiMode(parsed.settings) };
      delete mergedSettings.a2uiEnabled;
      const rawRules = mergedSettings.alwaysAllowedRules ?? [];
      const prunedRules = pruneExpiredAlwaysAllowRules(rawRules);
      const expiredKeys = new Set(
        rawRules
          .filter((r) => !prunedRules.some((p) => p.qualifiedKey === r.qualifiedKey))
          .map((r) => r.qualifiedKey)
      );
      return {
        servers: mergedServers,
        agents: migratedAgents,
        settings: {
          ...mergedSettings,
          alwaysAllowedRules: prunedRules,
          alwaysAllowedTools: mergedSettings.alwaysAllowedTools.filter((k) => !expiredKeys.has(k)),
        },
        dynamicModels: parsed.dynamicModels ?? [],
        dismissedDefaultServerIds: dismissed,
        savedPrompts:
          parsed.savedPrompts && parsed.savedPrompts.length > 0
            ? parsed.savedPrompts
            : DEFAULT_SAVED_PROMPTS,
        updatedAt: Number(parsed.updatedAt) || 0,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    servers: DEFAULT_SERVERS,
    agents: BUILT_IN_AGENTS,
    settings: DEFAULT_SETTINGS,
    dynamicModels: [],
    dismissedDefaultServerIds: [],
    savedPrompts: DEFAULT_SAVED_PROMPTS,
    updatedAt: 0,
  };
}

function writePersistedMeta(meta: PersistedMeta, scope = 'guest'): void {
  try {
    globalThis.localStorage?.setItem(
      `${STATE_KEY_PREFIX}${scope}`,
      JSON.stringify({ ...meta, updatedAt: meta.updatedAt ?? Date.now() })
    );
  } catch {
    // ignore storage errors
  }
}

async function ensureSandboxConnected(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const updatedServers = [...servers];
  const sandboxIdx = updatedServers.findIndex((srv) => srv.url === 'virtual://mcp-hub-sandbox');
  if (
    sandboxIdx !== -1 &&
    (updatedServers[sandboxIdx].tools.length === 0 ||
      updatedServers[sandboxIdx].status !== 'connected')
  ) {
    try {
      const inspected = await connectAndInspectServer({
        server: updatedServers[sandboxIdx],
        secrets: {},
      });
      updatedServers[sandboxIdx] = {
        ...updatedServers[sandboxIdx],
        status: 'connected',
        lastConnectedAt: Date.now(),
        tools: inspected.tools,
        resources: inspected.resources,
        prompts: inspected.prompts,
      };
    } catch {
      // ignore
    }
  }
  return updatedServers;
}

function createNewConversation(agent: AgentProfile, modelIdOverride?: string): Conversation {
  const now = Date.now();
  const chatMode: ChatMode = agent.defaultChatMode ?? 'professional';
  return {
    id: `conv_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Chat',
    agentId: agent.id,
    modelId: modelIdOverride ?? agent.defaultModelId ?? DEFAULT_MODEL_ID,
    effort: agent.defaultEffort,
    chatMode,
    knowledgeSource: 'auto',
    studyInstructions: agent.studyInstructions?.trim() || DEFAULT_STUDY_INSTRUCTIONS,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export type HubTabId = 'dashboard' | 'chat' | 'servers' | 'agents' | 'settings';

export type WorkspaceSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export interface CompareResultItem {
  modelId: string;
  status: 'running' | 'done' | 'error';
  content: string;
  reasoning: string;
  citations: GroundingCitation[];
  durationMs: number;
  runTrace?: RunTrace;
  error?: string;
}

export interface HubState {
  liveTrace?: { messageId: string; trace: RunTrace };
  pendingProPlan?: { messageId: string; resolve: (steps: string[] | null) => void };
  resolveProPlan: (steps: string[] | null) => void;
  initialized: boolean;
  isLocked: boolean;
  passphraseVaultEnabled: boolean;
  vaultLocked: boolean;
  authUser: AuthUser | null;
  authGuestMode: boolean;
  syncStatus: WorkspaceSyncStatus;
  lastSyncedAt: number | null;
  syncError: string | null;
  activeTab: HubTabId;
  servers: McpServerConfig[];
  agents: AgentProfile[];
  settings: AppSettings;
  providerKeys: ProviderKeys;
  dynamicModels: ModelConfig[];
  dismissedDefaultServerIds: string[];
  savedPrompts: SavedPrompt[];
  conversations: Conversation[];
  activeConversationId: string | null;
  savedStudyNotes: SavedStudyNote[];
  isRunning: boolean;
  abortController: AbortController | null;
  pendingApproval: PendingApproval | null;
  pendingDeepLinkServer: ParsedMcpDeepLink | null;

  initializeApp: (autostartSkipOnboarding?: boolean) => Promise<void>;
  setActiveTab: (tab: HubTabId) => void;
  setPendingDeepLinkServer: (link: ParsedMcpDeepLink | null) => void;
  unlockApp: () => void;
  lockApp: () => void;
  unlockVault: (passphrase: string) => Promise<boolean>;
  enableVaultPassphrase: (passphrase: string) => Promise<void>;
  disableVaultPassphrase: () => Promise<void>;
  lockVaultSession: () => void;

  // Auth & Database Sync
  setAuthUser: (user: AuthUser | null) => void;
  continueAsGuest: () => void;
  signOutAccount: () => Promise<void>;
  syncWorkspaceNow: () => Promise<void>;

  // Settings & Keys & Models
  updateSettings: (patch: Partial<AppSettings>) => void;
  setProviderKeys: (keys: ProviderKeys) => Promise<void>;
  syncModels: (keysOverride?: ProviderKeys) => Promise<{ count: number; providers: string[] }>;
  addCustomModel: (provider: ProviderId, modelId: string, label?: string) => void;
  revokeAlwaysAllowedTool: (qualifiedKey: string) => void;
  revokeAlwaysAllowedRule: (index: number) => void;
  addToolPolicy: (rule: ToolPolicyRule) => void;
  removeToolPolicy: (index: number) => void;

  // Servers
  addOrUpdateServer: (server: McpServerConfig, secrets?: ServerSecretPayload) => Promise<void>;
  quickConnectServer: (
    serverId: string,
    configPatch: Partial<McpServerConfig>,
    secrets: ServerSecretPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteServer: (serverId: string) => Promise<void>;
  connectServer: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
  pingServer: (serverId: string) => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  disconnectServer: (serverId: string) => Promise<void>;
  toggleServerTool: (serverId: string, toolName: string) => void;
  disconnectAllForBackground: () => void;

  // Agents
  saveAgent: (agent: AgentProfile) => void;
  duplicateAgent: (agentId: string) => AgentProfile | null;
  deleteAgent: (agentId: string) => void;

  // Conversations & Chat
  startNewConversation: (agentId?: string, modelId?: string) => void;
  selectConversation: (conversationId: string) => void;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  setActiveAgent: (agentId: string) => void;
  setActiveModel: (modelId: string) => void;
  setActiveEffort: (effort: EffortLevel) => void;
  setChatMode: (mode: ChatMode) => void;
  setKnowledgeSource: (source: KnowledgeSourceMode) => void;
  setStudyInstructions: (instructions: string) => void;
  sendMessage: (
    text: string,
    options?: { autoApproveWrites?: boolean; requireWriteApproval?: boolean; retryToolCall?: TraceToolRetry; canvasEdit?: CanvasEditLink; attachments?: ChatAttachment[]; displayText?: string }
  ) => Promise<void>;
  stopRun: () => void;
  publishCanvas: (request: CanvasPublishRequest) => Promise<CanvasPublishResult>;
  resolvePendingApproval: (decision: ApprovalDecision | ApprovalResolution, expectedId?: string) => void;
  enableDemoSandbox: () => Promise<void>;
  saveStudyNote: (note: Omit<SavedStudyNote, 'id' | 'createdAt'>) => void;
  removeSavedStudyNote: (noteId: string) => void;
  savePromptMacro: (macro: Omit<SavedPrompt, 'id' | 'updatedAt'> & { id?: string }) => SavedPrompt;
  deletePromptMacro: (macroId: string) => void;
  runCompareTurn: (
    rawText: string,
    modelIds: string[],
    options?: {
      attachments?: ChatAttachment[];
      onModelUpdate?: (modelId: string, item: CompareResultItem) => void;
    }
  ) => Promise<CompareResultItem[]>;
  acceptComparedReply: (
    promptText: string,
    item: CompareResultItem,
    attachments?: ChatAttachment[]
  ) => Promise<void>;
}

const initialMeta = readPersistedMeta('guest');

export const useHubStore = create<HubState>((set, get) => {
  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncRun = 0;
  let listChangedSubscribed = false;

  const activeScope = () => getAccountScope(get().authUser);

  const buildSnapshotFromState = (state: HubState, updatedAt = Date.now()): WorkspaceSnapshot => ({
    settings: state.settings,
    agents: state.agents,
    servers: state.servers,
    dynamicModels: state.dynamicModels,
    dismissedDefaultServerIds: state.dismissedDefaultServerIds,
    savedPrompts: state.savedPrompts,
    conversations: state.conversations,
    savedStudyNotes: state.savedStudyNotes,
    updatedAt,
  });

  const pushCurrentStateToRemote = async () => {
    const user = get().authUser;
    if (!user) return;
    set({ syncStatus: 'syncing', syncError: null });
    try {
      const syncedAt = await pushRemoteWorkspace(user, buildSnapshotFromState(get()));
      if (get().authUser?.id !== user.id) return;
      set({ syncStatus: 'synced', lastSyncedAt: syncedAt, syncError: null });
    } catch (err) {
      if (get().authUser?.id !== user.id) return;
      set({ syncStatus: 'error', syncError: safeErrorMessage(err) });
    }
  };

  const scheduleRemoteSync = () => {
    if (!get().authUser) return;
    if (syncDebounceTimer !== null) {
      clearTimeout(syncDebounceTimer);
    }
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      void pushCurrentStateToRemote();
    }, 1200);
  };

  const persist = () => {
    const s = get();
    const scope = getAccountScope(s.authUser);
    writePersistedMeta(
      {
        servers: s.servers,
        agents: s.agents,
        settings: s.settings,
        dynamicModels: s.dynamicModels,
        dismissedDefaultServerIds: s.dismissedDefaultServerIds,
        savedPrompts: s.savedPrompts,
        updatedAt: Date.now(),
      },
      scope
    );
    scheduleRemoteSync();
  };

  const hydrateAccountWorkspace = async (user: AuthUser) => {
    const runId = ++activeSyncRun;
    const scope = getAccountScope(user);

    // Immediately show scoped local cache for this user so prior accounts never leak
    const localMeta = readPersistedMeta(scope);
    const localNotes = readSavedStudyNotes(scope);
    const localConvsRaw = await historyDb.listConversations(scope);
    const localConvs = localConvsRaw.map(migrateConversation);

    if (runId !== activeSyncRun || get().authUser?.id !== user.id) return;

    const initialServers = await ensureSandboxConnected(localMeta.servers);
    if (runId !== activeSyncRun || get().authUser?.id !== user.id) return;

    set({
      servers: initialServers,
      agents: localMeta.agents,
      settings: localMeta.settings,
      dynamicModels: localMeta.dynamicModels,
      dismissedDefaultServerIds: localMeta.dismissedDefaultServerIds,
      savedPrompts: localMeta.savedPrompts ?? DEFAULT_SAVED_PROMPTS,
      conversations: localConvs,
      activeConversationId: localConvs[0]?.id ?? null,
      savedStudyNotes: localNotes,
      syncStatus: 'syncing',
      syncError: null,
    });

    try {
      const remote = await fetchRemoteWorkspace(user);
      if (runId !== activeSyncRun || get().authUser?.id !== user.id) return;

      const merged = mergeWorkspaceSnapshots(
        {
          settings: localMeta.settings,
          agents: localMeta.agents,
          servers: initialServers,
          dynamicModels: localMeta.dynamicModels,
          dismissedDefaultServerIds: localMeta.dismissedDefaultServerIds,
          savedPrompts: localMeta.savedPrompts ?? DEFAULT_SAVED_PROMPTS,
          conversations: localConvs,
          savedStudyNotes: localNotes,
          updatedAt: localMeta.updatedAt ?? 0,
        },
        remote
      );

      let mergedConvs = merged.conversations.map(migrateConversation);
      if (mergedConvs.length === 0) {
        const keys = get().providerKeys;
        const defaultAgent = merged.agents[0] ?? BUILT_IN_AGENTS[0];
        const hasAnyRealKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
        const firstModel = hasAnyRealKey ? defaultAgent.defaultModelId : 'demo-sandbox';
        mergedConvs = [createNewConversation(defaultAgent, firstModel)];
      }

      const hydratedServers = await ensureSandboxConnected(
        mergeDefaultServers(merged.servers, merged.dismissedDefaultServerIds)
      );
      if (runId !== activeSyncRun || get().authUser?.id !== user.id) return;

      const finalSnapshot: WorkspaceSnapshot = {
        ...merged,
        servers: hydratedServers,
        agents: mergeBuiltInAgents(merged.agents),
        conversations: mergedConvs,
      };

      writePersistedMeta(
        {
          servers: finalSnapshot.servers,
          agents: finalSnapshot.agents,
          settings: finalSnapshot.settings,
          dynamicModels: finalSnapshot.dynamicModels,
          dismissedDefaultServerIds: finalSnapshot.dismissedDefaultServerIds,
          savedPrompts: finalSnapshot.savedPrompts,
          updatedAt: finalSnapshot.updatedAt,
        },
        scope
      );
      writeSavedStudyNotes(finalSnapshot.savedStudyNotes, scope);
      await historyDb.replaceScopeConversations(finalSnapshot.conversations, scope);

      if (runId !== activeSyncRun || get().authUser?.id !== user.id) return;

      const currentActiveId = get().activeConversationId;
      const nextActiveId =
        finalSnapshot.conversations.find((c) => c.id === currentActiveId)?.id ??
        finalSnapshot.conversations[0]?.id ??
        null;

      set({
        servers: finalSnapshot.servers,
        agents: finalSnapshot.agents,
        settings: finalSnapshot.settings,
        dynamicModels: finalSnapshot.dynamicModels,
        dismissedDefaultServerIds: finalSnapshot.dismissedDefaultServerIds,
        savedPrompts:
          finalSnapshot.savedPrompts && finalSnapshot.savedPrompts.length > 0
            ? finalSnapshot.savedPrompts
            : DEFAULT_SAVED_PROMPTS,
        conversations: finalSnapshot.conversations,
        activeConversationId: nextActiveId,
        savedStudyNotes: finalSnapshot.savedStudyNotes,
      });

      // Push back if remote didn't exist yet or local had newer entries
      if (!remote || (localMeta.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        const syncedAt = await pushRemoteWorkspace(user, finalSnapshot);
        if (runId === activeSyncRun && get().authUser?.id === user.id) {
          set({ syncStatus: 'synced', lastSyncedAt: syncedAt, syncError: null });
        }
      } else {
        set({
          syncStatus: 'synced',
          lastSyncedAt: remote.updatedAt || Date.now(),
          syncError: null,
        });
      }
    } catch (err) {
      if (runId !== activeSyncRun || get().authUser?.id !== user.id) return;
      // Ensure at least one conversation exists locally even if remote sync errored
      if (get().conversations.length === 0) {
        const keys = get().providerKeys;
        const defaultAgent = get().agents[0] ?? BUILT_IN_AGENTS[0];
        const hasAnyRealKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
        const firstModel = hasAnyRealKey ? defaultAgent.defaultModelId : 'demo-sandbox';
        const fresh = createNewConversation(defaultAgent, firstModel);
        await historyDb.saveConversation(fresh, scope);
        set({ conversations: [fresh], activeConversationId: fresh.id });
      }
      set({
        syncStatus: 'error',
        syncError: safeErrorMessage(err),
      });
    }
  };

  const restoreGuestWorkspace = async () => {
    const runId = ++activeSyncRun;
    const guestMeta = readPersistedMeta('guest');
    const guestNotes = readSavedStudyNotes('guest');
    const guestConvsRaw = await historyDb.listConversations('guest');
    if (runId !== activeSyncRun) return;

    let guestConvs = guestConvsRaw.map(migrateConversation);
    const updatedServers = await ensureSandboxConnected(guestMeta.servers);
    if (runId !== activeSyncRun) return;

    if (guestConvs.length === 0) {
      const keys = get().providerKeys;
      const defaultAgent = guestMeta.agents[0] ?? BUILT_IN_AGENTS[0];
      const hasAnyRealKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
      const firstModel = hasAnyRealKey ? defaultAgent.defaultModelId : 'demo-sandbox';
      const fresh = createNewConversation(defaultAgent, firstModel);
      guestConvs = [fresh];
      await historyDb.saveConversation(fresh, 'guest');
    }

    set({
      servers: updatedServers,
      agents: guestMeta.agents,
      settings: guestMeta.settings,
      dynamicModels: guestMeta.dynamicModels,
      dismissedDefaultServerIds: guestMeta.dismissedDefaultServerIds,
      savedPrompts: guestMeta.savedPrompts ?? DEFAULT_SAVED_PROMPTS,
      conversations: guestConvs,
      activeConversationId: guestConvs[0]?.id ?? null,
      savedStudyNotes: guestNotes,
      syncStatus: 'idle',
      lastSyncedAt: null,
      syncError: null,
    });
  };

  return {
    initialized: false,
    isLocked: initialMeta.settings.biometricLockEnabled,
    passphraseVaultEnabled: isPassphraseVaultEnabled(),
    vaultLocked: isPassphraseVaultEnabled() && !isVaultUnlocked(),
    authUser: null,
    authGuestMode: false,
    syncStatus: 'idle',
    lastSyncedAt: null,
    syncError: null,
    activeTab: 'dashboard',
    servers: initialMeta.servers,
    agents: initialMeta.agents,
    settings: initialMeta.settings,
    providerKeys: {},
    dynamicModels: initialMeta.dynamicModels,
    dismissedDefaultServerIds: initialMeta.dismissedDefaultServerIds,
    savedPrompts: initialMeta.savedPrompts ?? DEFAULT_SAVED_PROMPTS,
    conversations: [],
    activeConversationId: null,
    savedStudyNotes: readSavedStudyNotes('guest'),
    isRunning: false,
    abortController: null,
    pendingApproval: null,
    pendingDeepLinkServer: null,

    setActiveTab: (tab) => set({ activeTab: tab }),
    setPendingDeepLinkServer: (link) => set({ pendingDeepLinkServer: link }),

    setAuthUser: (user) => {
      const prev = get().authUser;
      if (user && prev && prev.id === user.id && prev.provider === user.provider) {
        return;
      }
      if (!user && !prev) {
        return;
      }

      if (syncDebounceTimer !== null) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
      }

      if (user) {
        set({
          authUser: user,
          authGuestMode: false,
          syncStatus: 'syncing',
          syncError: null,
        });
        void hydrateAccountWorkspace(user);
      } else {
        set({
          authUser: null,
          syncStatus: 'idle',
          lastSyncedAt: null,
          syncError: null,
        });
        void restoreGuestWorkspace();
      }
    },

    continueAsGuest: () => {
      set({ authGuestMode: true });
      void restoreGuestWorkspace();
    },

    signOutAccount: async () => {
      if (syncDebounceTimer !== null) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
      }
      await logoutCurrentAccount();
      set({
        authUser: null,
        authGuestMode: false,
        activeTab: 'chat',
        syncStatus: 'idle',
        lastSyncedAt: null,
        syncError: null,
      });
      await restoreGuestWorkspace();
    },

    syncWorkspaceNow: async () => {
      const user = get().authUser;
      if (!user) return;
      if (syncDebounceTimer !== null) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = null;
      }
      await hydrateAccountWorkspace(user);
    },

    initializeApp: async (autostartSkipOnboarding = false) => {
      const scope = getAccountScope(get().authUser);
      const [keys, rawConvs] = await Promise.all([
        loadProviderKeys(),
        historyDb.listConversations(scope),
      ]);

      const convs = rawConvs.map(migrateConversation);
      const state = get();
      const nextSettings = autostartSkipOnboarding
        ? { ...state.settings, onboardingCompleted: true }
        : state.settings;

      const updatedServers = await ensureSandboxConnected(state.servers);

      let activeConvId = convs[0]?.id ?? null;
      let nextConvs = convs;
      if (!activeConvId) {
        const defaultAgent = state.agents[0] ?? BUILT_IN_AGENTS[0];
        const hasAnyRealKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
        const firstModel = hasAnyRealKey ? defaultAgent.defaultModelId : 'demo-sandbox';
        const fresh = createNewConversation(defaultAgent, firstModel);
        nextConvs = [fresh];
        activeConvId = fresh.id;
        await historyDb.saveConversation(fresh, scope);
      }

      set({
        initialized: true,
        passphraseVaultEnabled: isPassphraseVaultEnabled(),
        vaultLocked: isPassphraseVaultEnabled() && !isVaultUnlocked(),
        providerKeys: keys,
        conversations: nextConvs,
        activeConversationId: activeConvId,
        servers: updatedServers,
        settings: nextSettings,
        authGuestMode: autostartSkipOnboarding ? true : state.authGuestMode,
      });
      persist();

      if (!listChangedSubscribed) {
        listChangedSubscribed = true;
        onMcpListChanged((serverId, kind) => {
          const target = get().servers.find((s) => s.id === serverId);
          if (!target || target.status !== 'connected') return;
          void (async () => {
            try {
              const secrets = await loadServerSecrets(serverId);
              if (kind === 'tools') {
                const res = await sendMcpRpc<{ tools?: McpServerConfig['tools'] }>({
                  server: target,
                  secrets,
                  saveUpdatedSecrets: (u) => saveServerSecrets(serverId, u),
                  method: 'tools/list',
                });
                set((s) => ({
                  servers: s.servers.map((srv) =>
                    srv.id === serverId ? { ...srv, tools: res.result?.tools ?? srv.tools } : srv
                  ),
                }));
              } else if (kind === 'resources') {
                const res = await sendMcpRpc<{ resources?: McpServerConfig['resources'] }>({
                  server: target,
                  secrets,
                  saveUpdatedSecrets: (u) => saveServerSecrets(serverId, u),
                  method: 'resources/list',
                });
                set((s) => ({
                  servers: s.servers.map((srv) =>
                    srv.id === serverId
                      ? { ...srv, resources: res.result?.resources ?? srv.resources }
                      : srv
                  ),
                }));
              } else if (kind === 'prompts') {
                const res = await sendMcpRpc<{ prompts?: McpServerConfig['prompts'] }>({
                  server: target,
                  secrets,
                  saveUpdatedSecrets: (u) => saveServerSecrets(serverId, u),
                  method: 'prompts/list',
                });
                set((s) => ({
                  servers: s.servers.map((srv) =>
                    srv.id === serverId ? { ...srv, prompts: res.result?.prompts ?? srv.prompts } : srv
                  ),
                }));
              }
              persist();
            } catch {
              // ignore background refresh error
            }
          })();
        });
      }
    },

    unlockApp: () => set({ isLocked: false }),
    lockApp: () => set({ isLocked: true }),
    unlockVault: async (passphrase) => {
      const ok = await unlockVaultWithPassphrase(passphrase);
      if (!ok) return false;
      const keys = await loadProviderKeys();
      set({
        vaultLocked: false,
        passphraseVaultEnabled: isPassphraseVaultEnabled(),
        providerKeys: keys,
      });
      return true;
    },
    enableVaultPassphrase: async (passphrase) => {
      await enablePassphraseVault(passphrase);
      set({
        passphraseVaultEnabled: true,
        vaultLocked: false,
      });
    },
    disableVaultPassphrase: async () => {
      await disablePassphraseVault();
      set({
        passphraseVaultEnabled: false,
        vaultLocked: false,
      });
    },
    lockVaultSession: () => {
      lockVault();
      set({
        vaultLocked: isPassphraseVaultEnabled() && !isVaultUnlocked(),
        providerKeys: {},
      });
    },

    updateSettings: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }));
      persist();
    },

    setProviderKeys: async (keys) => {
      await saveProviderKeys(keys);
      set({ providerKeys: keys });
    },

    syncModels: async (keysOverride) => {
      const keys = keysOverride ?? get().providerKeys;
      const { models, syncedProviders } = await syncLiveProviderModels(keys);
      if (models.length > 0) {
        const existingCustom = get().dynamicModels.filter(
          (m) => !models.some((fresh) => fresh.id === m.id) && m.description === 'Custom user model'
        );
        set({ dynamicModels: [...models, ...existingCustom] });
        persist();
      }
      return { count: models.length, providers: syncedProviders };
    },

    addCustomModel: (provider, modelId, label) => {
      const trimmed = modelId.trim();
      if (!trimmed) return;
      const custom: ModelConfig = {
        id: trimmed,
        provider,
        label: label?.trim() || `${trimmed} (Custom)`,
        description: 'Custom user model',
        contextWindow: 128_000,
        supportsThinkingLevel: provider === 'gemini',
        supportsReasoningEffort: provider !== 'gemini',
        isFreeTier: true,
      };
      set((s) => ({
        dynamicModels: [custom, ...s.dynamicModels.filter((m) => m.id !== trimmed)],
      }));
      persist();
    },

    revokeAlwaysAllowedTool: (qualifiedKey) => {
      set((s) => ({
        settings: {
          ...s.settings,
          alwaysAllowedTools: s.settings.alwaysAllowedTools.filter((k) => k !== qualifiedKey),
          alwaysAllowedRules: (s.settings.alwaysAllowedRules ?? []).filter(
            (r) => r.qualifiedKey !== qualifiedKey
          ),
        },
      }));
      persist();
    },

    revokeAlwaysAllowedRule: (index) => {
      set((s) => {
        const rules = [...(s.settings.alwaysAllowedRules ?? [])];
        const removed = rules[index];
        rules.splice(index, 1);
        const stillHasRule =
          removed && rules.some((r) => r.qualifiedKey === removed.qualifiedKey);
        return {
          settings: {
            ...s.settings,
            alwaysAllowedRules: rules,
            alwaysAllowedTools: stillHasRule || !removed
              ? s.settings.alwaysAllowedTools
              : s.settings.alwaysAllowedTools.filter((k) => k !== removed.qualifiedKey),
          },
        };
      });
      persist();
    },

    addToolPolicy: (rule) => {
      const cleanedKey = rule.qualifiedKey.trim();
      if (!cleanedKey) return;
      const cleanedPattern = rule.argPattern?.trim() || undefined;
      set((s) => {
        const existing = s.settings.toolPolicies ?? [];
        const filtered = existing.filter(
          (r) => !(r.qualifiedKey === cleanedKey && (r.argPattern || undefined) === cleanedPattern)
        );
        return {
          settings: {
            ...s.settings,
            toolPolicies: [
              ...filtered,
              { qualifiedKey: cleanedKey, policy: rule.policy, argPattern: cleanedPattern },
            ],
          },
        };
      });
      persist();
    },

    removeToolPolicy: (index) => {
      set((s) => {
        const next = [...(s.settings.toolPolicies ?? [])];
        next.splice(index, 1);
        return {
          settings: {
            ...s.settings,
            toolPolicies: next,
          },
        };
      });
      persist();
    },

    addOrUpdateServer: async (server, secrets) => {
      if (secrets) {
        await saveServerSecrets(server.id, secrets);
      }
      set((s) => {
        const exists = s.servers.some((item) => item.id === server.id);
        return {
          servers: exists
            ? s.servers.map((item) => (item.id === server.id ? server : item))
            : [...s.servers, server],
        };
      });
      persist();
    },

    quickConnectServer: async (serverId, configPatch, secrets) => {
      const existingSecrets = await loadServerSecrets(serverId);
      await saveServerSecrets(serverId, { ...existingSecrets, ...secrets });
      set((s) => ({
        servers: s.servers.map((srv) => (srv.id === serverId ? { ...srv, ...configPatch } : srv)),
      }));
      persist();
      return get().connectServer(serverId);
    },

    deleteServer: async (serverId) => {
      await deleteServerSecrets(serverId);
      const isDefault = DEFAULT_SERVERS.some((d) => d.id === serverId);
      set((s) => ({
        servers: s.servers.filter((srv) => srv.id !== serverId),
        dismissedDefaultServerIds:
          isDefault && !s.dismissedDefaultServerIds.includes(serverId)
            ? [...s.dismissedDefaultServerIds, serverId]
            : s.dismissedDefaultServerIds,
      }));
      persist();
    },

    connectServer: async (serverId) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return { ok: false, error: 'Server not found' };

      set((s) => ({
        servers: s.servers.map((item) =>
          item.id === serverId ? { ...item, status: 'connecting', lastError: undefined } : item
        ),
      }));

      try {
        const secrets = await loadServerSecrets(serverId);
        const res = await reconnectWithBackoff(
          () =>
            connectAndInspectServer({
              server,
              secrets,
              saveUpdatedSecrets: (updated) => saveServerSecrets(serverId, updated),
            }),
          { maxAttempts: 2, baseDelayMs: 350 }
        );
        const now = Date.now();
        set((s) => ({
          servers: s.servers.map((item) =>
            item.id === serverId
              ? {
                  ...item,
                  status: 'connected',
                  lastConnectedAt: now,
                  lastPingAt: now,
                  latencyMs: res.latencyMs,
                  protocolVersion: res.protocolVersion,
                  lastError: undefined,
                  tools: res.tools,
                  resources: res.resources,
                  prompts: res.prompts,
                }
              : item
          ),
        }));
        persist();
        return { ok: true };
      } catch (err) {
        const secrets = await loadServerSecrets(serverId);
        const knownSecrets = [
          secrets.bearerToken ?? '',
          secrets.basicPassword ?? '',
          secrets.oauthClientSecret ?? '',
          secrets.oauthTokens?.accessToken ?? '',
        ];
        const msg = safeErrorMessage(err, knownSecrets);
        const isAuthErr =
          msg.toLowerCase().includes('401') ||
          msg.toLowerCase().includes('expired') ||
          msg.toLowerCase().includes('oauth');

        set((s) => ({
          servers: s.servers.map((item) =>
            item.id === serverId
              ? {
                  ...item,
                  status: isAuthErr ? 'auth_expired' : 'error',
                  lastError: msg,
                }
              : item
          ),
        }));
        persist();
        return { ok: false, error: msg };
      }
    },

    pingServer: async (serverId) => {
      const server = get().servers.find((s) => s.id === serverId);
      if (!server) return { ok: false, latencyMs: 0, error: 'Server not found' };
      const secrets = await loadServerSecrets(serverId);
      const outcome = await pingMcpServer({
        server,
        secrets,
        saveUpdatedSecrets: (updated) => saveServerSecrets(serverId, updated),
      });
      const now = Date.now();
      set((s) => ({
        servers: s.servers.map((item) =>
          item.id === serverId
            ? {
                ...item,
                status: outcome.ok ? 'connected' : 'error',
                latencyMs: outcome.latencyMs,
                lastPingAt: now,
                lastError: outcome.ok ? undefined : outcome.error,
              }
            : item
        ),
      }));
      persist();
      return outcome;
    },

    disconnectServer: async (serverId) => {
      await disconnectMcpServer(serverId);
      set((s) => ({
        servers: s.servers.map((item) =>
          item.id === serverId
            ? { ...item, status: 'disconnected', lastError: undefined }
            : item
        ),
      }));
      persist();
    },

    toggleServerTool: (serverId, toolName) => {
      set((s) => ({
        servers: s.servers.map((srv) => {
          if (srv.id !== serverId) return srv;
          const isDisabled = srv.disabledTools.includes(toolName);
          return {
            ...srv,
            disabledTools: isDisabled
              ? srv.disabledTools.filter((t) => t !== toolName)
              : [...srv.disabledTools, toolName],
          };
        }),
      }));
      persist();
    },

    disconnectAllForBackground: () => {
      closeAllMcpConnections();
    },

    saveAgent: (agent) => {
      set((s) => {
        const exists = s.agents.some((a) => a.id === agent.id);
        return {
          agents: exists
            ? s.agents.map((a) => (a.id === agent.id ? agent : a))
            : [...s.agents, agent],
        };
      });
      persist();
    },

    duplicateAgent: (agentId) => {
      const src = get().agents.find((a) => a.id === agentId);
      if (!src) return null;
      const now = Date.now();
      const copy: AgentProfile = {
        ...src,
        id: `agent_${now}_${Math.random().toString(36).slice(2, 6)}`,
        name: `${src.name} (Copy)`,
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({ agents: [...s.agents, copy] }));
      persist();
      return copy;
    },

    deleteAgent: (agentId) => {
      const target = get().agents.find((a) => a.id === agentId);
      if (!target || target.isBuiltIn) return;
      set((s) => ({ agents: s.agents.filter((a) => a.id !== agentId) }));
      persist();
    },

    startNewConversation: (agentId, modelId) => {
      const state = get();
      const agent =
        state.agents.find((a) => a.id === agentId) ??
        state.agents[0] ??
        BUILT_IN_AGENTS[0];
      const hasAnyRealKey = Boolean(
        state.providerKeys.gemini || state.providerKeys.groq || state.providerKeys.openrouter
      );
      const chosenModel = modelId ?? (hasAnyRealKey ? agent.defaultModelId : 'demo-sandbox');
      const conv = createNewConversation(agent, chosenModel);
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeConversationId: conv.id,
      }));
      void historyDb.saveConversation(conv, activeScope());
      scheduleRemoteSync();
    },

    selectConversation: (conversationId) => {
      set({ activeConversationId: conversationId });
    },

    renameConversation: async (conversationId, title) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conversationId) return c;
          updated = { ...c, title: trimmed, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        await historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    deleteConversation: async (conversationId) => {
      const scope = activeScope();
      const user = get().authUser;
      await historyDb.deleteConversation(conversationId, scope);
      if (user) {
        void deleteRemoteConversation(user, conversationId);
      }
      set((s) => {
        const remaining = s.conversations.filter((c) => c.id !== conversationId);
        let nextActive = s.activeConversationId;
        if (nextActive === conversationId) {
          nextActive = remaining[0]?.id ?? null;
        }
        return { conversations: remaining, activeConversationId: nextActive };
      });
      if (!get().activeConversationId) {
        get().startNewConversation();
      } else {
        scheduleRemoteSync();
      }
    },

    setActiveAgent: (agentId) => {
      const state = get();
      const convId = state.activeConversationId;
      const agent = state.agents.find((a) => a.id === agentId);
      if (!convId || !agent) return;

      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = {
            ...c,
            agentId: agent.id,
            chatMode: agent.defaultChatMode ?? c.chatMode,
            studyInstructions: agent.studyInstructions?.trim()
              ? agent.studyInstructions
              : c.studyInstructions,
            updatedAt: Date.now(),
          };
          return updated;
        }),
      }));
      if (updated) {
        void historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    setActiveModel: (modelId) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = { ...c, modelId, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        void historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    setActiveEffort: (effort) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = { ...c, effort, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        void historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    setChatMode: (chatMode) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = { ...c, chatMode, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        void historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    setKnowledgeSource: (knowledgeSource) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = { ...c, knowledgeSource, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        void historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    setStudyInstructions: (studyInstructions) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = { ...c, studyInstructions, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        void historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    stopRun: () => {
      const state = get();
      state.abortController?.abort();
      state.pendingApproval?.resolve('deny');
      state.pendingProPlan?.resolve(null);
      set({ pendingApproval: null, pendingProPlan: undefined });
    },

    resolveProPlan: (steps) => {
      const pending = get().pendingProPlan;
      if (!pending) return;
      const normalized = steps ? normalizeProPlan(steps) : null;
      if (normalized && normalized.length < 2) return;
      set({ pendingProPlan: undefined });
      pending.resolve(normalized);
    },

    resolvePendingApproval: (decision, expectedId) => {
      const pending = get().pendingApproval;
      if (!pending || (expectedId !== undefined && pending.toolCallId !== expectedId)) return;
      set({ pendingApproval: null });
      pending.resolve(decision);
    },

    publishCanvas: async (request) => {
      const initial = get();
      if (initial.isRunning) return { error: 'Finish the current run first.' };
      const scope = activeScope();
      const conversation = initial.conversations.find((item) => item.id === initial.activeConversationId);
      const agentId = conversation?.agentId ?? initial.agents[0]?.id;
      const server = initial.servers.find((item) => item.url === 'virtual://github-api' && item.enabled && item.status === 'connected');
      if (!server) return { error: 'Connect GitHub first.' };

      const controller = new AbortController();
      const signal = controller.signal;
      set({ isRunning: true, abortController: controller });
      const checkSession = () => {
        const state = get();
        if (signal.aborted || activeScope() !== scope || state.vaultLocked ||
            !state.servers.some((item) => item.id === server.id && item.url === server.url && item.enabled && item.status === 'connected')) {
          throw new Error('The GitHub connection changed. Start a new review.');
        }
        return state;
      };
      const checkTool = (name: string, args: Record<string, unknown>) => {
        const state = checkSession();
        const agent = state.agents.find((item) => item.id === agentId);
        if (!agent || !buildAgentToolCatalog(agent, state.servers).tools.some((tool) => tool.serverId === server.id && tool.originalName === name)) {
          throw new Error(`The active agent cannot use ${name}.`);
        }
        const qualifiedKey = `${server.id}:${name}`;
        if (resolveToolPermissionPolicy({ agent, qualifiedKey, toolName: name, args, settingsToolPolicies: state.settings.toolPolicies ?? [] }) === 'deny') {
          throw new Error(`${name} is blocked by the current tool policy.`);
        }
        return qualifiedKey;
      };
      try {
        return await publishCanvasRevision(request, {
          check: checkTool,
          getLogin: async () => {
            checkSession();
            const secrets = await loadServerSecrets(server.id);
            checkSession();
            const { result } = await sendMcpRpc<{ login?: string }>({ server, method: 'github/viewer', secrets, signal });
            return result?.login ?? '';
          },
          approve: (name, args, description) => {
            const qualifiedKey = checkTool(name, args);
            return new Promise((resolve) => {
              const cancel = () => settle('deny');
              const settle = (decision: ApprovalDecision | ApprovalResolution) => {
                signal.removeEventListener('abort', cancel);
                resolve(!signal.aborted && (typeof decision === 'string' ? decision : decision.decision) === 'approve');
              };
              signal.addEventListener('abort', cancel, { once: true });
              set({ pendingApproval: {
                toolCallId: 'canvas-' + name + '-' + Date.now(),
                serverId: server.id,
                serverName: server.name,
                toolName: name,
                qualifiedKey,
                arguments: args,
                description,
                lockedArguments: true,
                resolve: settle,
              } });
            });
          },
          call: async (name, args) => {
            checkTool(name, args);
            const secrets = await loadServerSecrets(server.id);
            checkTool(name, args);
            return callMcpTool({ server, secrets, toolName: name, args, signal });
          },
        });
      } finally {
        if (get().abortController === controller) set({ isRunning: false, abortController: null, pendingApproval: null });
      }
    },

    enableDemoSandbox: async () => {
      const state = get();
      const sandbox = state.servers.find((s) => s.url === 'virtual://mcp-hub-sandbox');
      if (sandbox) {
        await state.connectServer(sandbox.id);
      }
      state.updateSettings({ onboardingCompleted: true });
      state.setActiveModel('demo-sandbox');
    },

    saveStudyNote: (note) => {
      const scope = activeScope();
      const entry: SavedStudyNote = {
        ...note,
        id: `snote_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
      };
      set((s) => {
        const filtered = note.messageId
          ? s.savedStudyNotes.filter((n) => n.messageId !== note.messageId)
          : s.savedStudyNotes;
        const next = [entry, ...filtered].slice(0, 80);
        writeSavedStudyNotes(next, scope);
        return { savedStudyNotes: next };
      });
      scheduleRemoteSync();
    },

    removeSavedStudyNote: (noteId) => {
      const scope = activeScope();
      const user = get().authUser;
      if (user) {
        void deleteRemoteStudyNote(user, noteId);
      }
      set((s) => {
        const next = s.savedStudyNotes.filter((n) => n.id !== noteId);
        writeSavedStudyNotes(next, scope);
        return { savedStudyNotes: next };
      });
      scheduleRemoteSync();
    },

    savePromptMacro: (macro) => {
      const now = Date.now();
      const entry: SavedPrompt = {
        id: macro.id ?? `macro_${now}_${Math.random().toString(36).slice(2, 6)}`,
        title: macro.title.trim() || 'Untitled Macro',
        template: macro.template,
        category: macro.category?.trim() || undefined,
        updatedAt: now,
      };
      set((s) => {
        const exists = s.savedPrompts.some((p) => p.id === entry.id);
        return {
          savedPrompts: exists
            ? s.savedPrompts.map((p) => (p.id === entry.id ? entry : p))
            : [entry, ...s.savedPrompts],
        };
      });
      persist();
      return entry;
    },

    deletePromptMacro: (macroId) => {
      set((s) => ({
        savedPrompts: s.savedPrompts.filter((p) => p.id !== macroId),
      }));
      persist();
    },

    runCompareTurn: async (rawText, modelIds, options) => {
      const text = rawText.trim();
      const uniqueIds = Array.from(new Set(modelIds)).slice(0, 3);
      if (!text || uniqueIds.length === 0) return [];

      const state = get();
      const conv = state.conversations.find((c) => c.id === state.activeConversationId) ?? state.conversations[0];
      const agent = state.agents.find((a) => a.id === conv?.agentId) ?? state.agents[0];
      const attachments = options?.attachments ?? [];
      const history: LlmConversationItem[] = [];
      for (const m of conv?.messages ?? []) {
        if (m.role === 'user') history.push({ role: 'user', text: m.content, attachments: m.attachments });
        else if (m.role === 'assistant' && m.content) history.push({ role: 'assistant', text: m.content });
      }
      history.push({ role: 'user', text, attachments: attachments.length > 0 ? attachments : undefined });

      const controller = new AbortController();
      set({ isRunning: true, abortController: controller });

      try {
        const results = await Promise.all(
          uniqueIds.map(async (targetModelId): Promise<CompareResultItem> => {
            const started = Date.now();
            const targetModel = getModelById(targetModelId, state.dynamicModels);
            const apiKey = getApiKeyForProvider(targetModel.provider, state.providerKeys);
            const item: CompareResultItem = {
              modelId: targetModelId,
              status: 'running',
              content: '',
              reasoning: '',
              citations: [],
              durationMs: 0,
            };
            options?.onModelUpdate?.(targetModelId, { ...item });

            if (targetModel.provider !== 'demo' && !apiKey) {
              const missing: CompareResultItem = {
                ...item,
                status: 'error',
                durationMs: Date.now() - started,
                error: `Missing API key for ${targetModel.label}. Add your key in Settings or pick Demo Sandbox.`,
              };
              options?.onModelUpdate?.(targetModelId, missing);
              return missing;
            }

            try {
              const loopRes = await runAgentLoop({
                agent,
                modelId: targetModelId,
                effort: conv?.effort ?? agent.defaultEffort,
                chatMode: conv?.chatMode ?? 'professional',
                studyInstructions: conv?.studyInstructions ?? '',
                knowledgeSource: conv?.knowledgeSource ?? 'auto',
                a2uiMode: state.settings.a2uiMode,
                keys: state.providerKeys,
                dynamicModels: state.dynamicModels,
                servers: state.servers,
                history,
                maxSteps: state.settings.maxAgentSteps,
                confirmBeforeWrite: true,
                alwaysAllowedTools: [],
                alwaysAllowedRules: [],
                toolPolicies: state.settings.toolPolicies ?? [],
                toolOutputBudgetChars: state.settings.toolOutputBudgetChars ?? 8000,
                signal: controller.signal,
                callbacks: {
                  onTextDelta: (fullText) => {
                    item.content = fullText;
                    item.durationMs = Date.now() - started;
                    options?.onModelUpdate?.(targetModelId, { ...item });
                  },
                  onReasoningDelta: (fullReasoning) => {
                    item.reasoning = fullReasoning;
                    options?.onModelUpdate?.(targetModelId, { ...item });
                  },
                  onToolCallsUpdated: () => {},
                  onCitationsUpdated: (citations) => {
                    item.citations = citations;
                  },
                  onFallbackNotice: () => {},
                  requestApproval: async () => ({
                    decision: 'deny',
                    denyReason: 'Write actions are disabled during side-by-side Compare mode.',
                  }),
                  onAlwaysAllowTool: () => {},
                  getServerSecrets: (srvId) => loadServerSecrets(srvId),
                  saveServerSecrets: async (srvId, updated) => {
                    await saveServerSecrets(srvId, updated);
                  },
                },
              });

              const doneItem: CompareResultItem = {
                modelId: loopRes.usedModelId || targetModelId,
                status: 'done',
                content: loopRes.finalText,
                reasoning: loopRes.finalReasoning,
                citations: loopRes.citations,
                durationMs: loopRes.runTrace.durationMs,
                runTrace: loopRes.runTrace,
              };
              options?.onModelUpdate?.(targetModelId, doneItem);
              return doneItem;
            } catch (err) {
              const failed: CompareResultItem = {
                ...item,
                status: 'error',
                durationMs: Date.now() - started,
                error: safeErrorMessage(err, [
                  state.providerKeys.gemini ?? '',
                  state.providerKeys.groq ?? '',
                  state.providerKeys.openrouter ?? '',
                ]),
              };
              options?.onModelUpdate?.(targetModelId, failed);
              return failed;
            }
          })
        );
        return results;
      } finally {
        set({ isRunning: false, abortController: null });
      }
    },

    acceptComparedReply: async (promptText, item, attachments = []) => {
      const scope = activeScope();
      const state = get();
      let conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) {
        state.startNewConversation();
        conv = get().conversations.find((c) => c.id === get().activeConversationId);
      }
      if (!conv) return;

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: `msg_u_${now}`,
        role: 'user',
        content: promptText.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        chatMode: conv.chatMode,
        knowledgeSource: conv.knowledgeSource,
        createdAt: now,
      };
      const assistantMsg: ChatMessage = {
        id: `msg_a_${now + 1}`,
        role: 'assistant',
        content: item.content,
        reasoning: item.reasoning || undefined,
        citations: item.citations.length > 0 ? item.citations : undefined,
        chatMode: conv.chatMode,
        knowledgeSource: conv.knowledgeSource,
        modelId: item.modelId,
        agentId: conv.agentId,
        effort: conv.effort,
        runTrace: item.runTrace,
        a2uiMaxWidgets: 3,
        createdAt: now + 1,
        isStreaming: false,
      };

      const isFirst = conv.messages.filter((m) => m.role === 'user').length === 0;
      const derivedTitle = isFirst
        ? promptText.trim().slice(0, 42) + (promptText.trim().length > 42 ? '…' : '')
        : conv.title;

      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv!.id) return c;
          updated = {
            ...c,
            title: derivedTitle,
            modelId: item.modelId,
            updatedAt: Date.now(),
            messages: [...c.messages, userMsg, assistantMsg],
          };
          return updated;
        }),
      }));

      if (updated) {
        await historyDb.saveConversation(updated, scope);
        scheduleRemoteSync();
      }
    },

    sendMessage: async (rawText, options) => {
      const attachments = options?.attachments ?? [];
      const text = rawText.trim() || (attachments.length > 0 ? 'Analyze the attached file(s).' : '');
      if (!text || get().isRunning) return;

      const scope = activeScope();
      const state = get();
      let conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) {
        state.startNewConversation();
        conv = get().conversations.find((c) => c.id === get().activeConversationId);
      }
      if (!conv) return;

      const agent = state.agents.find((a) => a.id === conv!.agentId) ?? state.agents[0];
      const model = getModelById(conv.modelId, state.dynamicModels);
      const apiKey = getApiKeyForProvider(model.provider, state.providerKeys);
      const chatMode = options?.retryToolCall ? 'professional' : conv.chatMode ?? 'professional';
      const knowledgeSource = conv.knowledgeSource ?? 'auto';
      const studyInstructions = conv.studyInstructions ?? '';

      const displayLabel = options?.displayText?.trim();
      const userMsg: ChatMessage = {
        id: `msg_u_${Date.now()}`,
        role: 'user',
        content: text,
        displayContent: displayLabel && displayLabel !== text ? displayLabel : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        chatMode,
        knowledgeSource,
        createdAt: Date.now(),
      };

      const assistantMsgId = `msg_a_${Date.now() + 1}`;
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning: '',
        toolCalls: [],
        citations: [],
        chatMode,
        knowledgeSource,
        modelId: conv.modelId,
        agentId: agent.id,
        effort: conv.effort,
        createdAt: Date.now(),
        isStreaming: true,
        canvasEdit: options?.canvasEdit,
      };

      const titleSource = displayLabel || text;
      const isFirstUserMsg = conv.messages.filter((m) => m.role === 'user').length === 0;
      const derivedTitle = isFirstUserMsg
        ? titleSource.length > 42
          ? `${titleSource.slice(0, 42)}…`
          : titleSource
        : conv.title;

      const patchConv = (updater: (c: Conversation) => Conversation) => {
        let latest: Conversation | undefined;
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conv!.id) return c;
            latest = updater(c);
            return latest;
          }),
        }));
        return latest;
      };

      if (!options?.retryToolCall && model.provider !== 'demo' && !apiKey) {
        const errorAssistant: ChatMessage = {
          ...assistantMsg,
          isStreaming: false,
          error: `Missing API key for ${model.label}. Add your free API key in Settings or switch to Local Sandbox Simulator.`,
        };
        const saved = patchConv((c) => ({
          ...c,
          title: derivedTitle,
          updatedAt: Date.now(),
          messages: [...c.messages, userMsg, errorAssistant],
        }));
        if (saved) {
          void historyDb.saveConversation(saved, scope);
          scheduleRemoteSync();
        }
        return;
      }

      const abortController = new AbortController();
      set({ isRunning: true, abortController, liveTrace: undefined });
      let latestTrace: RunTrace | undefined;
      let plan: ProTaskPlan | undefined;
      let approvedSteps: string[] | null = null;
      const finishPlan = (stopped = false) => plan ? finishProTaskPlan(plan, stopped) : undefined;

      patchConv((c) => ({
        ...c,
        title: derivedTitle,
        updatedAt: Date.now(),
        messages: [...c.messages, userMsg, assistantMsg],
      }));

      // Build LLM history including any file/image attachments on turns
      const llmHistory: LlmConversationItem[] = [];
      for (const m of conv.messages) {
        if (m.role === 'user') {
          llmHistory.push({ role: 'user', text: m.content, attachments: m.attachments });
        } else if (m.role === 'assistant' && m.content) {
          llmHistory.push({ role: 'assistant', text: m.content });
        }
      }
      llmHistory.push({
        role: 'user',
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      let pendingText: string | null = null;
      let pendingReasoning: string | null = null;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let thinkingStartMs: number | null = null;
      let thinkingDurationMs: number | undefined;

      const updateAssistantMsg = (patch: Partial<ChatMessage>) => {
        patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, ...patch } : m)),
        }));
      };

      const flushPendingDeltas = () => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (pendingText === null && pendingReasoning === null) return;
        const patch: Partial<ChatMessage> = {};
        if (pendingText !== null) {
          patch.content = pendingText;
          pendingText = null;
        }
        if (pendingReasoning !== null) {
          patch.reasoning = pendingReasoning;
          pendingReasoning = null;
        }
        if (thinkingDurationMs !== undefined) {
          patch.thinkingDurationMs = thinkingDurationMs;
        }
        updateAssistantMsg(patch);
      };

      const scheduleDeltaFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushPendingDeltas();
        }, 32);
      };

      try {
        if (chatMode === 'professional' && !options?.retryToolCall && !options?.requireWriteApproval &&
            !options?.autoApproveWrites && !options?.canvasEdit && shouldPlanProTask(text)) {
          let planText = '';
          try {
            await streamWithRateLimitFallback({
              primaryModelId: conv.modelId,
              keys: state.providerKeys,
              dynamicModels: state.dynamicModels,
              systemPrompt: PRO_PLAN_SYSTEM_PROMPT,
              effort: 'low',
              chatMode,
              a2uiEnabled: false,
              messages: llmHistory.slice(-6),
              tools: [],
              signal: abortController.signal,
              onEvent: (event) => {
                if (event.type === 'text_delta' && planText.length < 5000) planText += event.delta;
              },
            });
          } catch (error) {
            if (abortController.signal.aborted) throw error;
          }
          const draft = parseProTaskPlan(planText);
          plan = makeProTaskPlan(draft.length >= 2 ? draft : splitProTask(text), 'review');
          updateAssistantMsg({ proTaskPlan: plan });
          approvedSteps = await new Promise<string[] | null>((resolve) => {
            if (abortController.signal.aborted) { resolve(null); return; }
            const cancel = () => resolvePlan(null);
            const resolvePlan = (steps: string[] | null) => {
              abortController.signal.removeEventListener('abort', cancel);
              resolve(steps);
            };
            abortController.signal.addEventListener('abort', cancel, { once: true });
            set({ pendingProPlan: { messageId: assistantMsgId, resolve: resolvePlan } });
          });
          if (!approvedSteps || abortController.signal.aborted) {
            plan = { ...plan, status: 'cancelled' };
            const saved = patchConv((conversation) => ({
              ...conversation,
              updatedAt: Date.now(),
              messages: conversation.messages.map((message) => message.id === assistantMsgId
                ? { ...message, content: 'Plan cancelled.', isStreaming: false, proTaskPlan: finishPlan() }
                : message),
            }));
            if (saved) {
              await historyDb.saveConversation(saved, scope);
              scheduleRemoteSync();
            }
            return;
          }
          plan = makeProTaskPlan(approvedSteps, 'running');
          updateAssistantMsg({ proTaskPlan: plan });
        }

        const result = await runAgentLoop({
          agent,
          modelId: conv.modelId,
          effort: conv.effort,
          chatMode,
          studyInstructions,
          knowledgeSource,
          a2uiMode: get().settings.a2uiMode,
          keys: get().providerKeys,
          dynamicModels: get().dynamicModels,
          servers: get().servers,
          history: llmHistory,
          maxSteps: get().settings.maxAgentSteps,
          confirmBeforeWrite: options?.autoApproveWrites ? false : get().settings.confirmBeforeWrite,
          requireWriteApproval: options?.requireWriteApproval,
          retryToolCall: options?.retryToolCall,
          approvedPlan: approvedSteps ?? undefined,
          alwaysAllowedTools: get().settings.alwaysAllowedTools,
          alwaysAllowedRules: get().settings.alwaysAllowedRules ?? [],
          toolPolicies: get().settings.toolPolicies ?? [],
          toolOutputBudgetChars: get().settings.toolOutputBudgetChars ?? 8000,
          signal: abortController.signal,
          callbacks: {
            onTextDelta: (fullText) => {
              if (thinkingStartMs !== null && thinkingDurationMs === undefined) {
                thinkingDurationMs = Math.max(100, Date.now() - thinkingStartMs);
              }
              pendingText = fullText;
              scheduleDeltaFlush();
            },
            onReasoningDelta: (fullReasoning) => {
              if (thinkingStartMs === null) {
                thinkingStartMs = Date.now();
              }
              pendingReasoning = fullReasoning;
              scheduleDeltaFlush();
            },
            onPlanStepChanged: (index, status) => {
              if (!plan) return;
              plan = { ...plan, steps: plan.steps.map((step, i) => i === index ? { ...step, status } : step) };
              updateAssistantMsg({ proTaskPlan: plan });
            },
            onTraceUpdated: (trace) => {
              latestTrace = trace;
              set({ liveTrace: { messageId: assistantMsgId, trace } });
            },
            onToolCallsUpdated: (toolCalls: ToolCallRecord[]) => {
              if (thinkingStartMs !== null && thinkingDurationMs === undefined) {
                thinkingDurationMs = Math.max(100, Date.now() - thinkingStartMs);
              }
              flushPendingDeltas();
              updateAssistantMsg({
                toolCalls,
                ...(thinkingDurationMs !== undefined ? { thinkingDurationMs } : {}),
              });
            },
            onCitationsUpdated: (citations: GroundingCitation[]) => {
              flushPendingDeltas();
              updateAssistantMsg({ citations });
            },
            onFallbackNotice: (fromModel, toModel, reason) => {
              flushPendingDeltas();
              const shortReason = reason.includes('503')
                ? 'high demand (503)'
                : reason.includes('404')
                  ? 'unavailable (404)'
                  : 'rate limit (429)';
              const noticeMsg: ChatMessage = {
                id: `msg_notice_${Date.now()}`,
                role: 'system_notice',
                content: `${fromModel.label} hit ${shortReason}. Automatically switched to ${toModel.label}.`,
                createdAt: Date.now(),
              };
              patchConv((c) => {
                const idx = c.messages.findIndex((m) => m.id === assistantMsgId);
                const copy = [...c.messages];
                if (idx >= 0) copy.splice(idx, 0, noticeMsg);
                else copy.push(noticeMsg);
                return { ...c, modelId: toModel.id, messages: copy };
              });
            },
            requestApproval: (approval) => {
              flushPendingDeltas();
              return new Promise((resolve) => {
                set({
                  pendingApproval: {
                    ...approval,
                    resolve,
                  },
                });
              });
            },
            onAlwaysAllowTool: (qualifiedKey, opts) => {
              const existingTools = get().settings.alwaysAllowedTools;
              const existingRules = pruneExpiredAlwaysAllowRules(
                get().settings.alwaysAllowedRules ?? []
              );
              const nextRule = {
                qualifiedKey,
                expiresAt: durationToExpiresAt(opts?.duration),
                argPattern: opts?.argPattern,
              };
              const filteredRules = existingRules.filter(
                (r) => !(r.qualifiedKey === qualifiedKey && r.argPattern === opts?.argPattern)
              );
              get().updateSettings({
                alwaysAllowedTools: existingTools.includes(qualifiedKey)
                  ? existingTools
                  : [...existingTools, qualifiedKey],
                alwaysAllowedRules: [...filteredRules, nextRule],
              });
            },
            getServerSecrets: (srvId) => loadServerSecrets(srvId),
            saveServerSecrets: async (srvId, updated) => {
              await saveServerSecrets(srvId, updated);
            },
          },
        });

        flushPendingDeltas();
        const finalDuration =
          thinkingDurationMs ??
          (thinkingStartMs !== null ? Math.max(100, Date.now() - thinkingStartMs) : undefined);

        const finalConv = patchConv((c) => ({
          ...c,
          modelId: result.usedModelId,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: result.finalText || (result.stoppedByUser ? '_Generation stopped._' : ''),
                  reasoning: result.finalReasoning,
                  ...(finalDuration !== undefined ? { thinkingDurationMs: finalDuration } : {}),
                  toolCalls: result.toolCalls,
                  citations: result.citations,
                  modelId: result.usedModelId,
                  runTrace: result.runTrace,
                  a2uiMaxWidgets: 3,
                  proTaskPlan: finishPlan(result.stoppedByUser),
                  isStreaming: false,
                }
              : m
          ),
        }));
        if (finalConv) {
          await historyDb.saveConversation(finalConv, scope);
          scheduleRemoteSync();
        }
      } catch (err) {
        flushPendingDeltas();
        const keys = get().providerKeys;
        const msg = safeErrorMessage(err, [keys.gemini ?? '', keys.groq ?? '', keys.openrouter ?? '']);
        const finalConv = patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  content: abortController.signal.aborted ? m.content || '_Generation stopped._' : m.content,
                  error: abortController.signal.aborted ? undefined : msg,
                  runTrace: latestTrace,
                  proTaskPlan: finishPlan(true),
                }
              : m
          ),
        }));
        if (finalConv) {
          await historyDb.saveConversation(finalConv, scope);
          scheduleRemoteSync();
        }
      } finally {
        if (flushTimer !== null) clearTimeout(flushTimer);
        if (get().abortController === abortController) {
          set({ isRunning: false, abortController: null, pendingApproval: null, pendingProPlan: undefined, liveTrace: undefined });
        }
      }
    },
  };
});
