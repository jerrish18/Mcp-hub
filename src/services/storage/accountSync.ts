import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { DEFAULT_SETTINGS } from '../../store/defaults';
import type {
  AgentProfile,
  AppSettings,
  ChatAttachment,
  Conversation,
  McpServerConfig,
  ModelConfig,
} from '../../types';
import type { SavedStudyNote } from '../../utils/studyTools';
import { getAppSessionToken, type AuthUser } from '../auth/appAuth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase/client';

export interface WorkspaceSnapshot {
  settings: AppSettings;
  agents: AgentProfile[];
  servers: McpServerConfig[];
  dynamicModels: ModelConfig[];
  dismissedDefaultServerIds: string[];
  conversations: Conversation[];
  savedStudyNotes: SavedStudyNote[];
  updatedAt: number;
}

export function getAccountScope(user: AuthUser | null): string {
  if (!user) return 'guest';
  return `${user.provider}:${user.id}`;
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeDocId(rawId: string, fallbackPrefix = 'item'): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

export function sanitizeSettingsForSync(settings: AppSettings): AppSettings {
  return {
    theme: settings.theme,
    accentTheme: settings.accentTheme,
    oledDark: Boolean(settings.oledDark),
    a2uiEnabled: settings.a2uiEnabled !== false,
    confirmBeforeWrite: Boolean(settings.confirmBeforeWrite),
    maxAgentSteps: Math.max(1, Math.min(25, Number(settings.maxAgentSteps) || 10)),
    alwaysAllowedTools: Array.isArray(settings.alwaysAllowedTools)
      ? settings.alwaysAllowedTools.slice(0, 100)
      : [],
    biometricLockEnabled: Boolean(settings.biometricLockEnabled),
    hapticsEnabled: Boolean(settings.hapticsEnabled),
    onboardingCompleted: Boolean(settings.onboardingCompleted),
  };
}

export function sanitizeServersForSync(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.slice(0, 50).map((srv) =>
    stripUndefined({
      id: srv.id,
      name: srv.name.slice(0, 80),
      url: srv.url,
      authType: srv.authType,
      enabled: srv.enabled,
      transportPreference: srv.transportPreference,
      status: 'disconnected' as const,
      tools: srv.url.startsWith('virtual://') ? [] : (srv.tools ?? []).slice(0, 25),
      resources: [],
      prompts: [],
      disabledTools: (srv.disabledTools ?? []).slice(0, 100),
      presetId: srv.presetId,
      docsUrl: srv.docsUrl,
    })
  );
}

function sanitizeAttachments(attachments?: ChatAttachment[]): ChatAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.slice(0, 6).map((att) =>
    stripUndefined({
      id: att.id,
      name: att.name.slice(0, 120),
      mimeType: att.mimeType.slice(0, 120),
      kind: att.kind,
      size: att.size,
      textContent: att.textContent ? att.textContent.slice(0, 8000) : undefined,
      previewUrl:
        att.previewUrl && att.previewUrl.length <= 2048 ? att.previewUrl : undefined,
    })
  );
}

export function sanitizeConversationForSync(conv: Conversation): Conversation {
  return stripUndefined({
    ...conv,
    id: sanitizeDocId(conv.id, 'conv'),
    title: (conv.title || 'New Chat').trim().slice(0, 200) || 'New Chat',
    agentId: (conv.agentId || 'agent_general').slice(0, 128),
    modelId: (conv.modelId || 'demo-sandbox').slice(0, 160),
    effort: conv.effort ?? 'medium',
    chatMode: conv.chatMode ?? 'professional',
    knowledgeSource: conv.knowledgeSource ?? 'auto',
    studyInstructions: String(conv.studyInstructions ?? '').slice(0, 4000),
    messages: (conv.messages ?? []).slice(-150).map((m) =>
      stripUndefined({
        ...m,
        content: String(m.content ?? '').slice(0, 60000),
        reasoning: m.reasoning ? m.reasoning.slice(0, 12000) : undefined,
        attachments: sanitizeAttachments(m.attachments),
        isStreaming: false,
      })
    ),
  });
}

export function sanitizeStudyNoteForSync(note: SavedStudyNote): SavedStudyNote {
  return stripUndefined({
    id: sanitizeDocId(note.id, 'snote'),
    title: (note.title || 'Study Note').trim().slice(0, 200) || 'Study Note',
    content: String(note.content ?? '').slice(0, 120000) || 'Empty note',
    modelLabel: note.modelLabel ? note.modelLabel.slice(0, 120) : undefined,
    messageId: note.messageId ? note.messageId.slice(0, 128) : undefined,
    createdAt: Number(note.createdAt) || Date.now(),
  });
}

/**
 * Merges local scoped cache with remote account database snapshot using ID union and updatedAt winners.
 */
export function mergeWorkspaceSnapshots(
  local: WorkspaceSnapshot,
  remote: Partial<WorkspaceSnapshot> | null
): WorkspaceSnapshot {
  if (!remote) {
    return local;
  }

  const remoteUpdated = Number(remote.updatedAt) || 0;
  const localUpdated = Number(local.updatedAt) || 0;
  const preferRemote = remoteUpdated >= localUpdated;

  const settings = sanitizeSettingsForSync({
    ...DEFAULT_SETTINGS,
    ...(preferRemote ? local.settings : remote.settings),
    ...(preferRemote ? remote.settings : local.settings),
    onboardingCompleted: Boolean(
      local.settings.onboardingCompleted || remote.settings?.onboardingCompleted
    ),
  });

  // Merge agents by id (newest updatedAt wins)
  const agentMap = new Map<string, AgentProfile>();
  for (const a of local.agents) {
    agentMap.set(a.id, a);
  }
  for (const a of remote.agents ?? []) {
    const existing = agentMap.get(a.id);
    if (!existing || (a.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      agentMap.set(a.id, a);
    }
  }

  // Merge servers by id
  const serverMap = new Map<string, McpServerConfig>();
  const primaryServers = preferRemote ? (remote.servers ?? []) : local.servers;
  const secondaryServers = preferRemote ? local.servers : (remote.servers ?? []);
  for (const srv of secondaryServers) {
    serverMap.set(srv.id, srv);
  }
  for (const srv of primaryServers) {
    serverMap.set(srv.id, srv);
  }

  // Merge dismissed default server IDs
  const dismissedSet = new Set<string>(
    preferRemote
      ? (remote.dismissedDefaultServerIds ?? local.dismissedDefaultServerIds)
      : local.dismissedDefaultServerIds
  );

  // Merge dynamic models by id
  const modelMap = new Map<string, ModelConfig>();
  for (const m of local.dynamicModels) modelMap.set(m.id, m);
  for (const m of remote.dynamicModels ?? []) modelMap.set(m.id, m);

  // Merge conversations by id (newest updatedAt wins)
  const convMap = new Map<string, Conversation>();
  for (const c of local.conversations) {
    convMap.set(c.id, c);
  }
  for (const c of remote.conversations ?? []) {
    const existing = convMap.get(c.id);
    if (!existing || (c.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      convMap.set(c.id, c);
    } else if (c.messages.length > existing.messages.length && c.updatedAt === existing.updatedAt) {
      convMap.set(c.id, c);
    }
  }
  const conversations = Array.from(convMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);

  // Merge saved study notes by id / messageId
  const noteMap = new Map<string, SavedStudyNote>();
  for (const n of local.savedStudyNotes) {
    noteMap.set(n.id, n);
  }
  for (const n of remote.savedStudyNotes ?? []) {
    const existingById = noteMap.get(n.id);
    if (!existingById || n.createdAt >= existingById.createdAt) {
      noteMap.set(n.id, n);
    }
  }
  const savedStudyNotes = Array.from(noteMap.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);

  return {
    settings,
    agents: Array.from(agentMap.values()),
    servers: Array.from(serverMap.values()),
    dynamicModels: Array.from(modelMap.values()),
    dismissedDefaultServerIds: Array.from(dismissedSet),
    conversations,
    savedStudyNotes,
    updatedAt: Math.max(localUpdated, remoteUpdated, Date.now()),
  };
}

export async function fetchRemoteWorkspace(
  user: AuthUser
): Promise<Partial<WorkspaceSnapshot> | null> {
  if (user.provider === 'app') {
    const token = getAppSessionToken();
    if (!token) return null;
    const res = await fetch('/api/workspace', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Workspace load failed (${res.status})`);
    }
    const body = (await res.json()) as { workspace: Partial<WorkspaceSnapshot> | null };
    return body.workspace ?? null;
  }

  // Google account via Firestore
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== user.id || !fbUser.emailVerified) {
    return null;
  }
  const uid = fbUser.uid;
  const statePath = `users/${uid}/workspace/state`;
  let stateSnap;
  try {
    stateSnap = await getDoc(doc(db, 'users', uid, 'workspace', 'state'));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, statePath);
  }

  const convsPath = `users/${uid}/conversations`;
  let convDocs;
  try {
    convDocs = await getDocs(
      query(collection(db, 'users', uid, 'conversations'), where('ownerId', '==', uid))
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, convsPath);
  }

  const notesPath = `users/${uid}/studyNotes`;
  let noteDocs;
  try {
    noteDocs = await getDocs(
      query(collection(db, 'users', uid, 'studyNotes'), where('ownerId', '==', uid))
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, notesPath);
  }

  const stateData = stateSnap?.exists() ? stateSnap.data() : null;
  const conversations: Conversation[] = convDocs.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id ?? d.id),
      title: String(data.title ?? 'New Chat'),
      agentId: String(data.agentId ?? 'agent_general'),
      modelId: String(data.modelId ?? 'demo-sandbox'),
      effort: (data.effort ?? 'medium') as Conversation['effort'],
      chatMode: (data.chatMode ?? 'professional') as Conversation['chatMode'],
      knowledgeSource: (data.knowledgeSource ?? 'auto') as Conversation['knowledgeSource'],
      studyInstructions: String(data.studyInstructions ?? ''),
      messages: Array.isArray(data.messages) ? (data.messages as Conversation['messages']) : [],
      createdAt: Number(data.clientCreatedAt ?? Date.now()),
      updatedAt: Number(data.clientUpdatedAt ?? Date.now()),
    };
  });

  const savedStudyNotes: SavedStudyNote[] = noteDocs.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id ?? d.id),
      title: String(data.title ?? 'Study Note'),
      content: String(data.content ?? ''),
      modelLabel: typeof data.modelLabel === 'string' ? data.modelLabel : undefined,
      messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
      createdAt: Number(data.clientCreatedAt ?? Date.now()),
    };
  });

  if (!stateData && conversations.length === 0 && savedStudyNotes.length === 0) {
    return null;
  }

  const updatedAtMillis =
    stateData?.updatedAt && typeof stateData.updatedAt.toMillis === 'function'
      ? Number(stateData.updatedAt.toMillis())
      : conversations.reduce((max, c) => Math.max(max, c.updatedAt), 0);

  return {
    settings: stateData?.settings as AppSettings | undefined,
    agents: Array.isArray(stateData?.agents) ? (stateData.agents as AgentProfile[]) : undefined,
    servers: Array.isArray(stateData?.servers) ? (stateData.servers as McpServerConfig[]) : undefined,
    dynamicModels: Array.isArray(stateData?.dynamicModels)
      ? (stateData.dynamicModels as ModelConfig[])
      : undefined,
    dismissedDefaultServerIds: Array.isArray(stateData?.dismissedDefaultServerIds)
      ? (stateData.dismissedDefaultServerIds as string[])
      : undefined,
    conversations,
    savedStudyNotes,
    updatedAt: updatedAtMillis,
  };
}

export async function pushRemoteWorkspace(
  user: AuthUser,
  snapshot: WorkspaceSnapshot
): Promise<number> {
  const cleanPayload = {
    settings: sanitizeSettingsForSync(snapshot.settings),
    agents: stripUndefined(snapshot.agents.slice(0, 50)),
    servers: sanitizeServersForSync(snapshot.servers),
    dynamicModels: stripUndefined(snapshot.dynamicModels.slice(0, 100)),
    dismissedDefaultServerIds: snapshot.dismissedDefaultServerIds.slice(0, 50),
    conversations: snapshot.conversations.slice(0, 150).map(sanitizeConversationForSync),
    savedStudyNotes: snapshot.savedStudyNotes.slice(0, 80).map(sanitizeStudyNoteForSync),
  };

  if (user.provider === 'app') {
    const token = getAppSessionToken();
    if (!token) throw new Error('App session expired. Sign in again to sync.');
    const res = await fetch('/api/workspace', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-MCPHub-UI': '1',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(cleanPayload),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? `Workspace save failed (${res.status})`);
    }
    const body = (await res.json()) as { updatedAt?: number };
    return body.updatedAt ?? Date.now();
  }

  // Google account via Firestore
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== user.id || !fbUser.emailVerified) {
    return Date.now();
  }
  const uid = fbUser.uid;
  const stateRef = doc(db, 'users', uid, 'workspace', 'state');
  const statePath = `users/${uid}/workspace/state`;
  try {
    const existingState = await getDoc(stateRef).catch(() => null);
    await setDoc(stateRef, {
      ownerId: uid,
      settings: cleanPayload.settings,
      agents: cleanPayload.agents,
      servers: cleanPayload.servers,
      dynamicModels: cleanPayload.dynamicModels,
      dismissedDefaultServerIds: cleanPayload.dismissedDefaultServerIds,
      createdAt:
        existingState && existingState.exists()
          ? existingState.data().createdAt
          : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, statePath);
  }

  for (const conv of cleanPayload.conversations) {
    const convRef = doc(db, 'users', uid, 'conversations', conv.id);
    const convPath = `users/${uid}/conversations/${conv.id}`;
    try {
      const existingConv = await getDoc(convRef).catch(() => null);
      await setDoc(convRef, {
        ownerId: uid,
        id: conv.id,
        title: conv.title,
        agentId: conv.agentId,
        modelId: conv.modelId,
        effort: conv.effort,
        chatMode: conv.chatMode,
        knowledgeSource: conv.knowledgeSource,
        studyInstructions: conv.studyInstructions,
        messages: conv.messages,
        clientCreatedAt: existingConv?.exists()
          ? existingConv.data().clientCreatedAt
          : conv.createdAt || Date.now(),
        clientUpdatedAt: conv.updatedAt || Date.now(),
        createdAt: existingConv?.exists() ? existingConv.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, convPath);
    }
  }

  for (const note of cleanPayload.savedStudyNotes) {
    const noteRef = doc(db, 'users', uid, 'studyNotes', note.id);
    const notePath = `users/${uid}/studyNotes/${note.id}`;
    try {
      const existingNote = await getDoc(noteRef).catch(() => null);
      const payload: Record<string, unknown> = {
        ownerId: uid,
        id: note.id,
        title: note.title,
        content: note.content,
        clientCreatedAt: existingNote?.exists()
          ? existingNote.data().clientCreatedAt
          : note.createdAt || Date.now(),
        createdAt: existingNote?.exists() ? existingNote.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (note.modelLabel) payload.modelLabel = note.modelLabel;
      if (note.messageId) payload.messageId = note.messageId;
      await setDoc(noteRef, payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, notePath);
    }
  }

  return Date.now();
}

export async function deleteRemoteConversation(user: AuthUser, convId: string): Promise<void> {
  if (user.provider !== 'google') return;
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== user.id) return;
  const safeId = sanitizeDocId(convId, 'conv');
  try {
    await deleteDoc(doc(db, 'users', fbUser.uid, 'conversations', safeId));
  } catch {
    // ignore missing remote doc
  }
}

export async function deleteRemoteStudyNote(user: AuthUser, noteId: string): Promise<void> {
  if (user.provider !== 'google') return;
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== user.id) return;
  const safeId = sanitizeDocId(noteId, 'snote');
  try {
    await deleteDoc(doc(db, 'users', fbUser.uid, 'studyNotes', safeId));
  } catch {
    // ignore missing remote doc
  }
}
