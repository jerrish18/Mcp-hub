import type {
  AgentProfile,
  AppSettings,
  ChatAttachment,
  CodeOrchestrationSettings,
  CodingPlan,
  CodingSessionState,
  Conversation,
  McpServerConfig,
  ModelConfig,
  ProjectProfile,
  SavedPrompt,
  WorkspaceDiffEntry,
  WorkspaceFileEntry,
} from '../../types';
import type { SavedStudyNote } from '../../utils/studyTools';
import { resolveA2uiMode } from '../../utils/a2ui';

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

  const resolvedA2uiMode = resolveA2uiMode(settings);

  const manualModelOverrides = Array.isArray(settings.manualModelOverrides)
    ? Array.from(
        new Set(
          settings.manualModelOverrides
            .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
            .map((id) => id.trim().slice(0, 160))
        )
      ).slice(0, 100)
    : [];

  const rawOrch = settings.codeOrchestration;
  const codeOrchestration: CodeOrchestrationSettings | undefined = rawOrch
    ? stripUndefined({
        mode: rawOrch.mode === 'single' ? ('single' as const) : ('custom' as const),
        roles: {
          architect: rawOrch.roles?.architect ? String(rawOrch.roles.architect).slice(0, 160) : null,
          coder: rawOrch.roles?.coder ? String(rawOrch.roles.coder).slice(0, 160) : null,
          reviewer: rawOrch.roles?.reviewer ? String(rawOrch.roles.reviewer).slice(0, 160) : null,
        },
        autoRun: Boolean(rawOrch.autoRun),
      })
    : undefined;

  const resolvedTheme =
    settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system';
  const resolvedAccent =
    settings.accentTheme === 'pixel_blue' ||
    settings.accentTheme === 'sage' ||
    settings.accentTheme === 'clay' ||
    settings.accentTheme === 'lavender' ||
    settings.accentTheme === 'monochrome'
      ? settings.accentTheme
      : 'pixel_blue';

  return stripUndefined({
    theme: resolvedTheme,
    accentTheme: resolvedAccent,
    chatLayout: settings.chatLayout === 'focus' ? 'focus' : 'standard',
    oledDark: Boolean(settings.oledDark),
    a2uiEnabled: resolvedA2uiMode !== 'off',
    a2uiMode: resolvedA2uiMode,
    confirmBeforeWrite: Boolean(settings.confirmBeforeWrite),
    maxAgentSteps: Math.max(1, Math.min(25, Number(settings.maxAgentSteps) || 10)),
    toolOutputBudgetChars: budget,
    alwaysAllowedTools: Array.isArray(settings.alwaysAllowedTools)
      ? settings.alwaysAllowedTools
          .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
          .map((id) => id.slice(0, 160))
          .slice(0, 100)
      : [],
    alwaysAllowedRules: rules,
    toolPolicies: policies,
    biometricLockEnabled: Boolean(settings.biometricLockEnabled),
    hapticsEnabled: Boolean(settings.hapticsEnabled),
    onboardingCompleted: Boolean(settings.onboardingCompleted),
    localModelToolsEnabled: Boolean(settings.localModelToolsEnabled),
    manualModelOverrides,
    ...(codeOrchestration ? { codeOrchestration } : {}),
  });
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

function sanitizeCodingPlan(plan?: CodingPlan | null): CodingPlan | undefined {
  if (!plan || typeof plan !== 'object') return undefined;
  return stripUndefined({
    ...plan,
    prompt: String(plan.prompt ?? '').slice(0, 8000),
    summary: String(plan.summary ?? '').slice(0, 2000),
    requirements: (plan.requirements ?? []).slice(0, 30).map((r) => ({
      id: String(r.id ?? ''),
      text: String(r.text ?? '').slice(0, 400),
      checked: Boolean(r.checked),
    })),
    fileManifest: (plan.fileManifest ?? []).slice(0, 40).map((f) => ({
      path: String(f.path ?? '').slice(0, 200),
      action: f.action,
      purpose: String(f.purpose ?? '').slice(0, 240),
    })),
    tasks: (plan.tasks ?? []).slice(0, 30).map((t) => ({
      ...t,
      title: String(t.title ?? '').slice(0, 240),
      targetFiles: (t.targetFiles ?? []).slice(0, 20),
      verificationCheck: String(t.verificationCheck ?? '').slice(0, 240),
      error: t.error ? String(t.error).slice(0, 500) : undefined,
      fallbackNote: t.fallbackNote ? String(t.fallbackNote).slice(0, 300) : undefined,
    })),
    verificationErrors: (plan.verificationErrors ?? []).slice(0, 25).map((e) => String(e).slice(0, 500)),
    subagentTraces: (plan.subagentTraces ?? []).slice(-30),
  });
}

function sanitizeCodingSession(session?: CodingSessionState): CodingSessionState | undefined {
  if (!session || typeof session !== 'object') return undefined;
  const files: Record<string, WorkspaceFileEntry> = {};
  for (const [k, f] of Object.entries(session.files ?? {}).slice(0, 40)) {
    if (!f) continue;
    files[k] = stripUndefined({
      path: String(f.path ?? k).slice(0, 200),
      content: String(f.content ?? '').slice(0, 24000),
      language: String(f.language ?? 'plaintext').slice(0, 40),
      status: f.status,
      updatedAt: Number(f.updatedAt) || Date.now(),
    });
  }
  const diffs: Record<string, WorkspaceDiffEntry> = {};
  for (const [k, d] of Object.entries(session.diffs ?? {}).slice(0, 40)) {
    if (!d) continue;
    diffs[k] = stripUndefined({
      path: String(d.path ?? k).slice(0, 200),
      before: String(d.before ?? '').slice(0, 16000),
      after: String(d.after ?? '').slice(0, 16000),
      action: d.action ?? 'modify',
      status: d.status,
      taskId: d.taskId ? String(d.taskId).slice(0, 80) : undefined,
      checkpointId: d.checkpointId ? String(d.checkpointId).slice(0, 80) : undefined,
      updatedAt: Number(d.updatedAt) || Date.now(),
    });
  }
  const checkpoints = (session.checkpoints ?? []).slice(-8).map((cp) => {
    const cpFiles: Record<string, string> = {};
    for (const [fk, fv] of Object.entries(cp.files ?? {}).slice(0, 25)) {
      cpFiles[fk] = String(fv ?? '').slice(0, 12000);
    }
    return stripUndefined({
      id: String(cp.id),
      label: String(cp.label ?? '').slice(0, 120),
      ...(cp.taskId ? { taskId: String(cp.taskId).slice(0, 80) } : {}),
      createdAt: Number(cp.createdAt) || Date.now(),
      files: cpFiles,
    });
  });

  return stripUndefined({
    activePlan: sanitizeCodingPlan(session.activePlan) ?? null,
    files,
    diffs,
    checkpoints,
    toolTrace: (session.toolTrace ?? []).slice(-80).map((t) =>
      stripUndefined({
        ...t,
        outputPreview: String(t.outputPreview ?? '').slice(0, 500),
      })
    ),
    contextStats: session.contextStats ?? {
      estimatedTokens: 0,
      contextWindow: 128_000,
      ratio: 0,
      compacted: false,
    },
  });
}

export function sanitizeConversationForSync(conv: Conversation): Conversation {
  const effort =
    conv.effort === 'low' || conv.effort === 'high' ? conv.effort : ('medium' as const);
  const chatMode =
    conv.chatMode === 'general' ||
    conv.chatMode === 'professional' ||
    conv.chatMode === 'study' ||
    conv.chatMode === 'coding'
      ? conv.chatMode
      : ('professional' as const);
  const knowledgeSource =
    conv.knowledgeSource === 'auto' ||
    conv.knowledgeSource === 'uploaded' ||
    conv.knowledgeSource === 'web' ||
    conv.knowledgeSource === 'general'
      ? conv.knowledgeSource
      : ('auto' as const);
  const forkedFrom =
    conv.forkedFrom &&
    typeof conv.forkedFrom.conversationId === 'string' &&
    conv.forkedFrom.conversationId.trim()
      ? stripUndefined({
          conversationId: conv.forkedFrom.conversationId.trim().slice(0, 128),
          messageId: conv.forkedFrom.messageId
            ? String(conv.forkedFrom.messageId).slice(0, 128)
            : undefined,
        })
      : undefined;

  return stripUndefined({
    ...conv,
    id: sanitizeDocId(conv.id, 'conv'),
    title: (conv.title || 'New Chat').trim().slice(0, 200) || 'New Chat',
    agentId: (conv.agentId || '').trim().slice(0, 128) || 'agent_general',
    modelId: (conv.modelId || '').trim().slice(0, 160) || 'demo-sandbox',
    effort,
    chatMode,
    knowledgeSource,
    studyInstructions: String(conv.studyInstructions ?? '').slice(0, 4000),
    projectId: conv.projectId ? String(conv.projectId).slice(0, 128) : undefined,
    forkedFrom,
    codingSession: sanitizeCodingSession(conv.codingSession),
    messages: (conv.messages ?? []).slice(-150).map((m) =>
      stripUndefined({
        ...m,
        content: String(m.content ?? '').slice(0, 60000),
        reasoning: m.reasoning ? m.reasoning.slice(0, 12000) : undefined,
        attachments: sanitizeAttachments(m.attachments),
        codingPlan: sanitizeCodingPlan(m.codingPlan),
        runTrace: m.runTrace
          ? {
              ...m.runTrace,
              isLive: undefined,
              steps: m.runTrace.steps?.slice(0, 60),
            }
          : undefined,
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

export function sanitizeProjectsForSync(projects: ProjectProfile[] = []): ProjectProfile[] {
  return projects
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .slice(0, 50)
    .map((p) =>
      stripUndefined({
        id: sanitizeDocId(p.id, 'proj'),
        name: p.name.trim().slice(0, 80) || 'Untitled Project',
        description: String(p.description ?? '').slice(0, 300),
        instructions: String(p.instructions ?? '').slice(0, 8000),
        pinnedFiles: (p.pinnedFiles ?? []).slice(0, 10).map((f) => ({
          id: sanitizeDocId(f.id, 'pfile'),
          name: String(f.name ?? 'file.txt').slice(0, 120),
          size: Number(f.size) || 0,
          textContent: String(f.textContent ?? '').slice(0, 12000),
        })),
        defaultAgentId: p.defaultAgentId ? String(p.defaultAgentId).slice(0, 128) : undefined,
        allowedServerIds: Array.isArray(p.allowedServerIds)
          ? p.allowedServerIds.slice(0, 50)
          : p.allowedServerIds ?? null,
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
  projects?: ProjectProfile[];
}): string {
  return JSON.stringify(
    statePart.savedPrompts !== undefined || statePart.projects !== undefined
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
  const widgetSigLen = conv.messages.reduce(
    (sum, m) =>
      sum +
      (m.a2uiWidgetState ? JSON.stringify(m.a2uiWidgetState).length : 0) +
      (m.codingPlan ? `${m.codingPlan.phase}:${m.codingPlan.updatedAt}:${m.codingPlan.requirements.length}`.length : 0),
    0
  );
  const codeSig = conv.codingSession
    ? `${conv.codingSession.activePlan?.phase ?? ''}:${conv.codingSession.activePlan?.updatedAt ?? 0}:${Object.keys(conv.codingSession.files).length}:${Object.keys(conv.codingSession.diffs).length}`
    : '';
  return `${conv.updatedAt}:${conv.messages.length}:${conv.title}:${conv.agentId}:${conv.modelId}:${conv.effort}:${conv.chatMode ?? ''}:${conv.knowledgeSource ?? ''}:${conv.projectId ?? ''}:${conv.studyInstructions?.length ?? 0}:${widgetSigLen}:${codeSig}:${lastMsg?.id ?? ''}:${lastMsg?.content.length ?? 0}`;
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
    projects?: ProjectProfile[];
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
    ...(cleanPayload.projects !== undefined ? { projects: cleanPayload.projects } : {}),
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
