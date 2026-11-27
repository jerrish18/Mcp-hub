import { CONNECTOR_PRESETS } from '../../config/connectors';
import { FREE_MODELS } from '../../config/models';
import type { PublicApiKeyInfo, ControlActivityEntry, BridgeWorkspaceMirror } from '../../server/controlRouter';
import { useHubStore, type HubTabId } from '../../store/useHubStore';
import {
  type AgentProfile,
  AgentProfileSchema,
  type AuthType,
  type EffortLevel,
  type McpServerConfig,
  McpServerConfigSchema,
  type PixelAccentTheme,
} from '../../types';
import { getAppSessionToken, refreshAppSession } from '../auth/appAuth';
import { streamSseData } from '../llm/sse';
import { getAvailableModels } from '../llm/provider';
import { callMcpTool } from '../mcp/client';
import { loadServerSecrets, saveServerSecrets } from '../storage/secureStorage';
import type { ControlKeyScope } from './actionsCatalog';

let runtimeAdminToken = '';
const credentialsChanged = new EventTarget();

export function setControlAdminToken(token: string): void {
  runtimeAdminToken = token.trim();
  credentialsChanged.dispatchEvent(new Event('change'));
}

function uiHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {
    'X-MCPHub-UI': '1',
  };
  if (json) h['Content-Type'] = 'application/json';
  const token = getAppSessionToken() || runtimeAdminToken;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function listAppApiKeys(): Promise<{
  requiresSignIn?: boolean;
  canManage?: boolean;
  adminTokenRequired: boolean;
  bridgeConnectedCount: number;
  keys: PublicApiKeyInfo[];
  activity: ControlActivityEntry[];
}> {
  if (!getAppSessionToken() && !runtimeAdminToken) {
    const probe = await fetch('/api/control/bridge/status', { headers: uiHeaders(false) });
    if (probe.ok) {
      const info = await probe.json() as {
        adminTokenRequired?: boolean; accountKeysAvailable?: boolean; requiresAuthorization?: boolean;
      };
      if (info.requiresAuthorization) {
        return {
          adminTokenRequired: Boolean(info.adminTokenRequired),
          requiresSignIn: Boolean(info.accountKeysAvailable),
          canManage: false,
          bridgeConnectedCount: 0,
          keys: [],
          activity: [],
        };
      }
    }
  }
  const res = await fetchManagement('/api/control/keys');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to load App API keys (${res.status})`);
  }
  return { ...await res.json(), adminTokenRequired: false, canManage: true };
}

async function fetchManagement(url: string, options?: RequestInit) {
  const request = () => fetch(url, { ...options, headers: uiHeaders(Boolean(options?.body)) });
  const res = await request();
  return res.status === 401 && getAppSessionToken() && await refreshAppSession() ? request() : res;
}

export async function createAppApiKey(
  label: string,
  scope: ControlKeyScope
): Promise<{ key: PublicApiKeyInfo; plaintextKey: string }> {
  const res = await fetchManagement('/api/control/keys', {
    method: 'POST',
    body: JSON.stringify({ label, scope }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to generate API key (${res.status})`);
  }
  return res.json();
}

export async function revokeAppApiKey(id: string): Promise<void> {
  const res = await fetchManagement(`/api/control/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to revoke API key (${res.status})`);
  }
}

export function buildSanitizedMirrorState(): BridgeWorkspaceMirror {
  const s = useHubStore.getState();
  return {
    activeTab: s.activeTab,
    isRunning: s.isRunning,
    hasPendingApproval: Boolean(s.pendingApproval),
    servers: s.servers.map((srv) => ({
      id: srv.id,
      name: srv.name,
      url: srv.url,
      authType: srv.authType,
      enabled: srv.enabled,
      status: srv.status,
      presetId: srv.presetId,
      toolsCount: srv.tools.length,
      disabledTools: srv.disabledTools,
      tools: srv.tools.map((t) => ({
        name: t.name,
        description: t.description,
        readOnlyHint: t.annotations?.readOnlyHint,
      })),
    })),
    agents: s.agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      defaultModelId: a.defaultModelId,
      defaultEffort: a.defaultEffort,
      isBuiltIn: a.isBuiltIn,
    })),
    conversations: s.conversations.slice(0, 30).map((c) => ({
      id: c.id,
      title: c.title,
      agentId: c.agentId,
      modelId: c.modelId,
      effort: c.effort,
      messageCount: c.messages.length,
      updatedAt: c.updatedAt,
    })),
    activeConversationId: s.activeConversationId,
    settings: {
      theme: s.settings.theme,
      accentTheme: s.settings.accentTheme,
      oledDark: s.settings.oledDark,
      confirmBeforeWrite: s.settings.confirmBeforeWrite,
      maxAgentSteps: s.settings.maxAgentSteps,
      hapticsEnabled: s.settings.hapticsEnabled,
      biometricLockEnabled: s.settings.biometricLockEnabled,
    },
    modelsCount: getAvailableModels(s.providerKeys, s.dynamicModels, s.settings.manualModelOverrides ?? []).length,
    updatedAt: Date.now(),
  };
}

export async function executeStoreControlAction(
  action: string,
  params: Record<string, unknown>,
  scope: ControlKeyScope
): Promise<unknown> {
  const store = useHubStore.getState();

  switch (action) {
    case 'get_workspace_overview': {
      const mirror = buildSanitizedMirrorState();
      return {
        mode: 'live_browser_hub',
        ...mirror,
        connectedServersCount: store.servers.filter((srv) => srv.status === 'connected').length,
        activeToolsCount: store.servers
          .filter((srv) => srv.enabled && srv.status === 'connected')
          .reduce((acc, srv) => acc + Math.max(0, srv.tools.length - srv.disabledTools.length), 0),
        configuredProviders: {
          gemini: Boolean(store.providerKeys.gemini),
          groq: Boolean(store.providerKeys.groq),
          openrouter: Boolean(store.providerKeys.openrouter),
        },
        pendingApproval: store.pendingApproval
          ? {
              serverId: store.pendingApproval.serverId,
              serverName: store.pendingApproval.serverName,
              toolName: store.pendingApproval.toolName,
              arguments: store.pendingApproval.arguments,
              isDestructive: store.pendingApproval.isDestructive,
            }
          : null,
      };
    }

    case 'navigate_tab': {
      const tab = String(params.tab ?? '') as HubTabId;
      if (!['dashboard', 'chat', 'servers', 'agents', 'settings'].includes(tab)) {
        throw new Error(`Invalid tab "${tab}". Expected dashboard, chat, servers, agents, or settings.`);
      }
      store.setActiveTab(tab);
      return { activeTab: tab };
    }

    case 'list_servers':
      return {
        servers: store.servers.map((srv) => ({
          id: srv.id,
          name: srv.name,
          url: srv.url,
          authType: srv.authType,
          enabled: srv.enabled,
          status: srv.status,
          presetId: srv.presetId,
          disabledTools: srv.disabledTools,
          tools: srv.tools.map((t) => ({
            name: t.name,
            description: t.description,
            readOnlyHint: t.annotations?.readOnlyHint,
            enabled: !srv.disabledTools.includes(t.name),
          })),
        })),
      };

    case 'add_or_update_server': {
      const rawId = typeof params.id === 'string' && params.id.trim() ? params.id.trim() : `srv_${Date.now()}`;
      const existing = store.servers.find((s) => s.id === rawId);
      const authType = (typeof params.authType === 'string' ? params.authType : existing?.authType ?? 'none') as AuthType;
      const candidate: McpServerConfig = McpServerConfigSchema.parse({
        id: rawId,
        name: String(params.name ?? existing?.name ?? ''),
        url: String(params.url ?? existing?.url ?? ''),
        authType,
        enabled: typeof params.enabled === 'boolean' ? params.enabled : (existing?.enabled ?? true),
        transportPreference: existing?.transportPreference ?? 'auto',
        status: existing?.status ?? 'disconnected',
        tools: existing?.tools ?? [],
        resources: existing?.resources ?? [],
        prompts: existing?.prompts ?? [],
        disabledTools: existing?.disabledTools ?? [],
        presetId: existing?.presetId ?? 'custom',
      });
      const bearerToken = typeof params.bearerToken === 'string' ? params.bearerToken.trim() : undefined;
      await store.addOrUpdateServer(candidate, bearerToken ? { bearerToken } : undefined);
      if (params.connectNow) {
        const res = await useHubStore.getState().connectServer(candidate.id);
        return { serverId: candidate.id, connected: res.ok, error: res.error };
      }
      return { serverId: candidate.id, saved: true };
    }

    case 'connect_server': {
      const ref = String(params.serverId ?? '').trim();
      const target =
        store.servers.find((s) => s.id === ref || s.presetId === ref) ??
        (ref === 'srv_virtual_sandbox'
          ? store.servers.find((s) => s.presetId === 'sandbox' || s.id === 'srv_sandbox')
          : undefined) ??
        (ref in CONNECTOR_PRESETS
          ? store.servers.find((s) => s.id === CONNECTOR_PRESETS[ref as keyof typeof CONNECTOR_PRESETS].serverId)
          : undefined);
      if (!target) throw new Error(`Server "${ref}" not found.`);
      const res = await store.connectServer(target.id);
      const updated = useHubStore.getState().servers.find((s) => s.id === target.id);
      return {
        serverId: target.id,
        ok: res.ok,
        status: updated?.status,
        toolsCount: updated?.tools.length ?? 0,
        error: res.error,
      };
    }

    case 'delete_server': {
      const serverId = String(params.serverId ?? '').trim();
      const exists = store.servers.some((s) => s.id === serverId);
      if (!exists) throw new Error(`Server "${serverId}" not found.`);
      await store.deleteServer(serverId);
      return { deleted: serverId };
    }

    case 'toggle_server_tool': {
      const serverId = String(params.serverId ?? '').trim();
      const toolName = String(params.toolName ?? '').trim();
      const srv = store.servers.find((s) => s.id === serverId);
      if (!srv) throw new Error(`Server "${serverId}" not found.`);
      store.toggleServerTool(serverId, toolName);
      const updated = useHubStore.getState().servers.find((s) => s.id === serverId);
      return {
        serverId,
        toolName,
        enabled: updated ? !updated.disabledTools.includes(toolName) : false,
      };
    }

    case 'call_mcp_tool': {
      const ref = String(params.serverId ?? '').trim();
      const toolName = String(params.toolName ?? '').trim();
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const srv =
        store.servers.find((s) => s.id === ref || s.presetId === ref) ??
        (ref === 'srv_virtual_sandbox'
          ? store.servers.find((s) => s.presetId === 'sandbox' || s.id === 'srv_sandbox')
          : undefined);
      if (!srv) throw new Error(`Server "${ref}" not found.`);
      if (!srv.enabled) throw new Error(`Server "${srv.name}" is disabled.`);
      if (srv.disabledTools.includes(toolName)) {
        throw new Error(`Tool "${toolName}" is disabled on "${srv.name}".`);
      }
      const secrets = await loadServerSecrets(srv.id);
      const result = await callMcpTool({
        server: srv,
        secrets,
        saveUpdatedSecrets: (updated) => saveServerSecrets(srv.id, updated),
        toolName,
        args,
      });
      return {
        serverId: srv.id,
        toolName,
        isError: result.isError,
        text: result.text,
      };
    }

    case 'list_agents':
      return { agents: store.agents };

    case 'create_or_update_agent': {
      const now = Date.now();
      const id =
        typeof params.id === 'string' && params.id.trim()
          ? params.id.trim()
          : `agent_${now}_${Math.random().toString(36).slice(2, 6)}`;
      const existing = store.agents.find((a) => a.id === id);
      const agent: AgentProfile = AgentProfileSchema.parse({
        id,
        name: String(params.name ?? existing?.name ?? ''),
        icon: existing?.icon ?? 'bot',
        description: String(params.description ?? existing?.description ?? ''),
        systemPrompt: String(params.systemPrompt ?? existing?.systemPrompt ?? ''),
        defaultModelId: String(
          params.defaultModelId ?? existing?.defaultModelId ?? FREE_MODELS[0].id
        ),
        defaultEffort: (params.defaultEffort ?? existing?.defaultEffort ?? 'medium') as EffortLevel,
        allowedServerIds:
          params.allowedServerIds === undefined
            ? (existing?.allowedServerIds ?? null)
            : (params.allowedServerIds as string[] | null),
        allowedToolNames:
          params.allowedToolNames === undefined
            ? (existing?.allowedToolNames ?? null)
            : (params.allowedToolNames as string[] | null),
        isBuiltIn: existing?.isBuiltIn ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      store.saveAgent(agent);
      return { agent };
    }

    case 'delete_agent': {
      const agentId = String(params.agentId ?? '').trim();
      const target = store.agents.find((a) => a.id === agentId);
      if (!target) throw new Error(`Agent "${agentId}" not found.`);
      if (target.isBuiltIn) throw new Error('Built-in agents cannot be deleted.');
      store.deleteAgent(agentId);
      return { deleted: agentId };
    }

    case 'list_conversations': {
      const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
      return {
        activeConversationId: store.activeConversationId,
        conversations: store.conversations.slice(0, limit).map((c) => ({
          id: c.id,
          title: c.title,
          agentId: c.agentId,
          modelId: c.modelId,
          effort: c.effort,
          messageCount: c.messages.length,
          updatedAt: c.updatedAt,
        })),
      };
    }

    case 'get_conversation': {
      const targetId =
        typeof params.conversationId === 'string' && params.conversationId.trim()
          ? params.conversationId.trim()
          : store.activeConversationId;
      const conv = store.conversations.find((c) => c.id === targetId);
      if (!conv) throw new Error('Conversation not found.');
      return { conversation: conv };
    }

    case 'start_new_conversation': {
      const agentId = typeof params.agentId === 'string' ? params.agentId : undefined;
      const modelId = typeof params.modelId === 'string' ? params.modelId : undefined;
      store.startNewConversation(agentId, modelId);
      store.setActiveTab('chat');
      const active = useHubStore
        .getState()
        .conversations.find((c) => c.id === useHubStore.getState().activeConversationId);
      return { conversation: active };
    }

    case 'send_chat_message': {
      const message = String(params.message ?? '').trim();
      if (!message) throw new Error('message is required.');
      if (store.isRunning) throw new Error('Another agent run is already in progress.');

      if (typeof params.conversationId === 'string' && params.conversationId.trim()) {
        store.selectConversation(params.conversationId.trim());
      } else if (params.agentId || params.modelId) {
        if (typeof params.agentId === 'string') store.setActiveAgent(params.agentId);
        if (typeof params.modelId === 'string') store.setActiveModel(params.modelId);
      }
      if (
        params.effort === 'low' ||
        params.effort === 'medium' ||
        params.effort === 'high'
      ) {
        useHubStore.getState().setActiveEffort(params.effort);
      }

      useHubStore.getState().setActiveTab('chat');
      const autoApproveWrites = scope === 'full' && params.autoApproveWrites === true;
      await useHubStore.getState().sendMessage(message, { autoApproveWrites });

      const updatedState = useHubStore.getState();
      const conv = updatedState.conversations.find((c) => c.id === updatedState.activeConversationId);
      const lastAssistant = [...(conv?.messages ?? [])]
        .reverse()
        .find((m) => m.role === 'assistant');

      return {
        conversationId: conv?.id,
        modelId: lastAssistant?.modelId ?? conv?.modelId,
        text: lastAssistant?.content ?? '',
        error: lastAssistant?.error,
        toolCalls: lastAssistant?.toolCalls ?? [],
      };
    }

    case 'stop_active_run': {
      store.stopRun();
      return { stopped: true };
    }

    case 'resolve_pending_approval': {
      const decision = String(params.decision ?? '');
      if (decision !== 'approve' && decision !== 'always_allow' && decision !== 'deny') {
        throw new Error('decision must be approve, always_allow, or deny.');
      }
      if (!store.pendingApproval) {
        throw new Error('No pending write approval banner in chat.');
      }
      store.resolvePendingApproval(decision);
      return { resolved: decision };
    }

    case 'list_models':
      return { models: getAvailableModels(store.providerKeys, store.dynamicModels, store.settings.manualModelOverrides ?? []) };

    case 'update_app_settings': {
      const patch: Record<string, unknown> = {};
      if (params.theme === 'system' || params.theme === 'light' || params.theme === 'dark') {
        patch.theme = params.theme;
      }
      if (
        params.accentTheme === 'pixel_blue' ||
        params.accentTheme === 'sage' ||
        params.accentTheme === 'clay' ||
        params.accentTheme === 'lavender' ||
        params.accentTheme === 'monochrome'
      ) {
        patch.accentTheme = params.accentTheme as PixelAccentTheme;
      }
      if (typeof params.oledDark === 'boolean') patch.oledDark = params.oledDark;
      if (typeof params.confirmBeforeWrite === 'boolean') {
        patch.confirmBeforeWrite = params.confirmBeforeWrite;
      }
      if (typeof params.maxAgentSteps === 'number') {
        patch.maxAgentSteps = Math.max(1, Math.min(25, params.maxAgentSteps));
      }
      if (typeof params.hapticsEnabled === 'boolean') patch.hapticsEnabled = params.hapticsEnabled;
      if (typeof params.biometricLockEnabled === 'boolean') {
        patch.biometricLockEnabled = params.biometricLockEnabled;
      }
      store.updateSettings(patch);
      return { settings: useHubStore.getState().settings };
    }

    default:
      throw new Error(`Unsupported control action "${action}".`);
  }
}

export function startBrowserControlBridge(): () => void {
  if (typeof window === 'undefined') return () => {};

  let connection: AbortController | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let sync: ReturnType<typeof setTimeout> | undefined;
  let connected = false;

  const connect = async () => {
    connection?.abort();
    clearTimeout(reconnect);
    connected = false;
    const controller = new AbortController();
    connection = controller;
    const { signal } = controller;
    const account = useHubStore.getState().authUser;

    const stillConnected = () => !signal.aborted && useHubStore.getState().authUser === account;
    const post = (path: string, body: unknown) => fetch(path, {
      method: 'POST', headers: uiHeaders(), body: JSON.stringify(body), signal,
    });

    try {
      const res = await fetch('/api/control/bridge/stream', { headers: uiHeaders(false), signal });
      if (res.status === 401 && getAppSessionToken() && await refreshAppSession() && stillConnected()) {
        reconnect = setTimeout(connect, 0);
        return;
      }
      if (!res.ok || !res.body || !stillConnected()) return;
      for await (const raw of streamSseData(res.body)) {
        if (!stillConnected()) break;
        const event = JSON.parse(raw) as {
          clientId?: string; requestId?: string; action?: string; params?: Record<string, unknown>; scope?: ControlKeyScope;
        };
        if (event.clientId) {
          connected = true;
          if (!getAppSessionToken()) void post('/api/control/bridge/state', buildSanitizedMirrorState()).catch(() => {});
          continue;
        }
        if (!event.requestId || !event.action) continue;
        const { requestId, action } = event;
        void (async () => {
          let response: Record<string, unknown>;
          try {
            const result = await executeStoreControlAction(action, event.params ?? {}, event.scope ?? 'full');
            response = { requestId, ok: true, result };
          } catch (error) {
            response = { requestId, ok: false, error: error instanceof Error ? error.message : 'Action failed' };
          }
          if (stillConnected()) await post('/api/control/bridge/result', response);
        })().catch(() => {});
      }
      if (stillConnected()) reconnect = setTimeout(connect, 3000);
    } catch {
      if (stillConnected()) reconnect = setTimeout(connect, 3000);
    } finally {
      if (connection === controller) connected = false;
    }
  };

  credentialsChanged.addEventListener('change', connect);
  void connect();
  const unsubscribe = useHubStore.subscribe(() => {
    if (!connected || getAppSessionToken()) return;
    clearTimeout(sync);
    sync = setTimeout(() => {
      if (connected && !getAppSessionToken()) void fetch('/api/control/bridge/state', {
        method: 'POST', headers: uiHeaders(), body: JSON.stringify(buildSanitizedMirrorState()),
        signal: connection?.signal,
      }).catch(() => {});
    }, 350);
  });
  return () => {
    credentialsChanged.removeEventListener('change', connect);
    connection?.abort();
    unsubscribe();
    clearTimeout(reconnect);
    clearTimeout(sync);
  };
}
