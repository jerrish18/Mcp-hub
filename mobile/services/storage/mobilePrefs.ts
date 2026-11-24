import { BUILT_IN_AGENTS, DEFAULT_SERVERS, DEFAULT_SETTINGS } from '@core/store/defaults';
import type { AgentProfile, AppSettings, McpServerConfig } from '@core/types';
import { sqliteHistoryDb } from './sqliteHistory';

const PREFS_KEY = 'mobile_prefs_v1';

export interface MobilePrefs {
  settings: AppSettings;
  servers: McpServerConfig[];
  agents: AgentProfile[];
  selectedAgentId: string;
  activeConversationId: string | null;
}

type PrefsListener = (prefs: MobilePrefs) => void;
const listeners = new Set<PrefsListener>();

export function subscribeMobilePrefs(listener: PrefsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitPrefs(prefs: MobilePrefs): void {
  for (const listener of listeners) {
    listener(prefs);
  }
}

export async function loadMobilePrefs(): Promise<MobilePrefs> {
  const saved = await sqliteHistoryDb.getKv<Partial<MobilePrefs>>(PREFS_KEY);
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...(saved?.settings ?? {}),
  };

  const savedServers = Array.isArray(saved?.servers) ? saved.servers : [];
  const savedIds = new Set(savedServers.map((s) => s.id));
  const mergedServers = [
    ...savedServers,
    ...DEFAULT_SERVERS.filter((def) => !savedIds.has(def.id)),
  ];

  const savedAgents = Array.isArray(saved?.agents) ? saved.agents : [];
  const savedAgentIds = new Set(savedAgents.map((a) => a.id));
  const mergedAgents = [
    ...savedAgents,
    ...BUILT_IN_AGENTS.filter((b) => !savedAgentIds.has(b.id)),
  ];

  const selectedAgentId =
    saved?.selectedAgentId && mergedAgents.some((a) => a.id === saved.selectedAgentId)
      ? saved.selectedAgentId
      : mergedAgents[0].id;

  return {
    settings,
    servers: mergedServers,
    agents: mergedAgents,
    selectedAgentId,
    activeConversationId: saved?.activeConversationId ?? null,
  };
}

export async function saveMobilePrefs(patch: Partial<MobilePrefs>): Promise<MobilePrefs> {
  const current = await loadMobilePrefs();
  const next: MobilePrefs = {
    settings: patch.settings ? { ...current.settings, ...patch.settings } : current.settings,
    servers: patch.servers ?? current.servers,
    agents: patch.agents ?? current.agents,
    selectedAgentId: patch.selectedAgentId ?? current.selectedAgentId,
    activeConversationId:
      patch.activeConversationId !== undefined
        ? patch.activeConversationId
        : current.activeConversationId,
  };
  await sqliteHistoryDb.setKv(PREFS_KEY, next);
  emitPrefs(next);
  return next;
}
