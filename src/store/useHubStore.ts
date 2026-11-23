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

const STATE_KEY = 'mcphub_app_state_v1';
const SAVED_NOTES_KEY = 'mcphub_saved_study_notes_v1';

function readSavedStudyNotes(): SavedStudyNote[] {
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_NOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedStudyNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedStudyNotes(notes: SavedStudyNote[]): void {
  try {
    globalThis.localStorage?.setItem(SAVED_NOTES_KEY, JSON.stringify(notes));
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
}

function mergeDefaultServers(saved: McpServerConfig[], dismissedIds: string[]): McpServerConfig[] {
  const existingIds = new Set(saved.map((s) => s.id));
  const missing = DEFAULT_SERVERS.filter(
    (def) => !existingIds.has(def.id) && !dismissedIds.includes(def.id)
  );
  return [...saved, ...missing];
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

function readPersistedMeta(): PersistedMeta {
  try {
    const raw = globalThis.localStorage?.getItem(STATE_KEY);
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
  };
}

function writePersistedMeta(meta: PersistedMeta): void {
  try {
    globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify(meta));
  } catch {
    // ignore storage errors
  }
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

export interface HubState {
  initialized: boolean;
  isLocked: boolean;
  authUser: AuthUser | null;
  authGuestMode: boolean;
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

  // Auth
  setAuthUser: (user: AuthUser | null) => void;
  continueAsGuest: () => void;
  signOutAccount: () => Promise<void>;

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

const initialMeta = readPersistedMeta();

export const useHubStore = create<HubState>((set, get) => {
  const persist = () => {
    const s = get();
    writePersistedMeta({
      servers: s.servers,
      agents: s.agents,
      settings: s.settings,
      dynamicModels: s.dynamicModels,
      dismissedDefaultServerIds: s.dismissedDefaultServerIds,
    });
  };

  return {
    initialized: false,
    isLocked: initialMeta.settings.biometricLockEnabled,
    authUser: null,
    authGuestMode: false,
    activeTab: 'dashboard',
    servers: initialMeta.servers,
    agents: initialMeta.agents,
    settings: initialMeta.settings,
    providerKeys: {},
    dynamicModels: initialMeta.dynamicModels,
    dismissedDefaultServerIds: initialMeta.dismissedDefaultServerIds,
    conversations: [],
    activeConversationId: null,
    savedStudyNotes: readSavedStudyNotes(),
    isRunning: false,
    abortController: null,
    pendingApproval: null,

    setActiveTab: (tab) => set({ activeTab: tab }),

    setAuthUser: (user) =>
      set((s) => ({
        authUser: user,
        authGuestMode: user ? false : s.authGuestMode,
      })),

    continueAsGuest: () => set({ authGuestMode: true }),

    signOutAccount: async () => {
      await logoutCurrentAccount();
      set({ authUser: null, authGuestMode: false });
    },

    initializeApp: async (autostartSkipOnboarding = false) => {
      const [keys, rawConvs] = await Promise.all([
        loadProviderKeys(),
        historyDb.listConversations(),
      ]);

      const convs = rawConvs.map(migrateConversation);
      const state = get();
      const nextSettings = autostartSkipOnboarding
        ? { ...state.settings, onboardingCompleted: true }
        : state.settings;

      // Auto-connect local sandbox virtual server so tools are immediately inspectable
      const updatedServers = [...state.servers];
      const sandboxIdx = updatedServers.findIndex(
        (srv) => srv.url === 'virtual://mcp-hub-sandbox'
      );
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

      let activeConvId = convs[0]?.id ?? null;
      let nextConvs = convs;
      if (!activeConvId) {
        const defaultAgent = state.agents[0] ?? BUILT_IN_AGENTS[0];
        const hasAnyRealKey = Boolean(keys.gemini || keys.groq || keys.openrouter);
        const firstModel = hasAnyRealKey ? defaultAgent.defaultModelId : 'demo-sandbox';
        const fresh = createNewConversation(defaultAgent, firstModel);
        nextConvs = [fresh];
        activeConvId = fresh.id;
        await historyDb.saveConversation(fresh);
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
      void historyDb.saveConversation(conv);
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
      if (updated) await historyDb.saveConversation(updated);
    },

    deleteConversation: async (conversationId) => {
      await historyDb.deleteConversation(conversationId);
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
      if (updated) void historyDb.saveConversation(updated);
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
      if (updated) void historyDb.saveConversation(updated);
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
      if (updated) void historyDb.saveConversation(updated);
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
      if (updated) void historyDb.saveConversation(updated);
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
      if (updated) void historyDb.saveConversation(updated);
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
      if (updated) void historyDb.saveConversation(updated);
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
      const entry: SavedStudyNote = {
        ...note,
        id: `snote_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        createdAt: Date.now(),
      };
      set((s) => {
        const filtered = note.messageId
          ? s.savedStudyNotes.filter((n) => n.messageId !== note.messageId)
          : s.savedStudyNotes;
        const next = [entry, ...filtered].slice(0, 50);
        writeSavedStudyNotes(next);
        return { savedStudyNotes: next };
      });
    },

    removeSavedStudyNote: (noteId) => {
      set((s) => {
        const next = s.savedStudyNotes.filter((n) => n.id !== noteId);
        writeSavedStudyNotes(next);
        return { savedStudyNotes: next };
      });
    },

    sendMessage: async (rawText, options) => {
      const attachments = options?.attachments ?? [];
      const text = rawText.trim() || (attachments.length > 0 ? 'Analyze the attached file(s).' : '');
      if (!text || get().isRunning) return;

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
        if (saved) void historyDb.saveConversation(saved);
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
        if (finalConv) await historyDb.saveConversation(finalConv);
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
        if (finalConv) await historyDb.saveConversation(finalConv);
      } finally {
        if (flushTimer !== null) clearTimeout(flushTimer);
        set({ isRunning: false, abortController: null, pendingApproval: null });
      }
    },
  };
});
