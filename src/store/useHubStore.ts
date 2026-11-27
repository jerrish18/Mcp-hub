import { create } from 'zustand';
import { DEFAULT_MODEL_ID, getModelById, normalizeModelId } from '../config/models';
import { logoutCurrentAccount, type AuthUser } from '../services/auth/appAuth';
import {
  buildAgentToolCatalog,
  durationToExpiresAt,
  pruneExpiredAlwaysAllowRules,
  runAgentLoop,
} from '../services/llm/agentLoop';
import {
  createInitialCodingSession,
  runCodingExecutionPhase,
  runCodingPlanPhase,
} from '../services/llm/codingOrchestrator';
import { WorkspaceVfs } from '../services/llm/toolHarness';
import {
  classifyProviderFailure,
  dispatchStreamCompletion,
  getApiKeyForProvider,
  getAvailableModels,
  hasConfiguredCloudKey,
  isModelManuallyOverridden,
  syncLiveProviderModels,
  preserveCatalogForSameCredentials,
  retainTransientCatalogRoutes,
  validateAllConfiguredProviderKeys,
} from '../services/llm/provider';
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
  A2uiWidgetState,
  AgentProfile,
  AppSettings,
  ApprovalDecision,
  ApprovalResolution,
  ChatAttachment,
  ChatMessage,
  ChatMode,
  CloudProvider,
  CodeOrchestrationMode,
  CodeOrchestrationSettings,
  CodingPlan,
  CodingPlanRequirement,
  CodingRole,
  CodingSessionState,
  Conversation,
  EffortLevel,
  GroundingCitation,
  KnowledgeSourceMode,
  McpServerConfig,
  MessageVerification,
  ModelConfig,
  PendingApproval,
  ProjectProfile,
  ProviderId,
  ProviderKeys,
  ProviderKeyStatus,
  ProviderValidationResult,
  RunTrace,
  SavedPrompt,
  ServerSecretPayload,
  ToolCallRecord,
  ToolPolicyRule,
} from '../types';
import { listWorkspaceProjects, migrateLegacyWorkspaceProjects } from '../utils/projects';
import { resolveA2uiMode } from '../utils/a2ui';
import type { SavedStudyNote } from '../utils/studyTools';
import { safeErrorMessage } from '../utils/redact';
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
  projects?: ProjectProfile[];
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
  };
}

function migrateScopedConversations(conversations: Conversation[], scope: string, projects: ProjectProfile[]): Conversation[] {
  const valid = new Set(projects.filter(project => project.updatedAt === 0).map(project => project.id));
  const legacy = listWorkspaceProjects(scope).filter(project => valid.has(project.id));
  return conversations.map(conversation => {
    const migrated = migrateConversation(conversation);
    if (migrated.projectId !== undefined) return migrated;
    const project = legacy.find(item => Array.isArray(item.conversationIds) && item.conversationIds.includes(migrated.id));
    return project ? { ...migrated, projectId: project.id } : migrated;
  });
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
      const mergedSettings: AppSettings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) };
      const migratedA2uiMode = resolveA2uiMode(parsed.settings);
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
          a2uiMode: migratedA2uiMode,
          a2uiEnabled: migratedA2uiMode !== 'off',
          alwaysAllowedRules: prunedRules,
          alwaysAllowedTools: mergedSettings.alwaysAllowedTools.filter((k) => !expiredKeys.has(k)),
          codeOrchestration: {
            mode: mergedSettings.codeOrchestration?.mode === 'single' ? 'single' : 'custom',
            roles: {
              architect: mergedSettings.codeOrchestration?.roles?.architect ?? null,
              coder: mergedSettings.codeOrchestration?.roles?.coder ?? null,
              reviewer: mergedSettings.codeOrchestration?.roles?.reviewer ?? null,
            },
            autoRun: Boolean(mergedSettings.codeOrchestration?.autoRun),
          },
        },
        dynamicModels: parsed.dynamicModels ?? [],
        dismissedDefaultServerIds: dismissed,
        savedPrompts:
          parsed.savedPrompts && parsed.savedPrompts.length > 0
            ? parsed.savedPrompts
            : DEFAULT_SAVED_PROMPTS,
        projects: Array.isArray(parsed.projects) ? parsed.projects : migrateLegacyWorkspaceProjects(scope),
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
    projects: migrateLegacyWorkspaceProjects(scope),
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
  projects: ProjectProfile[];
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
  flushPendingSync: () => Promise<void>;

  // Settings & Keys & Models
  updateSettings: (patch: Partial<AppSettings>) => void;
  setProviderKeys: (keys: ProviderKeys) => Promise<void>;
  providerValidation: Partial<Record<CloudProvider, ProviderValidationResult>>;
  validatingKeys: boolean;
  modelFailures: Record<string, { status: ProviderKeyStatus; badge: string; detail: string }>;
  pendingFreeModels: string[];
  validateProviderKeysNow: () => Promise<Partial<Record<CloudProvider, ProviderValidationResult>>>;
  toggleManualModelOverride: (modelId: string) => void;
  recordModelFailure: (modelId: string, err: unknown) => void;
  syncModels: () => Promise<{ count: number; providers: string[]; transient: boolean }>;
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
  updateMessageA2uiState: (messageId: string, patch: Partial<A2uiWidgetState>) => void;
  sendMessage: (
    text: string,
    options?: { autoApproveWrites?: boolean; attachments?: ChatAttachment[]; displayText?: string }
  ) => Promise<void>;
  stopRun: () => void;
  resolvePendingApproval: (decision: ApprovalDecision | ApprovalResolution) => void;
  retryToolCall: (params: {
    serverId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<{ ok: boolean; result?: string; error?: string; denied?: boolean; durationMs: number }>;
  enableDemoSandbox: () => Promise<void>;
  saveStudyNote: (note: Omit<SavedStudyNote, 'id' | 'createdAt'>) => void;
  removeSavedStudyNote: (noteId: string) => void;
  savePromptMacro: (macro: Omit<SavedPrompt, 'id' | 'updatedAt'> & { id?: string }) => SavedPrompt;
  deletePromptMacro: (macroId: string) => void;
  saveProject: (project: Omit<ProjectProfile, 'id' | 'updatedAt'> & { id?: string }) => ProjectProfile;
  deleteProject: (projectId: string) => void;
  setConversationProject: (projectId: string | null) => void;
  verifyAssistantMessage: (messageId: string, verifierModelId?: string) => Promise<void>;
  editAndRerunUserMessage: (messageId: string, newText: string) => Promise<void>;
  regenerateAssistantMessage: (assistantMsgId: string, modelIdOverride?: string) => Promise<void>;
  forkConversationFromMessage: (messageId: string) => Promise<Conversation | null>;
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

  // Code Mode Orchestration & Workspace VFS
  approveCodingPlan: (messageId: string) => Promise<void>;
  updateCodingPlanRequirements: (
    messageId: string,
    requirements: CodingPlanRequirement[],
    extraInstruction?: string
  ) => Promise<void>;
  toggleCodeAutoRun: () => void;
  setCodeOrchestrationMode: (mode: CodeOrchestrationMode) => void;
  setCodeRoleAssignment: (role: CodingRole, modelId: string | null) => void;
  acceptWorkspaceDiff: (path: string) => Promise<void>;
  rejectWorkspaceDiff: (path: string) => Promise<void>;
  revertWorkspaceCheckpoint: (checkpointId: string) => Promise<void>;
}

const initialMeta = readPersistedMeta('guest');

export const useHubStore = create<HubState>((set, get) => {
  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncRun = 0;
  let catalogRefresh: { keys: ProviderKeys; scope: string; promise: ReturnType<HubState['syncModels']> } | undefined;
  let listChangedSubscribed = false;
  let visibilitySyncBound = false;

  const activeScope = () => getAccountScope(get().authUser);

  const buildSnapshotFromState = (state: HubState, updatedAt = Date.now()): WorkspaceSnapshot => ({
    settings: state.settings,
    agents: state.agents,
    servers: state.servers,
    dynamicModels: state.dynamicModels,
    dismissedDefaultServerIds: state.dismissedDefaultServerIds,
    savedPrompts: state.savedPrompts,
    projects: state.projects,
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
    }, 3500);
  };

  const flushPendingSyncNow = async () => {
    if (syncDebounceTimer !== null) {
      clearTimeout(syncDebounceTimer);
      syncDebounceTimer = null;
      await pushCurrentStateToRemote();
    }
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
        projects: s.projects,
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
    const localConvs = migrateScopedConversations(localConvsRaw, scope, localMeta.projects ?? []);

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
      projects: localMeta.projects ?? [],
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
          projects: localMeta.projects ?? [],
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
        const hasAnyRealKey = Boolean(
          keys.gemini || keys.groq || keys.openrouter || keys.nvidia || keys.modelscope || keys.amd ||
          hasConfiguredCloudKey('cloudflare', keys)
        );
        const firstModel = hasAnyRealKey || defaultAgent.defaultChatMode === 'coding' ? 'cloud-auto' : 'demo-sandbox';
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
          projects: finalSnapshot.projects ?? [],
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
        projects: finalSnapshot.projects ?? [],
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
        const hasAnyRealKey = Boolean(
          keys.gemini || keys.groq || keys.openrouter || keys.nvidia || keys.modelscope || keys.amd ||
          hasConfiguredCloudKey('cloudflare', keys)
        );
        const firstModel = hasAnyRealKey || defaultAgent.defaultChatMode === 'coding' ? 'cloud-auto' : 'demo-sandbox';
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

    let guestConvs = migrateScopedConversations(guestConvsRaw, 'guest', guestMeta.projects ?? []);
    const updatedServers = await ensureSandboxConnected(guestMeta.servers);
    if (runId !== activeSyncRun) return;

    if (guestConvs.length === 0) {
      const keys = get().providerKeys;
      const defaultAgent = guestMeta.agents[0] ?? BUILT_IN_AGENTS[0];
      const hasAnyRealKey = Boolean(
        keys.gemini || keys.groq || keys.openrouter || keys.nvidia || keys.modelscope || keys.amd ||
        hasConfiguredCloudKey('cloudflare', keys)
      );
      const firstModel = hasAnyRealKey || defaultAgent.defaultChatMode === 'coding' ? 'cloud-auto' : 'demo-sandbox';
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
      projects: guestMeta.projects ?? [],
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
    providerValidation: {},
    validatingKeys: false,
    modelFailures: {},
    pendingFreeModels: [],
    dynamicModels: initialMeta.dynamicModels,
    dismissedDefaultServerIds: initialMeta.dismissedDefaultServerIds,
    savedPrompts: initialMeta.savedPrompts ?? DEFAULT_SAVED_PROMPTS,
    projects: initialMeta.projects ?? [],
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

    flushPendingSync: async () => {
      await flushPendingSyncNow();
    },

    initializeApp: async (autostartSkipOnboarding = false) => {
      const scope = getAccountScope(get().authUser);
      const [keys, rawConvs] = await Promise.all([
        loadProviderKeys(),
        historyDb.listConversations(scope),
      ]);

      const state = get();
      const convs = migrateScopedConversations(rawConvs, scope, state.projects);
      const nextSettings = autostartSkipOnboarding
        ? { ...state.settings, onboardingCompleted: true }
        : state.settings;

      const updatedServers = await ensureSandboxConnected(state.servers);

      let activeConvId = convs[0]?.id ?? null;
      let nextConvs = convs;
      if (!activeConvId) {
        const defaultAgent = state.agents[0] ?? BUILT_IN_AGENTS[0];
        const hasAnyRealKey = Boolean(
          keys.gemini || keys.groq || keys.openrouter || keys.nvidia || keys.modelscope || keys.amd ||
          hasConfiguredCloudKey('cloudflare', keys)
        );
        const firstModel = hasAnyRealKey || defaultAgent.defaultChatMode === 'coding' ? 'cloud-auto' : 'demo-sandbox';
        const fresh = createNewConversation(defaultAgent, firstModel);
        nextConvs = [fresh];
        activeConvId = fresh.id;
        await historyDb.saveConversation(fresh, scope);
      }

      const vaultLocked = isPassphraseVaultEnabled() && !isVaultUnlocked();
      set({
        initialized: true,
        passphraseVaultEnabled: isPassphraseVaultEnabled(),
        vaultLocked,
        providerKeys: keys,
        conversations: nextConvs,
        activeConversationId: activeConvId,
        servers: updatedServers,
        settings: nextSettings,
        authGuestMode: autostartSkipOnboarding ? true : state.authGuestMode,
      });
      persist();
      if (!vaultLocked) {
        void Promise.all([get().validateProviderKeysNow(), get().syncModels()]);
      }

      if (!visibilitySyncBound && typeof window !== 'undefined') {
        visibilitySyncBound = true;
        window.addEventListener('pagehide', () => {
          void flushPendingSyncNow();
        });
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
              void flushPendingSyncNow();
            }
          });
        }
      }

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
      void Promise.all([get().validateProviderKeysNow(), get().syncModels()]);
      return true;
    },
    enableVaultPassphrase: async (passphrase) => {
      await enablePassphraseVault(passphrase);
      set({
        passphraseVaultEnabled: true,
        vaultLocked: false,
      });
      void Promise.all([get().validateProviderKeysNow(), get().syncModels()]);
    },
    disableVaultPassphrase: async () => {
      await disablePassphraseVault();
      set({
        passphraseVaultEnabled: false,
        vaultLocked: false,
      });
      void Promise.all([get().validateProviderKeysNow(), get().syncModels()]);
    },
    lockVaultSession: () => {
      lockVault();
      set({
        vaultLocked: isPassphraseVaultEnabled() && !isVaultUnlocked(),
        providerKeys: {},
        providerValidation: {},
        modelFailures: {},
      });
    },

    updateSettings: (patch) => {
      set((s) => {
        const merged = { ...s.settings, ...patch };
        if (patch.a2uiMode) {
          merged.a2uiEnabled = patch.a2uiMode !== 'off';
        } else if (patch.a2uiEnabled !== undefined) {
          merged.a2uiMode = patch.a2uiEnabled ? 'smart' : 'off';
        }
        return { settings: merged };
      });
      persist();
    },

    setProviderKeys: async (keys) => {
      await saveProviderKeys(keys);
      set((state) => ({
        providerKeys: keys,
        pendingFreeModels: [],
        modelFailures: {},
        dynamicModels: preserveCatalogForSameCredentials(state.dynamicModels, state.providerKeys, keys),
      }));
      void Promise.all([get().validateProviderKeysNow(), get().syncModels()]);
    },

    validateProviderKeysNow: async () => {
      const state = get();
      if (state.vaultLocked) return {};
      const keys = state.providerKeys;
      const scope = activeScope();
      set({ validatingKeys: true });
      try {
        const { validation, discoveredModels } = await validateAllConfiguredProviderKeys(keys);
        if (get().providerKeys === keys && activeScope() === scope && !get().vaultLocked) {
          set((s) => {
            const existingIds = new Set(s.dynamicModels.map((m) => normalizeModelId(m.id)));
            const freshDiscovered = discoveredModels.filter(
              (m) => !existingIds.has(normalizeModelId(m.id))
            );
            const mergedDynamic = freshDiscovered.length
              ? [...s.dynamicModels, ...freshDiscovered]
              : s.dynamicModels;
            const validProviders = new Set(
              Object.entries(validation)
                .filter(([, v]) => v?.status === 'valid')
                .map(([p]) => p)
            );
            let nextFailures = s.modelFailures;
            if (validProviders.size > 0 && Object.keys(s.modelFailures).length > 0) {
              nextFailures = { ...s.modelFailures };
              for (const failKey of Object.keys(nextFailures)) {
                const matched = getModelById(failKey, mergedDynamic);
                if (matched && validProviders.has(matched.provider)) {
                  delete nextFailures[failKey];
                }
              }
            }
            return {
              providerValidation: validation,
              dynamicModels: mergedDynamic,
              modelFailures: nextFailures,
            };
          });
          persist();
        }
        return validation;
      } finally {
        set({ validatingKeys: false });
      }
    },

    toggleManualModelOverride: (modelId) => {
      const normalized = normalizeModelId(modelId);
      set((s) => {
        const current = s.settings.manualModelOverrides ?? [];
        const exists = current.some((id) => id === modelId || normalizeModelId(id) === normalized);
        const next = exists
          ? current.filter((id) => id !== modelId && normalizeModelId(id) !== normalized)
          : [...current, normalized];
        const nextFailures = { ...s.modelFailures };
        delete nextFailures[modelId];
        delete nextFailures[normalized];
        return {
          settings: { ...s.settings, manualModelOverrides: next },
          modelFailures: nextFailures,
        };
      });
      persist();
    },

    recordModelFailure: (modelId, err) => {
      const classified = classifyProviderFailure(err);
      const normalized = normalizeModelId(modelId);
      set((s) => ({
        modelFailures: {
          ...s.modelFailures,
          [normalized]: {
            status: classified.status,
            badge: classified.badge,
            detail: classified.detail,
          },
        },
      }));
    },

    syncModels: () => {
      const { providerKeys: keys, vaultLocked } = get();
      if (vaultLocked) {
        return Promise.resolve({ count: 0, providers: [], transient: false });
      }
      const scope = activeScope();
      if (catalogRefresh && catalogRefresh.keys === keys && catalogRefresh.scope === scope) return catalogRefresh.promise;
      const promise = syncLiveProviderModels(keys).then(({ models, pending, syncedProviders, transientProviders }) => {
        if (get().providerKeys === keys && activeScope() === scope && !get().vaultLocked) {
          const previous = get().dynamicModels;
          const verified = retainTransientCatalogRoutes(models, previous, transientProviders, keys);
          const verifiedIds = new Set(verified.map((fresh) => normalizeModelId(fresh.id)));
          const preservedUnrouted = previous
            .filter((model) => {
              if (verifiedIds.has(normalizeModelId(model.id))) return false;
              if (model.description === 'Custom user model' || !model.routes?.length) return true;
              return (
                model.provider !== 'local' &&
                model.provider !== 'demo' &&
                model.provider !== 'kilo' &&
                hasConfiguredCloudKey(model.provider, keys)
              );
            })
            .map((model) => (model.routes?.length ? { ...model, routes: undefined } : model));
          set({ dynamicModels: [...verified, ...preservedUnrouted], pendingFreeModels: pending });
          persist();
        }
        return { count: models.length, providers: syncedProviders, transient: transientProviders.length > 0 };
      }).finally(() => {
        if (catalogRefresh?.promise === promise) catalogRefresh = undefined;
      });
      catalogRefresh = { keys, scope, promise };
      return promise;
    },

    addCustomModel: (provider, modelId, label) => {
      const raw = modelId.trim();
      if (!raw) return;
      const trimmed = provider === 'local' && !raw.startsWith('local:') ? `local:${raw}` : raw;
      const custom: ModelConfig = {
        id: trimmed,
        provider,
        label: label?.trim() || `${trimmed} (Custom)`,
        description: 'Custom user model',
        contextWindow: 128_000,
        supportsThinkingLevel: provider === 'gemini',
        supportsReasoningEffort: provider !== 'gemini' && provider !== 'local',
        isFreeTier: provider === 'local',
      };
      set((s) => ({
        dynamicModels: s.dynamicModels.some((m) => m.id === trimmed && m.routes?.length)
          ? s.dynamicModels
          : [custom, ...s.dynamicModels.filter((m) => m.id !== trimmed)],
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
      const available = getAvailableModels(
        state.providerKeys,
        state.dynamicModels,
        state.settings.manualModelOverrides ?? []
      );
      const preferred = available.find((model) => model.id === normalizeModelId(agent.defaultModelId));
      const chosenModel = modelId ?? (agent.defaultChatMode === 'coding' ? 'cloud-auto'
        : preferred?.id ?? (hasAnyRealKey || available.some((model) => model.routes?.length) ? 'cloud-auto' : 'demo-sandbox'));
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
            modelId: agent.defaultChatMode === 'coding' && c.chatMode !== 'coding' ? 'cloud-auto' : c.modelId,
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
          updated = {
            ...c,
            chatMode,
            modelId: chatMode === 'coding' && c.chatMode !== 'coding' ? 'cloud-auto' : c.modelId,
            ...(chatMode === 'coding' && !c.codingSession
              ? { codingSession: createInitialCodingSession() }
              : {}),
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

    updateMessageA2uiState: (messageId, patch) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          updated = {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) => {
              if (m.id !== messageId) return m;
              const prev = m.a2uiWidgetState ?? {};
              return {
                ...m,
                a2uiWidgetState: {
                  ...prev,
                  ...patch,
                  checklist: patch.checklist
                    ? { ...(prev.checklist ?? {}), ...patch.checklist }
                    : prev.checklist,
                  formValues: patch.formValues
                    ? { ...(prev.formValues ?? {}), ...patch.formValues }
                    : prev.formValues,
                  usedActions: patch.usedActions
                    ? Array.from(new Set([...(prev.usedActions ?? []), ...patch.usedActions]))
                    : prev.usedActions,
                },
              };
            }),
          };
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
      if (state.pendingApproval) {
        state.pendingApproval.resolve('deny');
      }
      set({ isRunning: false, abortController: null, pendingApproval: null });
    },

    resolvePendingApproval: (decision) => {
      const pending = get().pendingApproval;
      if (!pending) return;
      pending.resolve(decision);
      set({ pendingApproval: null });
    },

    retryToolCall: async ({ serverId, toolName, args }) => {
      const startedAt = Date.now();
      const state = get();
      const server = state.servers.find((s) => s.id === serverId);
      if (!server || server.status !== 'connected') {
        return {
          ok: false,
          error: server ? `Server "${server.name}" is disconnected.` : 'Target MCP server not found.',
          durationMs: 0,
        };
      }
      const toolDef = server.tools.find((t) => t.name === toolName);
      const isReadOnly = toolDef?.annotations?.readOnlyHint === true;
      const isDestructive = toolDef?.annotations?.destructiveHint === true;
      let effectiveArgs = args;

      if (!isReadOnly && state.settings.confirmBeforeWrite) {
        const rawDecision = await new Promise<ApprovalDecision | ApprovalResolution>((resolve) => {
          set({
            pendingApproval: {
              toolCallId: `retry_${Date.now()}`,
              serverId: server.id,
              serverName: server.name,
              toolName,
              qualifiedKey: `${server.id}:${toolName}`,
              arguments: args,
              description: toolDef?.description ?? `Retry trace tool call: ${toolName}`,
              isDestructive,
              resolve,
            },
          });
        });
        const resolution: ApprovalResolution =
          typeof rawDecision === 'string' ? { decision: rawDecision } : rawDecision;
        if (resolution.decision === 'deny') {
          return {
            ok: false,
            denied: true,
            error: resolution.denyReason?.trim() || 'Write action denied by user.',
            durationMs: Date.now() - startedAt,
          };
        }
        if (resolution.editedArguments) {
          effectiveArgs = resolution.editedArguments;
        }
      }

      try {
        const secrets = await loadServerSecrets(server.id);
        const res = await callMcpTool({
          server,
          secrets,
          saveUpdatedSecrets: (updated) => saveServerSecrets(server.id, updated),
          toolName,
          args: effectiveArgs,
        });
        return {
          ok: !res.isError,
          result: res.text,
          error: res.isError ? res.text : undefined,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        return {
          ok: false,
          error: safeErrorMessage(err),
          durationMs: Date.now() - startedAt,
        };
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

    saveProject: (project) => {
      const now = Date.now();
      const entry: ProjectProfile = {
        id: project.id ?? `proj_${now}_${Math.random().toString(36).slice(2, 6)}`,
        name: project.name.trim() || 'Untitled Project',
        description: project.description.trim(),
        instructions: project.instructions,
        pinnedFiles: project.pinnedFiles ?? [],
        defaultAgentId: project.defaultAgentId,
        allowedServerIds: project.allowedServerIds ?? null,
        updatedAt: now,
      };
      set((s) => {
        const exists = s.projects.some((p) => p.id === entry.id);
        return {
          projects: exists
            ? s.projects.map((p) => (p.id === entry.id ? entry : p))
            : [entry, ...s.projects],
        };
      });
      persist();
      return entry;
    },

    deleteProject: (projectId) => {
      const scope = activeScope();
      const touchedConvs: Conversation[] = [];
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== projectId),
        conversations: s.conversations.map((c) => {
          if (c.projectId !== projectId) return c;
          const next = { ...c, projectId: null, updatedAt: Date.now() };
          touchedConvs.push(next);
          return next;
        }),
      }));
      for (const c of touchedConvs) {
        void historyDb.saveConversation(c, scope);
      }
      persist();
    },

    setConversationProject: (projectId) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      const proj = projectId ? get().projects.find((p) => p.id === projectId) : null;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          const shouldApplyAgent =
            proj?.defaultAgentId &&
            c.messages.filter((m) => m.role === 'user').length === 0 &&
            s.agents.some((a) => a.id === proj.defaultAgentId);
          updated = {
            ...c,
            projectId: projectId ?? null,
            ...(shouldApplyAgent ? { agentId: proj!.defaultAgentId! } : {}),
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

    verifyAssistantMessage: async (messageId, verifierModelId) => {
      const state = get();
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === messageId && m.role === 'assistant');
      if (idx === -1) return;
      const targetMsg = conv.messages[idx];
      if (!targetMsg.content.trim()) return;

      let precedingUser = '';
      for (let i = idx - 1; i >= 0; i--) {
        if (conv.messages[i].role === 'user') {
          precedingUser = conv.messages[i].content;
          break;
        }
      }

      const answerModel = getModelById(targetMsg.modelId || conv.modelId, state.dynamicModels);
      const available = getAvailableModels(
        state.providerKeys,
        state.dynamicModels,
        state.settings.manualModelOverrides ?? []
      ).filter(model => answerModel.provider === 'local' ? model.provider === 'local' : model.provider !== 'local');
      const chosenModel =
        (verifierModelId && available.find((m) => m.id === verifierModelId)) ||
        available.find((m) => m.id !== targetMsg.modelId && m.provider !== 'demo') ||
        available.find((m) => m.id === (targetMsg.modelId || conv.modelId)) ||
        getModelById(targetMsg.modelId || conv.modelId, state.dynamicModels);

      const apiKey = getApiKeyForProvider(chosenModel.provider, state.providerKeys);
      let rawReview = '';
      try {
        await dispatchStreamCompletion({
          model: chosenModel,
          apiKey,
          credentials: state.providerKeys,
          manualOverride: isModelManuallyOverridden(chosenModel.id, state.settings.manualModelOverrides ?? []),
          allowLocalTools: Boolean(state.settings.localModelToolsEnabled),
          systemPrompt:
            'You are an independent technical reviewer verifying another assistant response. Respond ONLY with:\nLine 1: one word VERIFIED, CAUTION, or ISSUES\nLines 2-4: concise bullet points checking factual accuracy, code/tool safety, and completeness (<= 90 words total).',
          effort: 'low',
          messages: [
            {
              role: 'user',
              text: `User question:\n${precedingUser || '(context unavailable)'}\n\nAssistant answer to verify:\n${targetMsg.content.slice(0, 8000)}`,
            },
          ],
          tools: [],
          onEvent: (ev) => {
            if (ev.type === 'text_delta') rawReview += ev.delta;
          },
        });
      } catch (err) {
        rawReview = `CAUTION\n- Verification request failed: ${safeErrorMessage(err)}`;
      }

      const trimmed = rawReview.trim();
      const firstLine = (trimmed.split(/\r?\n/)[0] ?? '').toUpperCase();
      const verdict: MessageVerification['verdict'] = firstLine.includes('ISSUES')
        ? 'issues'
        : firstLine.includes('CAUTION')
          ? 'caution'
          : 'verified';
      const summaryLines = trimmed
        .split(/\r?\n/)
        .slice(1)
        .join('\n')
        .trim();
      const verification: MessageVerification = {
        modelId: chosenModel.id,
        verdict,
        summary: summaryLines || trimmed || 'Reviewed with no issues flagged.',
        checkedAt: Date.now(),
      };

      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          updated = {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.map((m) => (m.id === messageId ? { ...m, verification } : m)),
          };
          return updated;
        }),
      }));
      if (updated) {
        await historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    editAndRerunUserMessage: async (messageId, newText) => {
      if (get().isRunning) return;
      const trimmed = newText.trim();
      if (!trimmed) return;
      const state = get();
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === messageId && m.role === 'user');
      if (idx === -1) return;
      const origMsg = conv.messages[idx];

      let truncated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          truncated = {
            ...c,
            updatedAt: Date.now(),
            messages: c.messages.slice(0, idx),
          };
          return truncated;
        }),
      }));
      if (truncated) {
        await historyDb.saveConversation(truncated, activeScope());
      }
      await get().sendMessage(trimmed, { attachments: origMsg.attachments });
    },

    regenerateAssistantMessage: async (assistantMsgId, modelIdOverride) => {
      if (get().isRunning) return;
      const state = get();
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === assistantMsgId && m.role === 'assistant');
      if (idx === -1) return;

      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (conv.messages[i].role === 'user') {
          userIdx = i;
          break;
        }
      }
      if (userIdx === -1) return;
      const userMsg = conv.messages[userIdx];

      let truncated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          truncated = {
            ...c,
            ...(modelIdOverride ? { modelId: modelIdOverride } : {}),
            updatedAt: Date.now(),
            messages: c.messages.slice(0, userIdx),
          };
          return truncated;
        }),
      }));
      if (truncated) {
        await historyDb.saveConversation(truncated, activeScope());
      }
      await get().sendMessage(userMsg.content, {
        attachments: userMsg.attachments,
        displayText: userMsg.displayContent,
      });
    },

    forkConversationFromMessage: async (messageId) => {
      const state = get();
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) return null;
      const idx = conv.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return null;

      const now = Date.now();
      const clonedMessages = conv.messages.slice(0, idx + 1).map((m) => ({
        ...m,
        isStreaming: false,
      }));
      const forked: Conversation = {
        ...conv,
        id: `conv_${now}_${Math.random().toString(36).slice(2, 7)}`,
        title: conv.title.endsWith('(Fork)') ? conv.title : `${conv.title} (Fork)`,
        messages: clonedMessages,
        createdAt: now,
        updatedAt: now,
      };
      set((s) => ({
        conversations: [forked, ...s.conversations],
        activeConversationId: forked.id,
      }));
      await historyDb.saveConversation(forked, activeScope());
      scheduleRemoteSync();
      return forked;
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
            const item: CompareResultItem = {
              modelId: targetModelId,
              status: 'running',
              content: '',
              reasoning: '',
              citations: [],
              durationMs: 0,
            };
            options?.onModelUpdate?.(targetModelId, { ...item });


            try {
              const activeProject = conv?.projectId
                ? get().projects.find((p) => p.id === conv.projectId) ?? null
                : null;
              const loopRes = await runAgentLoop({
                agent,
                modelId: targetModelId,
                effort: conv?.effort ?? agent.defaultEffort,
                chatMode: conv?.chatMode ?? 'professional',
                studyInstructions: conv?.studyInstructions ?? '',
                knowledgeSource: conv?.knowledgeSource ?? 'auto',
                a2uiEnabled: resolveA2uiMode(state.settings) !== 'off',
                a2uiMode: resolveA2uiMode(state.settings),
                project: activeProject,
                keys: state.providerKeys,
                dynamicModels: state.dynamicModels,
                manualModelOverrides: state.settings.manualModelOverrides ?? [],
                allowLocalTools: Boolean(state.settings.localModelToolsEnabled),
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
                error: safeErrorMessage(
                  err,
                  Object.values(state.providerKeys).filter((k): k is string => Boolean(k))
                ),
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
      const chatMode = conv.chatMode ?? 'professional';
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

      const abortController = new AbortController();
      set({ isRunning: true, abortController });

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
        const activeProject = conv.projectId
          ? get().projects.find((p) => p.id === conv.projectId) ?? null
          : null;

        if (chatMode === 'professional') {
          const { tools } = buildAgentToolCatalog(
            agent,
            get().servers,
            activeProject?.allowedServerIds ?? null
          );
          void tools;
        }

        if (chatMode === 'coding') {
          const initialSession: CodingSessionState =
            conv.codingSession ?? createInitialCodingSession();
          const orchestration: CodeOrchestrationSettings = get().settings.codeOrchestration ?? {
            mode: 'custom',
            roles: { architect: null, coder: null, reviewer: null },
            autoRun: false,
          };

          const updateCodingState = (plan: CodingPlan, nextSession?: CodingSessionState) => {
            patchConv((c) => ({
              ...c,
              updatedAt: Date.now(),
              codingSession: nextSession ?? c.codingSession ?? initialSession,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, codingPlan: plan } : m
              ),
            }));
          };

          const codingCallbacks = {
            onPlanUpdated: (plan: CodingPlan) => {
              updateCodingState(plan);
            },
            onSessionUpdated: (nextSession: CodingSessionState) => {
              patchConv((c) => ({
                ...c,
                updatedAt: Date.now(),
                codingSession: nextSession,
              }));
            },
            onTextDelta: (fullText: string) => {
              pendingText = fullText;
              scheduleDeltaFlush();
            },
            onReasoningDelta: (fullReasoning: string) => {
              if (thinkingStartMs === null) {
                thinkingStartMs = Date.now();
              }
              pendingReasoning = fullReasoning;
              scheduleDeltaFlush();
            },
            onToolCallsUpdated: (toolCalls: ToolCallRecord[]) => {
              flushPendingDeltas();
              updateAssistantMsg({ toolCalls });
            },
            onCitationsUpdated: (citations: GroundingCitation[]) => {
              flushPendingDeltas();
              updateAssistantMsg({ citations });
            },
            onTraceUpdated: (liveTrace: RunTrace) => {
              updateAssistantMsg({ runTrace: liveTrace });
            },
            onFallbackNotice: (fromModel: ModelConfig, toModel: ModelConfig, reason: string) => {
              flushPendingDeltas();
              const shortReason = reason.includes('503')
                ? 'high demand (503)'
                : reason.includes('429')
                  ? 'a rate limit (429)'
                  : 'a provider error';
              const noticeMsg: ChatMessage = {
                id: `msg_notice_${Date.now()}`,
                role: 'system_notice',
                content: `${fromModel.label} via ${fromModel.provider} hit ${shortReason}. Switched to ${toModel.label} via ${toModel.provider}.`,
                createdAt: Date.now(),
              };
              patchConv((c) => {
                const idx = c.messages.findIndex((m) => m.id === assistantMsgId);
                const copy = [...c.messages];
                if (idx >= 0) copy.splice(idx, 0, noticeMsg);
                else copy.push(noticeMsg);
                return { ...c, messages: copy };
              });
            },
            requestApproval: (approval: Omit<PendingApproval, 'resolve'>) => {
              flushPendingDeltas();
              return new Promise<ApprovalDecision | ApprovalResolution>((resolve) => {
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
            getServerSecrets: (srvId: string) => loadServerSecrets(srvId),
            saveServerSecrets: async (srvId: string, updated: ServerSecretPayload) => {
              await saveServerSecrets(srvId, updated);
            },
          };

          const planResult = await runCodingPlanPhase({
            prompt: text,
            attachments,
            session: initialSession,
            orchestration,
            activeModelId: conv.modelId,
            effort: conv.effort,
            agent,
            project: activeProject,
            keys: get().providerKeys,
            dynamicModels: get().dynamicModels,
            manualModelOverrides: get().settings.manualModelOverrides ?? [],
            providerValidation: get().providerValidation,
            modelFailures: get().modelFailures,
            allowLocalTools: Boolean(get().settings.localModelToolsEnabled),
            servers: get().servers,
            confirmBeforeWrite: options?.autoApproveWrites
              ? false
              : get().settings.confirmBeforeWrite,
            alwaysAllowedTools: get().settings.alwaysAllowedTools,
            alwaysAllowedRules: get().settings.alwaysAllowedRules ?? [],
            toolPolicies: get().settings.toolPolicies ?? [],
            toolOutputBudgetChars: get().settings.toolOutputBudgetChars ?? 8000,
            signal: abortController.signal,
            callbacks: codingCallbacks,
          });

          flushPendingDeltas();

          if (!planResult.plan.autoRun || abortController.signal.aborted) {
            const pausedConv = patchConv((c) => ({
              ...c,
              updatedAt: Date.now(),
              codingSession: planResult.session,
              messages: c.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: planResult.summaryText,
                      codingPlan: planResult.plan,
                      isStreaming: false,
                    }
                  : m
              ),
            }));
            if (pausedConv) {
              await historyDb.saveConversation(pausedConv, scope);
              scheduleRemoteSync();
            }
            return;
          }

          const execResult = await runCodingExecutionPhase({
            plan: planResult.plan,
            session: planResult.session,
            orchestration,
            activeModelId: conv.modelId,
            effort: conv.effort,
            agent,
            project: activeProject,
            keys: get().providerKeys,
            dynamicModels: get().dynamicModels,
            manualModelOverrides: get().settings.manualModelOverrides ?? [],
            providerValidation: get().providerValidation,
            modelFailures: get().modelFailures,
            allowLocalTools: Boolean(get().settings.localModelToolsEnabled),
            servers: get().servers,
            confirmBeforeWrite: options?.autoApproveWrites
              ? false
              : get().settings.confirmBeforeWrite,
            alwaysAllowedTools: get().settings.alwaysAllowedTools,
            alwaysAllowedRules: get().settings.alwaysAllowedRules ?? [],
            toolPolicies: get().settings.toolPolicies ?? [],
            toolOutputBudgetChars: get().settings.toolOutputBudgetChars ?? 8000,
            signal: abortController.signal,
            callbacks: codingCallbacks,
          });

          flushPendingDeltas();
          const finalDuration =
            thinkingDurationMs ??
            (thinkingStartMs !== null ? Math.max(100, Date.now() - thinkingStartMs) : undefined);

          const doneConv = patchConv((c) => ({
            ...c,
            updatedAt: Date.now(),
            codingSession: execResult.session,
            messages: c.messages.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: execResult.finalText,
                    codingPlan: execResult.plan,
                    ...(finalDuration !== undefined ? { thinkingDurationMs: finalDuration } : {}),
                    isStreaming: false,
                  }
                : m
            ),
          }));
          if (doneConv) {
            await historyDb.saveConversation(doneConv, scope);
            scheduleRemoteSync();
          }
          return;
        }

        const result = await runAgentLoop({
          agent,
          modelId: conv.modelId,
          effort: conv.effort,
          chatMode,
          studyInstructions,
          knowledgeSource,
          a2uiEnabled: resolveA2uiMode(get().settings) !== 'off',
          a2uiMode: resolveA2uiMode(get().settings),
          project: activeProject,
          keys: get().providerKeys,
          dynamicModels: get().dynamicModels,
          manualModelOverrides: get().settings.manualModelOverrides ?? [],
          allowLocalTools: Boolean(get().settings.localModelToolsEnabled),
          servers: get().servers,
          history: llmHistory,
          maxSteps: get().settings.maxAgentSteps,
          confirmBeforeWrite: options?.autoApproveWrites ? false : get().settings.confirmBeforeWrite,
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
            onTraceUpdated: (liveTrace: RunTrace) => {
              updateAssistantMsg({ runTrace: liveTrace });
            },
            onFallbackNotice: (fromModel, toModel, reason) => {
              flushPendingDeltas();
              const shortReason = reason.includes('503')
                ? 'high demand (503)'
                : reason.includes('429')
                  ? 'a rate limit (429)'
                  : 'a provider error';
              const noticeMsg: ChatMessage = {
                id: `msg_notice_${Date.now()}`,
                role: 'system_notice',
                content: `${fromModel.label} via ${fromModel.provider} hit ${shortReason}. Switched to ${toModel.label} via ${toModel.provider}.`,
                createdAt: Date.now(),
              };
              patchConv((c) => {
                const idx = c.messages.findIndex((m) => m.id === assistantMsgId);
                const copy = [...c.messages];
                if (idx >= 0) copy.splice(idx, 0, noticeMsg);
                else copy.push(noticeMsg);
                return { ...c, messages: copy };
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

        const emptyReplyError =
          !result.finalText && !result.stoppedByUser && result.toolCalls.length === 0
            ? result.finalReasoning
              ? 'The model completed reasoning without emitting a final answer. Try lowering effort to Low or retry.'
              : 'The model returned an empty response. Try again or switch models.'
            : undefined;

        const finalConv = patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: result.finalText || (result.stoppedByUser ? '_Generation stopped._' : ''),
                  reasoning: result.finalReasoning,
                  ...(finalDuration !== undefined ? { thinkingDurationMs: finalDuration } : {}),
                  ...(emptyReplyError ? { error: emptyReplyError } : {}),
                  toolCalls: result.toolCalls,
                  citations: result.citations,
                  modelId: result.usedModelId,
                  runTrace: result.runTrace,
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
        get().recordModelFailure(conv.modelId, err);
        const keys = get().providerKeys;
        const msg = safeErrorMessage(err, Object.values(keys).filter((key): key is string => Boolean(key)));
        const finalConv = patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  isStreaming: false,
                  error: msg,
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
        set({ isRunning: false, abortController: null, pendingApproval: null });
      }
    },

    approveCodingPlan: async (messageId) => {
      if (get().isRunning) return;
      const scope = activeScope();
      const state = get();
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) return;
      const targetMsg = conv.messages.find((m) => m.id === messageId && m.codingPlan);
      if (!targetMsg?.codingPlan) return;

      const agent = state.agents.find((a) => a.id === conv.agentId) ?? state.agents[0];
      const activeProject = conv.projectId
        ? state.projects.find((p) => p.id === conv.projectId) ?? null
        : null;
      const orchestration: CodeOrchestrationSettings = state.settings.codeOrchestration ?? {
        mode: 'custom',
        roles: { architect: null, coder: null, reviewer: null },
        autoRun: false,
      };
      const initialSession: CodingSessionState =
        conv.codingSession ?? createInitialCodingSession();

      const abortController = new AbortController();
      set({ isRunning: true, abortController });

      const patchConv = (updater: (c: Conversation) => Conversation) => {
        let latest: Conversation | undefined;
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== conv.id) return c;
            latest = updater(c);
            return latest;
          }),
        }));
        return latest;
      };

      patchConv((c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: c.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                isStreaming: true,
                error: undefined,
                codingPlan: m.codingPlan
                  ? { ...m.codingPlan, phase: 'executing', updatedAt: Date.now() }
                  : m.codingPlan,
              }
            : m
        ),
      }));

      try {
        const execResult = await runCodingExecutionPhase({
          plan: targetMsg.codingPlan,
          session: initialSession,
          orchestration,
          activeModelId: conv.modelId,
          effort: conv.effort,
          agent,
          project: activeProject,
          keys: get().providerKeys,
          dynamicModels: get().dynamicModels,
          manualModelOverrides: get().settings.manualModelOverrides ?? [],
          providerValidation: get().providerValidation,
          modelFailures: get().modelFailures,
          allowLocalTools: Boolean(get().settings.localModelToolsEnabled),
          servers: get().servers,
          confirmBeforeWrite: get().settings.confirmBeforeWrite,
          alwaysAllowedTools: get().settings.alwaysAllowedTools,
          alwaysAllowedRules: get().settings.alwaysAllowedRules ?? [],
          toolPolicies: get().settings.toolPolicies ?? [],
          toolOutputBudgetChars: get().settings.toolOutputBudgetChars ?? 8000,
          signal: abortController.signal,
          callbacks: {
            onPlanUpdated: (plan) => {
              patchConv((c) => ({
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, codingPlan: plan } : m
                ),
              }));
            },
            onSessionUpdated: (nextSession) => {
              patchConv((c) => ({
                ...c,
                updatedAt: Date.now(),
                codingSession: nextSession,
              }));
            },
            onTextDelta: (fullText) => {
              patchConv((c) => ({
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, content: fullText } : m
                ),
              }));
            },
            onReasoningDelta: (fullReasoning) => {
              patchConv((c) => ({
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, reasoning: fullReasoning } : m
                ),
              }));
            },
            onToolCallsUpdated: (toolCalls) => {
              patchConv((c) => ({
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, toolCalls } : m
                ),
              }));
            },
            onFallbackNotice: (fromModel, toModel, reason) => {
              const shortReason = reason.includes('503')
                ? 'high demand (503)'
                : reason.includes('429')
                  ? 'a rate limit (429)'
                  : 'a provider error';
              const noticeMsg: ChatMessage = {
                id: `msg_notice_${Date.now()}`,
                role: 'system_notice',
                content: `${fromModel.label} via ${fromModel.provider} hit ${shortReason}. Switched to ${toModel.label} via ${toModel.provider}.`,
                createdAt: Date.now(),
              };
              patchConv((c) => {
                const idx = c.messages.findIndex((m) => m.id === messageId);
                const copy = [...c.messages];
                if (idx >= 0) copy.splice(idx, 0, noticeMsg);
                else copy.push(noticeMsg);
                return { ...c, messages: copy };
              });
            },
            requestApproval: (approval) =>
              new Promise((resolve) => {
                set({
                  pendingApproval: {
                    ...approval,
                    resolve,
                  },
                });
              }),
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

        const doneConv = patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          codingSession: execResult.session,
          messages: c.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: execResult.finalText,
                  codingPlan: execResult.plan,
                  isStreaming: false,
                }
              : m
          ),
        }));
        if (doneConv) {
          await historyDb.saveConversation(doneConv, scope);
          scheduleRemoteSync();
        }
      } catch (err) {
        const keys = get().providerKeys;
        const errMsg = safeErrorMessage(
          err,
          Object.values(keys).filter((key): key is string => Boolean(key))
        );
        const failConv = patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  isStreaming: false,
                  error: errMsg,
                  codingPlan: m.codingPlan
                    ? { ...m.codingPlan, phase: 'failed', updatedAt: Date.now() }
                    : m.codingPlan,
                }
              : m
          ),
        }));
        if (failConv) {
          await historyDb.saveConversation(failConv, scope);
          scheduleRemoteSync();
        }
      } finally {
        set({ isRunning: false, abortController: null, pendingApproval: null });
      }
    },

    updateCodingPlanRequirements: async (messageId, requirements, extraInstruction) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== convId) return c;
          let updatedPlan: CodingPlan | null = c.codingSession?.activePlan ?? null;
          const nextMessages = c.messages.map((m) => {
            if (m.id !== messageId || !m.codingPlan) return m;
            const trimmedNote = extraInstruction?.trim();
            const nextPrompt = trimmedNote
              ? `${m.codingPlan.prompt}\n\n[User edit]: ${trimmedNote}`
              : m.codingPlan.prompt;
            const nextReqs = trimmedNote
              ? [
                  ...requirements,
                  { id: `req_note_${Date.now()}`, text: trimmedNote, checked: false },
                ]
              : requirements;
            updatedPlan = {
              ...m.codingPlan,
              prompt: nextPrompt,
              requirements: nextReqs,
              updatedAt: Date.now(),
            };
            return { ...m, codingPlan: updatedPlan };
          });
          updated = {
            ...c,
            updatedAt: Date.now(),
            messages: nextMessages,
            codingSession: c.codingSession
              ? { ...c.codingSession, activePlan: updatedPlan }
              : c.codingSession,
          };
          return updated;
        }),
      }));
      if (updated) {
        await historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    toggleCodeAutoRun: () => {
      const curr = get().settings.codeOrchestration ?? {
        mode: 'custom' as const,
        roles: { architect: null, coder: null, reviewer: null },
        autoRun: false,
      };
      get().updateSettings({
        codeOrchestration: {
          ...curr,
          autoRun: !curr.autoRun,
        },
      });
    },

    setCodeOrchestrationMode: (mode) => {
      const curr = get().settings.codeOrchestration ?? {
        mode: 'custom' as const,
        roles: { architect: null, coder: null, reviewer: null },
        autoRun: false,
      };
      get().updateSettings({
        codeOrchestration: {
          ...curr,
          mode,
        },
      });
    },

    setCodeRoleAssignment: (role, modelId) => {
      const curr = get().settings.codeOrchestration ?? {
        mode: 'custom' as const,
        roles: { architect: null, coder: null, reviewer: null },
        autoRun: false,
      };
      get().updateSettings({
        codeOrchestration: {
          ...curr,
          mode: 'custom',
          roles: {
            ...curr.roles,
            [role]: modelId,
          },
        },
      });
    },

    acceptWorkspaceDiff: async (path) => {
      const conv = get().conversations.find((c) => c.id === get().activeConversationId);
      if (!conv?.codingSession) return;
      const vfs = new WorkspaceVfs({
        files: conv.codingSession.files,
        diffs: conv.codingSession.diffs,
        checkpoints: conv.codingSession.checkpoints,
      });
      if (!vfs.acceptDiff(path)) return;
      const nextSession: CodingSessionState = {
        ...conv.codingSession,
        files: vfs.getFilesSnapshot(),
        diffs: vfs.getDiffsSnapshot(),
      };
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          updated = { ...c, codingSession: nextSession, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        await historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    rejectWorkspaceDiff: async (path) => {
      const conv = get().conversations.find((c) => c.id === get().activeConversationId);
      if (!conv?.codingSession) return;
      const vfs = new WorkspaceVfs({
        files: conv.codingSession.files,
        diffs: conv.codingSession.diffs,
        checkpoints: conv.codingSession.checkpoints,
      });
      if (!vfs.rejectDiff(path)) return;
      const nextSession: CodingSessionState = {
        ...conv.codingSession,
        files: vfs.getFilesSnapshot(),
        diffs: vfs.getDiffsSnapshot(),
      };
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          updated = { ...c, codingSession: nextSession, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        await historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },

    revertWorkspaceCheckpoint: async (checkpointId) => {
      const conv = get().conversations.find((c) => c.id === get().activeConversationId);
      if (!conv?.codingSession) return;
      const vfs = new WorkspaceVfs({
        files: conv.codingSession.files,
        diffs: conv.codingSession.diffs,
        checkpoints: conv.codingSession.checkpoints,
      });
      if (!vfs.revertCheckpoint(checkpointId)) return;
      const nextSession: CodingSessionState = {
        ...conv.codingSession,
        files: vfs.getFilesSnapshot(),
        diffs: vfs.getDiffsSnapshot(),
        checkpoints: vfs.getCheckpointsSnapshot(),
      };
      let updated: Conversation | undefined;
      set((s) => ({
        conversations: s.conversations.map((c) => {
          if (c.id !== conv.id) return c;
          updated = { ...c, codingSession: nextSession, updatedAt: Date.now() };
          return updated;
        }),
      }));
      if (updated) {
        await historyDb.saveConversation(updated, activeScope());
        scheduleRemoteSync();
      }
    },
  };
});
