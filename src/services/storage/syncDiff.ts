import { readA2uiMode } from '../../utils/a2ui';
import type {
  AgentProfile,
  AppSettings,
  ChatAttachment,
  Conversation,
  McpServerConfig,
  ModelConfig,
  SavedPrompt,
} from '../../types';
import type { SavedStudyNote } from '../../utils/studyTools';

export interface RemoteSyncBaseline {
  stateExists: boolean;
  stateSignature: string | null;
  convSignatures: Map<string, string>;
  noteSignatures: Map<string, string>;
}

export const FIRESTORE_BATCH_LIMIT = 450; // strictly under Firestore's hard 500 ops/batch limit

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

export function sanitizeDocId(rawId: string, fallbackPrefix = 'item'): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `${fallbackPrefix}_${Date.now()}`;
}

export function sanitizeSettingsForSync(settings: AppSettings): AppSettings {
  const budget = Math.max(1000, Math.min(32000, Number(settings.toolOutputBudgetChars) || 8000));
  const rules = Array.isArray(settings.alwaysAllowedRules)
    ? settings.alwaysAllowedRules
        .filter((r) => r && typeof r.qualifiedKey === 'string' && r.qualifiedKey.trim())
        .slice(0, 100)
        .map((r) =>
          stripUndefined({
            qualifiedKey: r.qualifiedKey.slice(0, 160),
            expiresAt: r.expiresAt ?? null,
            argPattern: r.argPattern ? r.argPattern.slice(0, 160) : undefined,
          })
        )
    : [];
  const policies = Array.isArray(settings.toolPolicies)
    ? settings.toolPolicies
        .filter((p) => p && typeof p.qualifiedKey === 'string' && p.qualifiedKey.trim())
        .slice(0, 100)
        .map((p) =>
          stripUndefined({
            qualifiedKey: p.qualifiedKey.slice(0, 160),
            policy: p.policy,
            argPattern: p.argPattern ? p.argPattern.slice(0, 160) : undefined,
          })
        )
    : [];

  return {
    theme: settings.theme,
    accentTheme: settings.accentTheme,
    oledDark: Boolean(settings.oledDark),
    a2uiMode: readA2uiMode(settings),
    confirmBeforeWrite: Boolean(settings.confirmBeforeWrite),
    maxAgentSteps: Math.max(1, Math.min(25, Number(settings.maxAgentSteps) || 10)),
    toolOutputBudgetChars: budget,
    alwaysAllowedTools: Array.isArray(settings.alwaysAllowedTools)
      ? settings.alwaysAllowedTools.slice(0, 100)
      : [],
    alwaysAllowedRules: rules,
    toolPolicies: policies,
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

export function sanitizeSavedPromptsForSync(prompts: SavedPrompt[] = []): SavedPrompt[] {
  return prompts
    .filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string')
    .slice(0, 100)
    .map((p) =>
      stripUndefined({
        id: sanitizeDocId(p.id, 'macro'),
        title: p.title.trim().slice(0, 100) || 'Untitled Macro',
        template: String(p.template ?? '').slice(0, 8000),
        category: p.category ? p.category.trim().slice(0, 40) : undefined,
        updatedAt: Number(p.updatedAt) || Date.now(),
      })
    );
}

export function computeStateSignature(statePart: {
  settings: AppSettings;
  agents: AgentProfile[];
  servers: McpServerConfig[];
  dynamicModels: ModelConfig[];
  dismissedDefaultServerIds: string[];
  savedPrompts?: SavedPrompt[];
}): string {
  return JSON.stringify(
    statePart.savedPrompts !== undefined
      ? statePart
      : {
          settings: statePart.settings,
          agents: statePart.agents,
          servers: statePart.servers,
          dynamicModels: statePart.dynamicModels,
          dismissedDefaultServerIds: statePart.dismissedDefaultServerIds,
        }
  );
}

export function computeConversationSignature(conv: Conversation): string {
  const lastMsg = conv.messages[conv.messages.length - 1];
  return `${conv.updatedAt}:${conv.messages.length}:${conv.title}:${conv.agentId}:${conv.modelId}:${conv.effort}:${conv.chatMode ?? ''}:${conv.knowledgeSource ?? ''}:${conv.studyInstructions?.length ?? 0}:${lastMsg?.id ?? ''}:${lastMsg?.content.length ?? 0}`;
}

export function computeStudyNoteSignature(note: SavedStudyNote): string {
  return `${note.title}:${note.content.length}:${note.createdAt}:${note.modelLabel ?? ''}:${note.messageId ?? ''}`;
}

export interface DirtySyncPlan {
  stateOp: 'create' | 'update' | null;
  stateSignature: string;
  dirtyConversations: Array<{
    op: 'create' | 'update';
    conv: Conversation;
    signature: string;
  }>;
  dirtyNotes: Array<{
    op: 'create' | 'update';
    note: SavedStudyNote;
    signature: string;
  }>;
}

export function computeDirtySyncPlan(
  cleanPayload: {
    settings: AppSettings;
    agents: AgentProfile[];
    servers: McpServerConfig[];
    dynamicModels: ModelConfig[];
    dismissedDefaultServerIds: string[];
    savedPrompts?: SavedPrompt[];
    conversations: Conversation[];
    savedStudyNotes: SavedStudyNote[];
  },
  baseline: RemoteSyncBaseline
): DirtySyncPlan {
  const stateSignature = computeStateSignature({
    settings: cleanPayload.settings,
    agents: cleanPayload.agents,
    servers: cleanPayload.servers,
    dynamicModels: cleanPayload.dynamicModels,
    dismissedDefaultServerIds: cleanPayload.dismissedDefaultServerIds,
    ...(cleanPayload.savedPrompts !== undefined ? { savedPrompts: cleanPayload.savedPrompts } : {}),
  });

  const stateOp =
    !baseline.stateExists
      ? 'create'
      : baseline.stateSignature !== stateSignature
        ? 'update'
        : null;

  const dirtyConversations: DirtySyncPlan['dirtyConversations'] = [];
  for (const conv of cleanPayload.conversations) {
    const signature = computeConversationSignature(conv);
    const prevSig = baseline.convSignatures.get(conv.id);
    if (prevSig === undefined) {
      dirtyConversations.push({ op: 'create', conv, signature });
    } else if (prevSig !== signature) {
      dirtyConversations.push({ op: 'update', conv, signature });
    }
  }

  const dirtyNotes: DirtySyncPlan['dirtyNotes'] = [];
  for (const note of cleanPayload.savedStudyNotes) {
    const signature = computeStudyNoteSignature(note);
    const prevSig = baseline.noteSignatures.get(note.id);
    if (prevSig === undefined) {
      dirtyNotes.push({ op: 'create', note, signature });
    } else if (prevSig !== signature) {
      dirtyNotes.push({ op: 'update', note, signature });
    }
  }

  return {
    stateOp,
    stateSignature,
    dirtyConversations,
    dirtyNotes,
  };
}

export function chunkArray<T>(items: T[], maxChunkSize = FIRESTORE_BATCH_LIMIT): T[][] {
  if (items.length === 0) return [];
  const size = Math.max(1, Math.min(500, maxChunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
