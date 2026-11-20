import { create } from 'zustand';
import { DEFAULT_MODEL_ID, getModelById } from '../config/models';
import {
  buildAgentToolCatalog,
  runAgentLoop,
} from '../services/llm/agentLoop';
import { getApiKeyForProvider } from '../services/llm/provider';
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
  ChatMessage,
  Conversation,
  EffortLevel,
  McpServerConfig,
  PendingApproval,
  ProviderKeys,
  ServerSecretPayload,
  ToolCallRecord,
} from '../types';
import { safeErrorMessage } from '../utils/redact';
import { BUILT_IN_AGENTS, DEFAULT_SANDBOX_SERVER, DEFAULT_SETTINGS } from './defaults';

const STATE_KEY = 'mcphub_app_state_v1';

interface PersistedMeta {
  servers: McpServerConfig[];
  agents: AgentProfile[];
  settings: AppSettings;
}

function readPersistedMeta(): PersistedMeta {
  try {
    const raw = globalThis.localStorage?.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedMeta>;
      return {
        servers: parsed.servers && parsed.servers.length > 0 ? parsed.servers : [DEFAULT_SANDBOX_SERVER],
        agents: parsed.agents && parsed.agents.length > 0 ? parsed.agents : BUILT_IN_AGENTS,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    servers: [DEFAULT_SANDBOX_SERVER],
    agents: BUILT_IN_AGENTS,
    settings: DEFAULT_SETTINGS,
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
  return {
    id: `conv_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Chat',
    agentId: agent.id,
    modelId: modelIdOverride ?? agent.defaultModelId ?? DEFAULT_MODEL_ID,
    effort: agent.defaultEffort,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface HubState {
  initialized: boolean;
  isLocked: boolean;
  servers: McpServerConfig[];
  agents: AgentProfile[];
  settings: AppSettings;
  providerKeys: ProviderKeys;
  conversations: Conversation[];
  activeConversationId: string | null;
  isRunning: boolean;
  abortController: AbortController | null;
  pendingApproval: PendingApproval | null;

  initializeApp: (autostartSkipOnboarding?: boolean) => Promise<void>;
  unlockApp: () => void;
  lockApp: () => void;

  // Settings & Keys
  updateSettings: (patch: Partial<AppSettings>) => void;
  setProviderKeys: (keys: ProviderKeys) => Promise<void>;
  revokeAlwaysAllowedTool: (qualifiedKey: string) => void;

  // Servers
  addOrUpdateServer: (server: McpServerConfig, secrets?: ServerSecretPayload) => Promise<void>;
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
  sendMessage: (text: string) => Promise<void>;
  stopRun: () => void;
  resolvePendingApproval: (decision: 'approve' | 'always_allow' | 'deny') => void;
  enableDemoSandbox: () => Promise<void>;
}

const initialMeta = readPersistedMeta();

export const useHubStore = create<HubState>((set, get) => {
  const persist = () => {
    const s = get();
    writePersistedMeta({
      servers: s.servers,
      agents: s.agents,
      settings: s.settings,
    });
  };

  return {
    initialized: false,
    isLocked: initialMeta.settings.biometricLockEnabled,
    servers: initialMeta.servers,
    agents: initialMeta.agents,
    settings: initialMeta.settings,
    providerKeys: {},
    conversations: [],
    activeConversationId: null,
    isRunning: false,
    abortController: null,
    pendingApproval: null,

    initializeApp: async (autostartSkipOnboarding = false) => {
      const [keys, convs] = await Promise.all([
        loadProviderKeys(),
        historyDb.listConversations(),
      ]);

      const state = get();
      const nextSettings = autostartSkipOnboarding
        ? { ...state.settings, onboardingCompleted: true }
        : state.settings;

      // Auto-connect virtual sandbox so tools are immediately inspectable
      const updatedServers = [...state.servers];
      const sandboxIdx = updatedServers.findIndex((srv) => srv.url.startsWith('virtual://'));
      if (sandboxIdx !== -1 && updatedServers[sandboxIdx].tools.length === 0) {
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

    deleteServer: async (serverId) => {
      await deleteServerSecrets(serverId);
      set((s) => ({
        servers: s.servers.filter((srv) => srv.id !== serverId),
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
          updated = { ...c, agentId: agent.id, updatedAt: Date.now() };
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
      const sandbox = state.servers.find((s) => s.url.startsWith('virtual://'));
      if (sandbox) {
        await state.connectServer(sandbox.id);
      }
      state.updateSettings({ onboardingCompleted: true });
      state.setActiveModel('demo-sandbox');
    },

    sendMessage: async (rawText) => {
      const text = rawText.trim();
      if (!text || get().isRunning) return;

      const state = get();
      let conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) {
        state.startNewConversation();
        conv = get().conversations.find((c) => c.id === get().activeConversationId);
      }
      if (!conv) return;

      const agent = state.agents.find((a) => a.id === conv!.agentId) ?? state.agents[0];
      const model = getModelById(conv.modelId);
      const apiKey = getApiKeyForProvider(model.provider, state.providerKeys);

      const userMsg: ChatMessage = {
        id: `msg_u_${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };

      const assistantMsgId = `msg_a_${Date.now() + 1}`;
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning: '',
        toolCalls: [],
        modelId: conv.modelId,
        agentId: agent.id,
        effort: conv.effort,
        createdAt: Date.now(),
        isStreaming: true,
      };

      const isFirstUserMsg = conv.messages.filter((m) => m.role === 'user').length === 0;
      const derivedTitle = isFirstUserMsg
        ? text.length > 42
          ? `${text.slice(0, 42)}…`
          : text
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

      // Check missing API key cleanly before entering loop
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

      // Build LLM history from prior messages
      const llmHistory: LlmConversationItem[] = [];
      for (const m of conv.messages) {
        if (m.role === 'user') {
          llmHistory.push({ role: 'user', text: m.content });
        } else if (m.role === 'assistant' && m.content) {
          llmHistory.push({ role: 'assistant', text: m.content });
        }
      }
      llmHistory.push({ role: 'user', text });

      const updateAssistantMsg = (patch: Partial<ChatMessage>) => {
        patchConv((c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) => (m.id === assistantMsgId ? { ...m, ...patch } : m)),
        }));
      };

      try {
        // Ensure enabled virtual or disconnected servers attempt tool catalog readiness
        const { tools } = buildAgentToolCatalog(agent, get().servers);
        void tools;

        const result = await runAgentLoop({
          agent,
          modelId: conv.modelId,
          effort: conv.effort,
          keys: get().providerKeys,
          servers: get().servers,
          history: llmHistory,
          maxSteps: get().settings.maxAgentSteps,
          confirmBeforeWrite: get().settings.confirmBeforeWrite,
          alwaysAllowedTools: get().settings.alwaysAllowedTools,
          signal: abortController.signal,
          callbacks: {
            onTextDelta: (fullText) => updateAssistantMsg({ content: fullText }),
            onReasoningDelta: (fullReasoning) => updateAssistantMsg({ reasoning: fullReasoning }),
            onToolCallsUpdated: (toolCalls: ToolCallRecord[]) => updateAssistantMsg({ toolCalls }),
            onFallbackNotice: (fromModel, toModel) => {
              const noticeMsg: ChatMessage = {
                id: `msg_notice_${Date.now()}`,
                role: 'system_notice',
                content: `Rate limit (429) on ${fromModel.label}. Automatically switched to ${toModel.label}.`,
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
            requestApproval: (approval) =>
              new Promise((resolve) => {
                set({
                  pendingApproval: {
                    ...approval,
                    resolve,
                  },
                });
              }),
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
                  toolCalls: result.toolCalls,
                  modelId: result.usedModelId,
                  isStreaming: false,
                }
              : m
          ),
        }));
        if (finalConv) await historyDb.saveConversation(finalConv);
      } catch (err) {
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
        set({ isRunning: false, abortController: null, pendingApproval: null });
      }
    },
  };
});
