import { readA2uiMode } from '../../utils/a2ui';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { DEFAULT_SETTINGS } from '../../store/defaults';
import type {
  AgentProfile,
  AppSettings,
  Conversation,
  McpServerConfig,
  ModelConfig,
  SavedPrompt,
} from '../../types';
import type { SavedStudyNote } from '../../utils/studyTools';
import { getAppSessionToken, type AuthUser } from '../auth/appAuth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase/client';
import {
  chunkArray,
  computeConversationSignature,
  computeDirtySyncPlan,
  computeStateSignature,
  computeStudyNoteSignature,
  FIRESTORE_BATCH_LIMIT,
  sanitizeConversationForSync,
  sanitizeDocId,
  sanitizeSavedPromptsForSync,
  sanitizeServersForSync,
  sanitizeSettingsForSync,
  sanitizeStudyNoteForSync,
  stripUndefined,
  type DirtySyncPlan,
  type RemoteSyncBaseline,
} from './syncDiff';

export {
  chunkArray,
  computeConversationSignature,
  computeDirtySyncPlan,
  computeStateSignature,
  computeStudyNoteSignature,
  sanitizeConversationForSync,
  sanitizeServersForSync,
  sanitizeSettingsForSync,
  sanitizeStudyNoteForSync,
  stripUndefined,
  type DirtySyncPlan,
  type RemoteSyncBaseline,
};

export interface WorkspaceSnapshot {
  settings: AppSettings;
  agents: AgentProfile[];
  servers: McpServerConfig[];
  dynamicModels: ModelConfig[];
  dismissedDefaultServerIds: string[];
  savedPrompts?: SavedPrompt[];
  conversations: Conversation[];
  savedStudyNotes: SavedStudyNote[];
  updatedAt: number;
}

const remoteBaselines = new Map<string, RemoteSyncBaseline>();

export function resetRemoteSyncBaseline(uid?: string): void {
  if (uid) {
    remoteBaselines.delete(uid);
  } else {
    remoteBaselines.clear();
  }
}

export function getOrCreateBaseline(uid: string): RemoteSyncBaseline {
  let baseline = remoteBaselines.get(uid);
  if (!baseline) {
    baseline = {
      stateExists: false,
      stateSignature: null,
      convSignatures: new Map(),
      noteSignatures: new Map(),
    };
    remoteBaselines.set(uid, baseline);
  }
  return baseline;
}

export function getAccountScope(user: AuthUser | null): string {
  if (!user) return 'guest';
  return `${user.provider}:${user.id}`;
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
    a2uiMode: readA2uiMode((preferRemote ? remote.settings : local.settings) ?? local.settings),
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

  // Merge saved prompt macros by id (newest updatedAt wins)
  const promptMap = new Map<string, SavedPrompt>();
  for (const p of local.savedPrompts ?? []) {
    promptMap.set(p.id, p);
  }
  for (const p of remote.savedPrompts ?? []) {
    const existing = promptMap.get(p.id);
    if (!existing || (p.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      promptMap.set(p.id, p);
    }
  }
  const savedPrompts = Array.from(promptMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);

  return {
    settings,
    agents: Array.from(agentMap.values()),
    servers: Array.from(serverMap.values()),
    dynamicModels: Array.from(modelMap.values()),
    dismissedDefaultServerIds: Array.from(dismissedSet),
    savedPrompts,
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
  const baseline = getOrCreateBaseline(uid);
  baseline.stateExists = Boolean(stateData);
  baseline.convSignatures.clear();
  baseline.noteSignatures.clear();

  const conversations: Conversation[] = convDocs.docs.map((d) => {
    const data = d.data();
    const conv: Conversation = {
      id: String(data.id ?? d.id),
      title: String(data.title ?? 'New Chat'),
      agentId: String(data.agentId ?? 'agent_general'),
      modelId: String(data.modelId ?? 'demo-sandbox'),
      effort: (data.effort ?? 'medium') as Conversation['effort'],
      chatMode: (data.chatMode ?? 'professional') as Conversation['chatMode'],
      knowledgeSource: (data.knowledgeSource ?? 'auto') as Conversation['knowledgeSource'],
      studyInstructions: String(data.studyInstructions ?? ''),
      ...(typeof data.forkedFrom?.conversationId === 'string' ? {
        forkedFrom: {
          conversationId: data.forkedFrom.conversationId,
          messageId: typeof data.forkedFrom.messageId === 'string' ? data.forkedFrom.messageId : undefined,
        },
      } : {}),
      messages: Array.isArray(data.messages) ? (data.messages as Conversation['messages']) : [],
      createdAt: Number(data.clientCreatedAt ?? Date.now()),
      updatedAt: Number(data.clientUpdatedAt ?? Date.now()),
    };
    const sanitized = sanitizeConversationForSync(conv);
    baseline.convSignatures.set(sanitized.id, computeConversationSignature(sanitized));
    return conv;
  });

  const savedStudyNotes: SavedStudyNote[] = noteDocs.docs.map((d) => {
    const data = d.data();
    const note: SavedStudyNote = {
      id: String(data.id ?? d.id),
      title: String(data.title ?? 'Study Note'),
      content: String(data.content ?? ''),
      modelLabel: typeof data.modelLabel === 'string' ? data.modelLabel : undefined,
      messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
      createdAt: Number(data.clientCreatedAt ?? Date.now()),
    };
    const sanitized = sanitizeStudyNoteForSync(note);
    baseline.noteSignatures.set(sanitized.id, computeStudyNoteSignature(sanitized));
    return note;
  });

  if (stateData) {
    baseline.stateSignature = computeStateSignature({
      settings: sanitizeSettingsForSync({
        ...DEFAULT_SETTINGS,
        ...((stateData.settings as Partial<AppSettings>) ?? {}),
        a2uiMode: readA2uiMode(stateData.settings as Partial<AppSettings> | undefined),
      }),
      agents: stripUndefined(
        (Array.isArray(stateData.agents) ? (stateData.agents as AgentProfile[]) : []).slice(0, 50)
      ),
      servers: sanitizeServersForSync(
        Array.isArray(stateData.servers) ? (stateData.servers as McpServerConfig[]) : []
      ),
      dynamicModels: stripUndefined(
        (Array.isArray(stateData.dynamicModels)
          ? (stateData.dynamicModels as ModelConfig[])
          : []
        ).slice(0, 100)
      ),
      dismissedDefaultServerIds: Array.isArray(stateData.dismissedDefaultServerIds)
        ? (stateData.dismissedDefaultServerIds as string[]).slice(0, 50)
        : [],
      ...(Array.isArray(stateData.savedPrompts)
        ? {
            savedPrompts: sanitizeSavedPromptsForSync(stateData.savedPrompts as SavedPrompt[]),
          }
        : {}),
    });
  } else {
    baseline.stateSignature = null;
  }

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
    savedPrompts: Array.isArray(stateData?.savedPrompts)
      ? (stateData.savedPrompts as SavedPrompt[])
      : undefined,
    conversations,
    savedStudyNotes,
    updatedAt: updatedAtMillis,
  };
}

interface BatchWriteItem {
  op: 'create' | 'update';
  ref: DocumentReference;
  data: Record<string, unknown>;
  onCommitted: () => void;
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
    savedPrompts: sanitizeSavedPromptsForSync(snapshot.savedPrompts ?? []),
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

  // Google account via Firestore — batched & dirty-only writes (no per-doc getDoc!)
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== user.id || !fbUser.emailVerified) {
    return Date.now();
  }
  const uid = fbUser.uid;
  const baseline = getOrCreateBaseline(uid);
  const plan = computeDirtySyncPlan(cleanPayload, baseline);
  const writeItems: BatchWriteItem[] = [];

  if (plan.stateOp) {
    const stateRef = doc(db, 'users', uid, 'workspace', 'state');
    const sharedStateFields = {
      settings: cleanPayload.settings,
      agents: cleanPayload.agents,
      servers: cleanPayload.servers,
      dynamicModels: cleanPayload.dynamicModels,
      dismissedDefaultServerIds: cleanPayload.dismissedDefaultServerIds,
      savedPrompts: cleanPayload.savedPrompts,
      updatedAt: serverTimestamp(),
    };
    writeItems.push({
      op: plan.stateOp,
      ref: stateRef,
      data:
        plan.stateOp === 'create'
          ? { ownerId: uid, ...sharedStateFields, createdAt: serverTimestamp() }
          : sharedStateFields,
      onCommitted: () => {
        baseline.stateExists = true;
        baseline.stateSignature = plan.stateSignature;
      },
    });
  }

  for (const item of plan.dirtyConversations) {
    const conv = item.conv;
    const convRef = doc(db, 'users', uid, 'conversations', conv.id);
    const mutableFields = {
      title: conv.title,
      agentId: conv.agentId,
      modelId: conv.modelId,
      effort: conv.effort,
      chatMode: conv.chatMode,
      knowledgeSource: conv.knowledgeSource,
      studyInstructions: conv.studyInstructions,
      ...(conv.forkedFrom ? { forkedFrom: conv.forkedFrom } : {}),
      messages: conv.messages,
      clientUpdatedAt: conv.updatedAt || Date.now(),
      updatedAt: serverTimestamp(),
    };
    writeItems.push({
      op: item.op,
      ref: convRef,
      data:
        item.op === 'create'
          ? {
              ownerId: uid,
              id: conv.id,
              ...mutableFields,
              clientCreatedAt: conv.createdAt || Date.now(),
              createdAt: serverTimestamp(),
            }
          : mutableFields,
      onCommitted: () => {
        baseline.convSignatures.set(conv.id, item.signature);
      },
    });
  }

  for (const item of plan.dirtyNotes) {
    const note = item.note;
    const noteRef = doc(db, 'users', uid, 'studyNotes', note.id);
    const mutableFields: Record<string, unknown> = {
      title: note.title,
      content: note.content,
      updatedAt: serverTimestamp(),
    };
    if (note.modelLabel) mutableFields.modelLabel = note.modelLabel;
    if (note.messageId) mutableFields.messageId = note.messageId;
    writeItems.push({
      op: item.op,
      ref: noteRef,
      data:
        item.op === 'create'
          ? {
              ownerId: uid,
              id: note.id,
              ...mutableFields,
              clientCreatedAt: note.createdAt || Date.now(),
              createdAt: serverTimestamp(),
            }
          : mutableFields,
      onCommitted: () => {
        baseline.noteSignatures.set(note.id, item.signature);
      },
    });
  }

  const chunks = chunkArray(writeItems, FIRESTORE_BATCH_LIMIT);
  for (const chunk of chunks) {
    const batch = writeBatch(db);
    for (const item of chunk) {
      if (item.op === 'create') {
        batch.set(item.ref, item.data);
      } else {
        batch.update(item.ref, item.data);
      }
    }
    try {
      await batch.commit();
      for (const item of chunk) {
        item.onCommitted();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/workspace_batch`);
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
    remoteBaselines.get(fbUser.uid)?.convSignatures.delete(safeId);
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
    remoteBaselines.get(fbUser.uid)?.noteSignatures.delete(safeId);
  } catch {
    // ignore missing remote doc
  }
}
