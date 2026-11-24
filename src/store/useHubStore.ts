import { create } from 'zustand';
import { DEFAULT_MODEL_ID, getModelById, normalizeModelId } from '../config/models';
import { logoutCurrentAccount, type AuthUser } from '../services/auth/appAuth';
import {
  buildAgentToolCatalog,
  runAgentLoop,
} from '../services/llm/agentLoop';
import { getApiKeyForProvider, syncLiveProviderModels } from '../services/llm/provider';
import type { LlmConversationItem } from '../services/llm/types';
import { closeAllMcpConnections, connectAndInspectServer } from '../services/mcp/client';
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
  loadProviderKeys,
  loadServerSecrets,
  saveProviderKeys,
  saveServerSecrets,
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
  ServerSecretPayload,
  ToolCallRecord,
} from '../types';
import type { SavedStudyNote } from '../utils/studyTools';
import { safeErrorMessage } from '../utils/redact';
import {
  BUILT_IN_AGENTS,
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
      return {
        servers: mergedServers,
        agents: migratedAgents,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        dynamicModels: parsed.dynamicModels ?? [],
        dismissedDefaultServerIds: dismissed,
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

export interface HubState {
  initialized: boolean;
  isLocked: boolean;
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
  conversations: Conversation[];
  activeConversationId: string | null;
  savedStudyNotes: SavedStudyNote[];
  isRunning: boolean;
  abortController: AbortController | null;
  pendingApproval: PendingApproval | null;

  initializeApp: (autostartSkipOnboarding?: boolean) => Promise<void>;
  setActiveTab: (tab: HubTabId) => void;
  unlockApp: () => void;
  lockApp: () => void;

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

  // Servers
  addOrUpdateServer: (server: McpServerConfig, secrets?: ServerSecretPayload) => Promise<void>;
  quickConnectServer: (
    serverId: string,
    configPatch: Partial<McpServerConfig>,
    secrets: ServerSecretPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteServer: (serverId: string) => Promise<void>;
  connectServer: (serverId: string) => Promise<{ ok: boolean; error?: string }>;
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
    options?: { autoApproveWrites?: boolean; attachments?: ChatAttachment[]; displayText?: string }
  ) => Promise<void>;
  stopRun: () => void;
  resolvePendingApproval: (decision: ApprovalDecision | ApprovalResolution) => void;
  enableDemoSandbox: () => Promise<void>;
  saveStudyNote: (note: Omit<SavedStudyNote, 'id' | 'createdAt'>) => void;
  removeSavedStudyNote: (noteId: string) => void;
}

const initialMeta = readPersistedMeta('guest');

export const useHubStore = create<HubState>((set, get) => {
  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSyncRun = 0;

  const activeScope = () => getAccountScope(get().authUser);

  const buildSnapshotFromState = (state: HubState, updatedAt = Date.now()): WorkspaceSnapshot => ({
    settings: state.settings,
    agents: state.agents,
    servers: state.servers,
    dynamicModels: state.dynamicModels,
    dismissedDefaultServerIds: state.dismissedDefaultServerIds,
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
    }, 550);
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
    conversations: [],
    activeConversationId: null,
    savedStudyNotes: readSavedStudyNotes('guest'),
    isRunning: false,
    abortController: null,
    pendingApproval: null,

    setActiveTab: (tab) => set({ activeTab: tab }),

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
        providerKeys: keys,
        conversations: nextConvs,
        activeConversationId: activeConvId,
        servers: updatedServers,
        settings: nextSettings,
        authGuestMode: autostartSkipOnboarding ? true : state.authGuestMode,
      });
      persist();
    },

    unlockApp: () => set({ isLocked: false }),
    lockApp: () => set({ isLocked: true }),

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
        },
      }));
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
        const res = await connectAndInspectServer({
          server,
          secrets,
          saveUpdatedSecrets: (updated) => saveServerSecrets(serverId, updated),
        });
        set((s) => ({
          servers: s.servers.map((item) =>
            item.id === serverId
              ? {
                  ...item,
                  status: 'connected',
                  lastConnectedAt: Date.now(),
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

      if (model.provider !== 'demo' && !apiKey) {
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
        if (chatMode === 'professional') {
          const { tools } = buildAgentToolCatalog(agent, get().servers);
          void tools;
        }

        const result = await runAgentLoop({
          agent,
          modelId: conv.modelId,
          effort: conv.effort,
          chatMode,
          studyInstructions,
          knowledgeSource,
          a2uiEnabled: get().settings.a2uiEnabled,
          keys: get().providerKeys,
          dynamicModels: get().dynamicModels,
          servers: get().servers,
          history: llmHistory,
          maxSteps: get().settings.maxAgentSteps,
          confirmBeforeWrite: options?.autoApproveWrites ? false : get().settings.confirmBeforeWrite,
          alwaysAllowedTools: get().settings.alwaysAllowedTools,
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
            onAlwaysAllowTool: (qualifiedKey) => {
              const existing = get().settings.alwaysAllowedTools;
              if (!existing.includes(qualifiedKey)) {
                get().updateSettings({ alwaysAllowedTools: [...existing, qualifiedKey] });
              }
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
  };
});
