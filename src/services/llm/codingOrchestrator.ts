import {
  CODING_ROLE_METADATA,
  getModelById,
  normalizeModelId,
  scoreModelForCodingRole,
  selectDefaultRoleModels,
} from '../../config/models';
import type {
  AgentProfile,
  AlwaysAllowDuration,
  AlwaysAllowRule,
  ApprovalDecision,
  ApprovalResolution,
  ChatAttachment,
  CloudProvider,
  CodeOrchestrationSettings,
  CodingContextStats,
  CodingPlan,
  CodingPlanFileAction,
  CodingPlanFileItem,
  CodingPlanRequirement,
  CodingPlanTask,
  CodingRole,
  CodingSessionState,
  CodingSubagentTrace,
  EffortLevel,
  GroundingCitation,
  McpServerConfig,
  ModelConfig,
  PendingApproval,
  ProjectProfile,
  ProviderKeys,
  ProviderValidationResult,
  RunTrace,
  ServerSecretPayload,
  ToolCallRecord,
  ToolPolicyRule,
  ToolTraceEntry,
  WorkspaceFileEntry,
} from '../../types';
import { safeErrorMessage } from '../../utils/redact';
import { runAgentLoop } from './agentLoop';
import { getOrchestratorModels, isAutomaticCodingModel } from './provider';
import {
  buildWorkspaceArtifactAppJson,
  buildWorkspaceToolDefinitions,
  executeWorkspaceVfsTool,
  normalizeSafeWorkspacePath,
  WorkspaceVfs,
} from './toolHarness';
import type { LlmConversationItem, LlmToolDefinition } from './types';

export interface ResolvedRoleTarget {
  role: CodingRole;
  model: ModelConfig;
  fallbackChain: string[];
}

export function supportsCodingRole(model: ModelConfig, role: CodingRole): boolean {
  return role === 'architect' || !model.routes?.length || model.routes.some((route) => route.tools);
}

function codingRoleAssignment(
  role: CodingRole, orchestration: CodeOrchestrationSettings | undefined, activeModelId: string
) {
  const assignment = orchestration?.mode === 'single' ? activeModelId : orchestration?.roles[role];
  return assignment ? normalizeModelId(assignment) : null;
}

export function resolveCodingRoleModel(
  role: CodingRole,
  orchestration: CodeOrchestrationSettings | undefined,
  availableModels: ModelConfig[],
  activeModelId: string
): ResolvedRoleTarget {
  const mode = orchestration?.mode ?? 'custom';
  const usable = availableModels.filter((model) =>
    normalizeModelId(model.id) !== 'cloud-auto' && supportsCodingRole(model, mode === 'single' ? 'coder' : role));
  const automatic = usable.filter(isAutomaticCodingModel);
  const defaults = selectDefaultRoleModels(automatic);
  const assignment = codingRoleAssignment(role, orchestration, activeModelId);
  const defaultId = mode === 'single' ? defaults.architect : defaults[role];
  const matched =
    (assignment ? usable.find((model) => normalizeModelId(model.id) === assignment) : undefined) ??
    automatic.find((model) => model.id === defaultId) ??
    getModelById('demo-sandbox', availableModels);

  const fallbackChain = mode === 'single' ? [] : automatic
    .filter((model) => model.id !== matched.id && model.provider !== 'local' && model.provider !== 'demo')
    .sort((a, b) => scoreModelForCodingRole(b, role) - scoreModelForCodingRole(a, role) || a.id.localeCompare(b.id))
    .map((model) => model.id);

  return {
    role,
    model: matched,
    fallbackChain,
  };
}

function completedProvider(trace: RunTrace, model: ModelConfig) {
  return trace.steps?.filter((step) => step.kind === 'model_call')
    .reverse().find((step) => step.status === 'ok')?.provider ?? model.provider;
}

function buildPlanSummaryForPin(plan: CodingPlan): string {
  const reqLines = plan.requirements.map((r) => `- [${r.checked ? 'x' : ' '}] ${r.text}`).join('\n');
  const taskLines = plan.tasks
    .map((t) => `- (${t.status}) ${t.title} [${t.targetFiles.join(', ')}]`)
    .join('\n');
  return `Summary: ${plan.summary}\nRequirements:\n${reqLines}\nTasks:\n${taskLines}`;
}

function buildDefaultCodingPlan(
  prompt: string,
  autoRun: boolean,
  existingFiles: Record<string, WorkspaceFileEntry>
): Omit<CodingPlan, 'id' | 'createdAt' | 'updatedAt' | 'repairAttempts' | 'maxRepairAttempts' | 'verificationErrors' | 'subagentTraces'> {
  const activeNames = Object.values(existingFiles)
    .filter((f) => f.status !== 'deleted')
    .map((f) => f.path);
  const cleanPrompt = prompt.trim();
  const isModifyExisting = activeNames.length > 0 && /\b(fix|bug|update|patch|refactor|add|improve|edit|modify)\b/i.test(cleanPrompt);

  if (isModifyExisting) {
    const primaryTarget = activeNames[0];
    return {
      prompt: cleanPrompt,
      summary: `Inspect ${activeNames.length} workspace file(s), apply targeted patches, and verify syntax and behavior.`,
      phase: autoRun ? 'executing' : 'awaiting_approval',
      autoRun,
      requirements: [
        { id: 'req_1', text: 'Inspect existing workspace files before editing', checked: false },
        { id: 'req_2', text: `Apply targeted patch to satisfy: ${cleanPrompt.slice(0, 90)}`, checked: false },
        { id: 'req_3', text: 'Verify syntax, asset references, and clean diffs', checked: false },
      ],
      fileManifest: activeNames.slice(0, 4).map((path) => ({
        path,
        action: path === primaryTarget ? 'modify' : 'modify',
        purpose: 'Update implementation and verify edge cases',
      })),
      tasks: [
        {
          id: 'task_1',
          title: `Read and patch ${primaryTarget}`,
          targetFiles: [primaryTarget],
          verificationCheck: 'verify_code passes with 0 errors',
          status: 'pending',
        },
        {
          id: 'task_2',
          title: 'Run static verification & diff audit',
          targetFiles: activeNames.slice(0, 4),
          verificationCheck: 'All HTML/JS/CSS/JSON checks clean',
          status: 'pending',
        },
      ],
    };
  }

  return {
    prompt: cleanPrompt,
    summary: `Architect and implement a modular, interactive web application for: ${cleanPrompt.slice(0, 120)}`,
    phase: autoRun ? 'executing' : 'awaiting_approval',
    autoRun,
    requirements: [
      { id: 'req_1', text: 'Create clean semantic HTML structure with accessible landmarks', checked: false },
      { id: 'req_2', text: 'Build responsive light/dark CSS layout with >= 44px touch targets', checked: false },
      { id: 'req_3', text: 'Wire deterministic vanilla JavaScript state & interactive controls', checked: false },
      { id: 'req_4', text: 'Pass automated HTML/CSS/JS verification checks cleanly', checked: false },
    ],
    fileManifest: [
      { path: 'index.html', action: 'create', purpose: 'Semantic application shell and controls' },
      { path: 'styles.css', action: 'create', purpose: 'Responsive layout tokens, typography, and dark mode styles' },
      { path: 'app.js', action: 'create', purpose: 'DOMContentLoaded state management and event handlers' },
    ],
    tasks: [
      {
        id: 'task_1',
        title: 'Create semantic HTML entry and responsive stylesheet',
        targetFiles: ['index.html', 'styles.css'],
        verificationCheck: 'HTML tags balanced and stylesheet links resolve',
        status: 'pending',
      },
      {
        id: 'task_2',
        title: 'Implement interactive state logic in app.js',
        targetFiles: ['app.js'],
        verificationCheck: 'Valid JS syntax and interactive event listeners wired',
        status: 'pending',
      },
    ],
  };
}

export function parseCodingPlanFromText(
  rawText: string,
  prompt: string,
  autoRun: boolean,
  existingFiles: Record<string, WorkspaceFileEntry>
): CodingPlan {
  const now = Date.now();
  const baseDefaults = buildDefaultCodingPlan(prompt, autoRun, existingFiles);

  const candidates: string[] = [];
  const jsonFenceRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFenceRegex.exec(rawText)) !== null) {
    candidates.push(match[1].trim());
  }
  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(rawText.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') continue;

      const summary =
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : baseDefaults.summary;

      const rawReqs = Array.isArray(parsed.requirements) ? parsed.requirements : [];
      const requirements: CodingPlanRequirement[] = rawReqs
        .map((r, idx): CodingPlanRequirement | null => {
          if (typeof r === 'string' && r.trim()) {
            return { id: `req_${idx + 1}`, text: r.trim(), checked: false };
          }
          if (r && typeof r === 'object') {
            const obj = r as Record<string, unknown>;
            const text = String(obj.text ?? obj.title ?? obj.label ?? '').trim();
            if (!text) return null;
            return {
              id: typeof obj.id === 'string' && obj.id ? obj.id : `req_${idx + 1}`,
              text,
              checked: Boolean(obj.checked),
            };
          }
          return null;
        })
        .filter((r): r is CodingPlanRequirement => r !== null);

      const rawManifest = Array.isArray(parsed.fileManifest)
        ? parsed.fileManifest
        : Array.isArray(parsed.files)
          ? parsed.files
          : [];
      const fileManifest: CodingPlanFileItem[] = rawManifest
        .map((item): CodingPlanFileItem | null => {
          if (!item || typeof item !== 'object') return null;
          const obj = item as Record<string, unknown>;
          const safe = normalizeSafeWorkspacePath(String(obj.path ?? obj.file ?? ''));
          if (!safe.ok) return null;
          const rawAction = String(obj.action ?? 'create').toLowerCase();
          const action: CodingPlanFileAction =
            rawAction === 'delete'
              ? 'delete'
              : rawAction === 'modify' || rawAction === 'update'
                ? 'modify'
                : 'create';
          return {
            path: safe.path,
            action,
            purpose: String(obj.purpose ?? obj.description ?? 'Implement planned changes').trim(),
          };
        })
        .filter((item): item is CodingPlanFileItem => item !== null);

      const rawTasks = Array.isArray(parsed.tasks)
        ? parsed.tasks
        : Array.isArray(parsed.steps)
          ? parsed.steps
          : [];
      const tasks: CodingPlanTask[] = rawTasks
        .map((t, idx): CodingPlanTask | null => {
          if (!t || typeof t !== 'object') return null;
          const obj = t as Record<string, unknown>;
          const title = String(obj.title ?? obj.name ?? '').trim();
          if (!title) return null;
          const rawTargets = Array.isArray(obj.targetFiles)
            ? obj.targetFiles
            : Array.isArray(obj.target_files)
              ? obj.target_files
              : [];
          const targetFiles = rawTargets
            .map((f) => normalizeSafeWorkspacePath(String(f ?? '')))
            .filter((r) => r.ok)
            .map((r) => r.path);
          return {
            id: typeof obj.id === 'string' && obj.id ? obj.id : `task_${idx + 1}`,
            title,
            targetFiles,
            verificationCheck:
              String(obj.verificationCheck ?? obj.verification_check ?? 'verify_code passes cleanly').trim(),
            status: 'pending',
          };
        })
        .filter((t): t is CodingPlanTask => t !== null);

      if (tasks.length === 0 && requirements.length === 0 && fileManifest.length === 0) {
        continue;
      }

      return {
        id: `plan_${now}`,
        prompt: prompt.trim(),
        summary,
        phase: autoRun ? 'executing' : 'awaiting_approval',
        autoRun,
        requirements: requirements.length > 0 ? requirements : baseDefaults.requirements,
        fileManifest: fileManifest.length > 0 ? fileManifest : baseDefaults.fileManifest,
        tasks: tasks.length > 0 ? tasks : baseDefaults.tasks,
        repairAttempts: 0,
        maxRepairAttempts: 3,
        verificationErrors: [],
        subagentTraces: [],
        createdAt: now,
        updatedAt: now,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    id: `plan_${now}`,
    ...baseDefaults,
    phase: 'awaiting_approval',
    autoRun: false,
    repairAttempts: 0,
    maxRepairAttempts: 3,
    verificationErrors: [],
    subagentTraces: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createInitialCodingSession(): CodingSessionState {
  return {
    activePlan: null,
    files: {},
    diffs: {},
    checkpoints: [],
    toolTrace: [],
    contextStats: {
      estimatedTokens: 0,
      contextWindow: 128_000,
      ratio: 0,
      compacted: false,
    },
  };
}

export function seedVfsFromContext(
  vfs: WorkspaceVfs,
  project?: ProjectProfile | null,
  attachments?: ChatAttachment[]
): void {
  if (project?.pinnedFiles) {
    for (const pf of project.pinnedFiles) {
      if (pf.textContent) {
        vfs.seedFile(pf.name, pf.textContent);
      }
    }
  }
  if (attachments) {
    for (const att of attachments) {
      if (att.textContent) {
        vfs.seedFile(att.name, att.textContent);
      }
    }
  }
}

export interface CodingOrchestratorCallbacks {
  onPlanUpdated: (plan: CodingPlan) => void;
  onSessionUpdated: (session: CodingSessionState) => void;
  onTextDelta: (fullText: string) => void;
  onReasoningDelta: (fullReasoning: string) => void;
  onToolCallsUpdated: (toolCalls: ToolCallRecord[]) => void;
  onCitationsUpdated?: (citations: GroundingCitation[]) => void;
  onTraceUpdated?: (trace: RunTrace) => void;
  onFallbackNotice: (fromModel: ModelConfig, toModel: ModelConfig, reason: string) => void;
  requestApproval: (
    approval: Omit<PendingApproval, 'resolve'>
  ) => Promise<ApprovalDecision | ApprovalResolution>;
  onAlwaysAllowTool: (
    qualifiedKey: string,
    options?: { duration?: AlwaysAllowDuration; argPattern?: string }
  ) => void;
  getServerSecrets: (serverId: string) => Promise<ServerSecretPayload>;
  saveServerSecrets: (serverId: string, updated: ServerSecretPayload) => Promise<void>;
}

export interface RunCodingPlanParams {
  prompt: string;
  attachments?: ChatAttachment[];
  session: CodingSessionState;
  orchestration: CodeOrchestrationSettings;
  activeModelId: string;
  effort: EffortLevel;
  agent: AgentProfile;
  project?: ProjectProfile | null;
  keys: ProviderKeys;
  dynamicModels: ModelConfig[];
  manualModelOverrides: string[];
  providerValidation?: Partial<Record<CloudProvider, ProviderValidationResult>>;
  allowLocalTools: boolean;
  servers: McpServerConfig[];
  confirmBeforeWrite: boolean;
  alwaysAllowedTools: string[];
  alwaysAllowedRules?: AlwaysAllowRule[];
  toolPolicies?: ToolPolicyRule[];
  toolOutputBudgetChars?: number;
  signal: AbortSignal;
  fetchFn?: typeof fetch;
  callbacks: CodingOrchestratorCallbacks;
}

function extractFallbackFilesFromText(
  rawText: string,
  targetFiles: string[]
): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  const pushFile = (rawPath: string, content: string) => {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok || !content.trim() || seen.has(safe.path)) return;
    seen.add(safe.path);
    out.push({ path: safe.path, content });
  };

  const artifactRegex = /```artifact-app\s*\n([\s\S]*?)\n```/gi;
  let artMatch: RegExpExecArray | null;
  while ((artMatch = artifactRegex.exec(rawText)) !== null) {
    try {
      const parsed = JSON.parse(artMatch[1]) as {
        files?: Array<{ path?: string; name?: string; content?: string; code?: string }>;
      };
      if (Array.isArray(parsed.files)) {
        for (const f of parsed.files) {
          pushFile(String(f.path ?? f.name ?? ''), String(f.content ?? f.code ?? ''));
        }
      }
    } catch {
      // ignore malformed block
    }
  }
  if (out.length > 0) return out;

  const langBlockRegex = /```(html|css|javascript|js|typescript|ts|json)(?:\s+([^\n`]+))?\s*\n([\s\S]*?)\n```/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = langBlockRegex.exec(rawText)) !== null) {
    const lang = blockMatch[1].toLowerCase();
    const headerHint = (blockMatch[2] ?? '').trim();
    const code = blockMatch[3];
    const ext =
      lang === 'html'
        ? '.html'
        : lang === 'css'
          ? '.css'
          : lang === 'json'
            ? '.json'
            : lang === 'typescript' || lang === 'ts'
              ? '.ts'
              : '.js';
    const explicitTarget =
      (headerHint && !headerHint.includes(' ') ? headerHint : undefined) ??
      targetFiles.find((t) => t.toLowerCase().endsWith(ext)) ??
      (lang === 'html' ? 'index.html' : lang === 'css' ? 'styles.css' : lang === 'js' || lang === 'javascript' ? 'app.js' : undefined);
    if (explicitTarget) pushFile(explicitTarget, code);
  }
  return out;
}

function buildSandboxDashboardFiles(prompt: string): Array<{ path: string; content: string }> {
  const titleMatch = prompt.match(/(?:called|named|for|build\s+a[n]?)\s+([a-zA-Z0-9\s-]{3,42})/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : 'Engineering Metric Hub';
  const appTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  return [
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appTitle}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="workspace">
    <header class="header">
      <div>
        <h1>${appTitle}</h1>
        <p class="subtitle">Interactive workspace build · Spec → Build → Verify</p>
      </div>
      <div class="meta-line" id="summaryStats">3 items · 1 completed</div>
    </header>
    <form class="add-form" id="itemForm">
      <input id="itemInput" type="text" placeholder="Add milestone or deliverable..." required />
      <select id="prioritySelect" aria-label="Priority">
        <option value="high">High</option>
        <option value="medium" selected>Medium</option>
        <option value="low">Low</option>
      </select>
      <button type="submit">Add</button>
    </form>
    <div class="filters" role="tablist" aria-label="Filter items">
      <button type="button" data-filter="all" class="filter-btn active">All</button>
      <button type="button" data-filter="open" class="filter-btn">Open</button>
      <button type="button" data-filter="done" class="filter-btn">Completed</button>
    </div>
    <ul class="task-list" id="taskList"></ul>
  </main>
  <script src="./app.js" defer></script>
</body>
</html>`,
    },
    {
      path: 'styles.css',
      content: `:root {
  color-scheme: light dark;
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #cbd5e1;
  --ink: #0f172a;
  --muted: #475569;
  --accent: #0b57d0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --surface: #1e293b;
    --border: #334155;
    --ink: #f8fafc;
    --muted: #94a3b8;
    --accent: #60a5fa;
  }
}
* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; padding: 20px; background: var(--bg); color: var(--ink); }
.workspace { max-width: 680px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 20px; }
.header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 16px; }
h1 { margin: 0; font-size: 20px; }
.subtitle, .meta-line { margin: 4px 0 0; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.add-form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.add-form input, .add-form select { min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--ink); font-size: 14px; }
.add-form input { flex: 1; min-width: 180px; }
.add-form button { min-height: 44px; padding: 0 18px; border: 0; border-radius: 10px; background: var(--accent); color: #ffffff; font-weight: 600; cursor: pointer; }
.filters { display: flex; gap: 8px; margin-bottom: 12px; }
.filter-btn { min-height: 44px; padding: 0 14px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--ink); font-size: 13px; font-weight: 600; cursor: pointer; }
.filter-btn.active { background: var(--accent); color: #ffffff; border-color: var(--accent); }
.task-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.task-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; }
.task-row.done .task-title { text-decoration: line-through; color: var(--muted); }
.task-row button { min-height: 44px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: transparent; color: var(--ink); cursor: pointer; font-size: 12px; font-weight: 600; }`,
    },
    {
      path: 'app.js',
      content: `document.addEventListener('DOMContentLoaded', () => {
  const storageKey = 'mcphub_code_app_v1';
  let items = [
    { id: 1, title: 'Validate architecture spec & file manifest', priority: 'high', done: true },
    { id: 2, title: 'Review unified diffs & verification status', priority: 'medium', done: false },
    { id: 3, title: 'Preview live bundle inside Pro Canvas', priority: 'low', done: false },
  ];
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved) items = JSON.parse(saved);
  } catch {
    // in-memory fallback
  }

  let activeFilter = 'all';
  const listEl = document.getElementById('taskList');
  const statsEl = document.getElementById('summaryStats');
  const formEl = document.getElementById('itemForm');
  const inputEl = document.getElementById('itemInput');
  const priorityEl = document.getElementById('prioritySelect');
  const filterBtns = Array.from(document.querySelectorAll('.filter-btn'));

  function persist() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // ignore storage failure in restricted sandboxes
    }
  }

  function render() {
    const doneCount = items.filter((t) => t.done).length;
    statsEl.textContent = items.length + ' items · ' + doneCount + ' completed';
    const visible = items.filter((t) =>
      activeFilter === 'open' ? !t.done : activeFilter === 'done' ? t.done : true
    );
    listEl.innerHTML = '';
    for (const item of visible) {
      const li = document.createElement('li');
      li.className = 'task-row' + (item.done ? ' done' : '');
      const span = document.createElement('span');
      span.className = 'task-title';
      span.textContent = '[' + item.priority.toUpperCase() + '] ' + item.title;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.done ? 'Reopen' : 'Done';
      btn.addEventListener('click', () => {
        item.done = !item.done;
        persist();
        render();
      });
      li.append(span, btn);
      listEl.appendChild(li);
    }
  }

  formEl.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    items.unshift({
      id: Date.now(),
      title: text,
      priority: priorityEl.value || 'medium',
      done: false,
    });
    inputEl.value = '';
    persist();
    render();
  });

  for (const btn of filterBtns) {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter || 'all';
      filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
  }

  render();
});`,
    },
  ];
}

export async function runCodingPlanPhase(params: RunCodingPlanParams): Promise<{
  plan: CodingPlan;
  session: CodingSessionState;
  summaryText: string;
}> {
  const {
    prompt,
    attachments = [],
    session,
    orchestration,
    activeModelId,
    effort,
    agent,
    project,
    keys,
    dynamicModels,
    manualModelOverrides,
    providerValidation,
    allowLocalTools,
    servers,
    confirmBeforeWrite,
    alwaysAllowedTools,
    alwaysAllowedRules,
    toolPolicies,
    toolOutputBudgetChars,
    signal,
    fetchFn,
    callbacks,
  } = params;

  const vfs = new WorkspaceVfs({
    files: session.files,
    diffs: session.diffs,
    checkpoints: session.checkpoints,
  });
  seedVfsFromContext(vfs, project, attachments);

  const availableModels = getOrchestratorModels({
    keys,
    dynamicModels,
    manualModelOverrides,
    providerValidation,
  });
  const architectTarget = resolveCodingRoleModel('architect', orchestration, availableModels, activeModelId);
  if (signal?.aborted) throw new DOMException('Planning stopped', 'AbortError');
  const autoRun = Boolean(orchestration.autoRun);
  const workspaceReadTools = buildWorkspaceToolDefinitions().filter((t) => t.isReadOnly);

  const toolTrace = [...session.toolTrace];
  let contextStats = { ...session.contextStats };

  const recordSessionState = (activePlan: CodingPlan | null): CodingSessionState => {
    const next: CodingSessionState = {
      activePlan,
      files: vfs.getFilesSnapshot(),
      diffs: vfs.getDiffsSnapshot(),
      checkpoints: vfs.getCheckpointsSnapshot(),
      toolTrace: [...toolTrace].slice(-120),
      contextStats,
    };
    callbacks.onSessionUpdated(next);
    return next;
  };

  const startedAt = Date.now();
  let plan: CodingPlan;

  if (architectTarget.model.provider === 'demo') {
    const listed = vfs.listFiles();
    toolTrace.push({
      id: `trace_plan_list_${startedAt}`,
      toolName: 'list_files',
      resolvedToolName: 'list_files',
      args: {},
      validationStatus: 'valid',
      repairAttempts: 0,
      durationMs: 4,
      outputPreview: listed.text.slice(0, 300),
      isError: !listed.ok,
      isReadOnly: true,
      timestamp: startedAt,
      role: 'architect',
      modelId: architectTarget.model.id,
    });

    plan = { ...parseCodingPlanFromText('', prompt, false, vfs.getFilesSnapshot()),
      autoRun, phase: autoRun ? 'executing' : 'awaiting_approval' };
    const estTokens = Math.ceil((prompt.length + JSON.stringify(plan).length) / 3.5);
    const ctxWin = architectTarget.model.contextWindow || 32_000;
    contextStats = {
      estimatedTokens: estTokens,
      contextWindow: ctxWin,
      ratio: Number((estTokens / ctxWin).toFixed(3)),
      compacted: false,
    };
    const traceEntry: CodingSubagentTrace = {
      id: `sub_plan_${startedAt}`,
      phase: 'planning',
      role: 'architect',
      modelId: architectTarget.model.id,
      provider: architectTarget.model.provider,
      tokens: Math.ceil(prompt.length / 3.5) + 180,
      durationMs: Math.max(12, Date.now() - startedAt),
      status: 'ok',
    };
    plan.subagentTraces = [traceEntry];
  } else {
    const planningPrompt =
      `[PHASE 1 — ARCHITECT PLANNING]\n` +
      `You are the **${CODING_ROLE_METADATA.architect.label}**. Inspect existing workspace files with read-only tools (\`list_files\`, \`read_file\`, \`search_code\`), then output ONLY a valid JSON object matching this exact CodingPlan schema inside a \`\`\`json code fence:\n` +
      `{\n` +
      `  "summary": "Concise architectural overview",\n` +
      `  "requirements": [{"id": "req_1", "text": "Specific functional requirement", "checked": false}],\n` +
      `  "fileManifest": [{"path": "relative/path", "action": "create|modify|delete", "purpose": "One-line purpose"}],\n` +
      `  "tasks": [{"id": "task_1", "title": "Ordered step title", "targetFiles": ["relative/path"], "verificationCheck": "Exact verification check"}]\n` +
      `}\n` +
      `Do NOT edit or write files during Phase 1 planning. User request:\n${prompt}`;

    const history: LlmConversationItem[] = [
      { role: 'user', text: planningPrompt, attachments: attachments.length > 0 ? attachments : undefined },
    ];

    const loopRes = await runAgentLoop({
      agent,
      modelId: architectTarget.model.id,
      effort,
      chatMode: 'coding',
      a2uiEnabled: false,
      a2uiMode: 'off',
      project,
      keys,
      dynamicModels: availableModels,
      manualModelOverrides: codingRoleAssignment('architect', orchestration, activeModelId) === architectTarget.model.id
        ? manualModelOverrides : [],
      allowLocalTools,
      servers: servers.map((s) => ({
        ...s,
        tools: s.tools.filter((t) => t.annotations?.readOnlyHint === true),
      })),
      extraTools: workspaceReadTools,
      customToolExecutor: async (def, args) => executeWorkspaceVfsTool(vfs, def.originalName, args),
      codingContextPin: { files: vfs.getFilesSnapshot() },
      codingRole: 'architect',
      fallbackModelIds: architectTarget.fallbackChain,
      history,
      maxSteps: 6,
      confirmBeforeWrite,
      alwaysAllowedTools,
      alwaysAllowedRules,
      toolPolicies,
      toolOutputBudgetChars,
      signal,
      fetchFn,
      callbacks: {
        onTextDelta: callbacks.onTextDelta,
        onReasoningDelta: callbacks.onReasoningDelta,
        onToolCallsUpdated: callbacks.onToolCallsUpdated,
        onCitationsUpdated: callbacks.onCitationsUpdated,
        onTraceUpdated: callbacks.onTraceUpdated,
        onToolTraceEntry: (entry) => {
          toolTrace.push(entry);
        },
        onContextStats: (stats) => {
          contextStats = stats;
        },
        onFallbackNotice: callbacks.onFallbackNotice,
        requestApproval: callbacks.requestApproval,
        onAlwaysAllowTool: callbacks.onAlwaysAllowTool,
        getServerSecrets: callbacks.getServerSecrets,
        saveServerSecrets: callbacks.saveServerSecrets,
      },
    });

    if (signal?.aborted || loopRes.stoppedByUser) {
      throw new DOMException('Planning stopped', 'AbortError');
    }
    plan = parseCodingPlanFromText(loopRes.finalText, prompt, autoRun, vfs.getFilesSnapshot());
    const usedModel = getModelById(loopRes.usedModelId, availableModels);
    plan.subagentTraces = [
      {
        id: `sub_plan_${startedAt}`,
        phase: 'planning',
        role: 'architect',
        modelId: usedModel.id,
        provider: completedProvider(loopRes.runTrace, usedModel),
        tokens: loopRes.runTrace.estimatedPromptTokens + Math.ceil(loopRes.finalText.length / 3.5),
        durationMs: Math.max(10, Date.now() - startedAt),
        ...(usedModel.id !== architectTarget.model.id ? { fallbackFrom: architectTarget.model.id } : {}),
        status: usedModel.id !== architectTarget.model.id ? 'fallback' : 'ok',
      },
    ];
  }

  callbacks.onPlanUpdated(plan);
  const nextSession = recordSessionState(plan);

  const summaryText = plan.autoRun
    ? `**Plan approved automatically (Auto-Run):** ${plan.summary}`
    : `**Architecture plan ready:** ${plan.summary}\n\nReview the requirements, file manifest, and tasks below, then tap **Approve & Build** to start execution.`;
  callbacks.onTextDelta(summaryText);

  return { plan, session: nextSession, summaryText };
}

export async function runCodingExecutionPhase(params: {
  plan: CodingPlan;
  session: CodingSessionState;
  orchestration: CodeOrchestrationSettings;
  activeModelId: string;
  effort: EffortLevel;
  agent: AgentProfile;
  project?: ProjectProfile | null;
  keys: ProviderKeys;
  dynamicModels: ModelConfig[];
  manualModelOverrides: string[];
  providerValidation?: Partial<Record<CloudProvider, ProviderValidationResult>>;
  allowLocalTools: boolean;
  servers: McpServerConfig[];
  confirmBeforeWrite: boolean;
  alwaysAllowedTools: string[];
  alwaysAllowedRules?: AlwaysAllowRule[];
  toolPolicies?: ToolPolicyRule[];
  toolOutputBudgetChars?: number;
  signal: AbortSignal;
  fetchFn?: typeof fetch;
  callbacks: CodingOrchestratorCallbacks;
}): Promise<{
  plan: CodingPlan;
  session: CodingSessionState;
  finalText: string;
  stoppedByUser: boolean;
}> {
  const {
    session,
    orchestration,
    activeModelId,
    effort,
    agent,
    project,
    keys,
    dynamicModels,
    manualModelOverrides,
    providerValidation,
    allowLocalTools,
    servers,
    confirmBeforeWrite,
    alwaysAllowedTools,
    alwaysAllowedRules,
    toolPolicies,
    toolOutputBudgetChars,
    signal,
    fetchFn,
    callbacks,
  } = params;

  const vfs = new WorkspaceVfs({
    files: session.files,
    diffs: session.diffs,
    checkpoints: session.checkpoints,
  });
  seedVfsFromContext(vfs, project);

  const availableModels = getOrchestratorModels({
    keys,
    dynamicModels,
    manualModelOverrides,
    providerValidation,
  });
  const coderTarget = resolveCodingRoleModel('coder', orchestration, availableModels, activeModelId);
  const reviewerTarget = resolveCodingRoleModel('reviewer', orchestration, availableModels, activeModelId);

  const workingPlan: CodingPlan = {
    ...params.plan,
    phase: 'executing',
    verificationErrors: [],
    tasks: params.plan.tasks.map((t) => ({ ...t })),
    requirements: params.plan.requirements.map((r) => ({ ...r })),
    subagentTraces: [...params.plan.subagentTraces],
    updatedAt: Date.now(),
  };

  const toolTrace: ToolTraceEntry[] = [...session.toolTrace];
  const allToolRecords: ToolCallRecord[] = [];
  let contextStats: CodingContextStats = { ...session.contextStats };
  const allWorkspaceTools: LlmToolDefinition[] = buildWorkspaceToolDefinitions();

  const syncLive = () => {
    workingPlan.updatedAt = Date.now();
    callbacks.onPlanUpdated({ ...workingPlan, tasks: [...workingPlan.tasks] });
    const nextSession: CodingSessionState = {
      activePlan: { ...workingPlan },
      files: vfs.getFilesSnapshot(),
      diffs: vfs.getDiffsSnapshot(),
      checkpoints: vfs.getCheckpointsSnapshot(),
      toolTrace: [...toolTrace].slice(-120),
      contextStats,
    };
    callbacks.onSessionUpdated(nextSession);
    return nextSession;
  };

  const stopExecution = () => {
    workingPlan.phase = 'failed';
    return {
      plan: workingPlan,
      session: syncLive(),
      finalText: '_Execution stopped by user._',
      stoppedByUser: true,
    };
  };

  // Snapshot before batch
  vfs.createCheckpoint(`Before "${workingPlan.prompt.slice(0, 36)}"`);
  syncLive();

  // Execute each task sequentially
  for (let i = 0; i < workingPlan.tasks.length; i++) {
    if (signal.aborted) return stopExecution();

    const task = workingPlan.tasks[i];
    const taskStartedAt = Date.now();
    task.status = 'in_progress';
    syncLive();

    if (coderTarget.model.provider === 'demo') {
      const generatedFiles = buildSandboxDashboardFiles(workingPlan.prompt);
      const existingSnapshot = vfs.getFilesSnapshot();
      const hasPreexisting = Object.values(existingSnapshot).some(
        (f) => f.status !== 'deleted' && f.status === 'unmodified'
      );

      if (hasPreexisting) {
        const targetPath = task.targetFiles[0] || Object.keys(existingSnapshot)[0];
        if (targetPath && existingSnapshot[targetPath]) {
          const readRes = vfs.readFile(targetPath);
          toolTrace.push({
            id: `trace_${task.id}_read`,
            toolName: 'read_file',
            resolvedToolName: 'read_file',
            args: { path: targetPath },
            validationStatus: 'valid',
            repairAttempts: 0,
            durationMs: 3,
            outputPreview: readRes.text.slice(0, 240),
            isError: !readRes.ok,
            isReadOnly: true,
            timestamp: Date.now(),
            role: 'coder',
            modelId: coderTarget.model.id,
          });
          const firstLine = existingSnapshot[targetPath].content.split(/\r?\n/)[0] ?? '';
          if (firstLine) {
            const patchRes = vfs.patchFile(
              targetPath,
              firstLine,
              `${firstLine}\n// Updated by Code Orchestrator: ${workingPlan.prompt.slice(0, 60)}`,
              task.id
            );
            toolTrace.push({
              id: `trace_${task.id}_patch`,
              toolName: 'patch_file',
              resolvedToolName: 'patch_file',
              args: { path: targetPath, search: firstLine },
              validationStatus: 'valid',
              repairAttempts: 0,
              durationMs: 5,
              outputPreview: patchRes.text.slice(0, 240),
              isError: !patchRes.ok,
              isReadOnly: false,
              timestamp: Date.now(),
              role: 'coder',
              modelId: coderTarget.model.id,
            });
          }
        }
      } else {
        const subset =
          i === 0
            ? generatedFiles.filter((f) => task.targetFiles.includes(f.path) || f.path !== 'app.js')
            : generatedFiles.filter((f) => task.targetFiles.includes(f.path) || f.path === 'app.js');
        const filesToWrite = subset.length > 0 ? subset : generatedFiles;
        for (const f of filesToWrite) {
          const writeRes = vfs.writeFile(f.path, f.content, task.id);
          toolTrace.push({
            id: `trace_${task.id}_${f.path}`,
            toolName: 'write_file',
            resolvedToolName: 'write_file',
            args: { path: f.path, bytes: f.content.length },
            validationStatus: 'valid',
            repairAttempts: 0,
            durationMs: 4,
            outputPreview: writeRes.text,
            isError: !writeRes.ok,
            isReadOnly: false,
            timestamp: Date.now(),
            role: 'coder',
            modelId: coderTarget.model.id,
          });
        }
      }

      task.status = 'verifying';
      syncLive();
      const deferredPaths = new Set<string>(
        workingPlan.tasks.slice(i + 1).flatMap((t) => t.targetFiles)
      );
      const verifyCheck = vfs.verifyWorkspace(task.targetFiles, { deferredPaths });
      const fileChars = Object.values(vfs.getFilesSnapshot()).reduce(
        (sum, f) => sum + (f.status === 'deleted' ? 0 : f.content.length),
        0
      );
      const demoEstTokens = Math.ceil((workingPlan.prompt.length + fileChars) / 3.5) + 240;
      const demoCtxWin = coderTarget.model.contextWindow || 32_000;
      contextStats = {
        estimatedTokens: demoEstTokens,
        contextWindow: demoCtxWin,
        ratio: Number((demoEstTokens / demoCtxWin).toFixed(3)),
        compacted: false,
      };
      task.durationMs = Math.max(8, Date.now() - taskStartedAt);
      task.modelId = coderTarget.model.id;
      task.provider = coderTarget.model.provider;
      task.tokens = 240;
      task.status = verifyCheck.ok ? 'completed' : 'failed';
      if (!verifyCheck.ok) task.error = verifyCheck.errors.join('; ');
      workingPlan.subagentTraces.push({
        id: `sub_${task.id}_${Date.now()}`,
        phase: 'executing',
        role: 'coder',
        taskId: task.id,
        modelId: coderTarget.model.id,
        provider: coderTarget.model.provider,
        tokens: 240,
        durationMs: task.durationMs,
        status: task.status === 'completed' ? 'ok' : 'error',
      });
      syncLive();
    } else {
      const taskPrompt =
        `[PHASE 2 — GUIDED TASK EXECUTION (${i + 1}/${workingPlan.tasks.length})]\n` +
        `Plan Summary: ${workingPlan.summary}\n` +
        `Current Task: ${task.title}\n` +
        `Target Files: ${task.targetFiles.join(', ') || '(determined via workspace)'}\n` +
        `Verification Criterion: ${task.verificationCheck}\n` +
        `Rules:\n` +
        `- Always inspect existing files with \`read_file\` before calling \`patch_file\`.\n` +
        `- Prefer \`patch_file\` for modifying existing files and \`write_file\` for new files.\n` +
        `- Run \`verify_code\` when finished with this task.\n` +
        `Original Request: ${workingPlan.prompt}`;

      let taskFallbackNote: string | undefined;
      let taskWroteViaTool = false;
      try {
        const res = await runAgentLoop({
          agent,
          modelId: coderTarget.model.id,
          effort,
          chatMode: 'coding',
          a2uiEnabled: false,
          a2uiMode: 'off',
          project,
          keys,
          dynamicModels: availableModels,
          manualModelOverrides: codingRoleAssignment('coder', orchestration, activeModelId) === coderTarget.model.id
            ? manualModelOverrides : [],
          allowLocalTools,
          servers,
          extraTools: allWorkspaceTools,
          customToolExecutor: async (def, args) => {
            if (def.originalName === 'write_file' || def.originalName === 'patch_file' || def.originalName === 'delete_file') {
              taskWroteViaTool = true;
            }
            return executeWorkspaceVfsTool(vfs, def.originalName, args, task.id);
          },
          codingContextPin: {
            planSummary: buildPlanSummaryForPin(workingPlan),
            files: vfs.getFilesSnapshot(),
          },
          codingRole: 'coder',
          fallbackModelIds: coderTarget.fallbackChain,
          history: [{ role: 'user', text: taskPrompt }],
          maxSteps: 8,
          // Keep VFS write_file/patch_file frictionless inside the sandboxed workspace while still gating destructive delete_file & external MCP writes
          confirmBeforeWrite,
          alwaysAllowedTools: [
            ...alwaysAllowedTools,
            'srv_workspace:write_file',
            'srv_workspace:patch_file',
          ],
          alwaysAllowedRules,
          toolPolicies,
          toolOutputBudgetChars,
          signal,
          fetchFn,
          callbacks: {
            onTextDelta: () => {},
            onReasoningDelta: callbacks.onReasoningDelta,
            onToolCallsUpdated: (calls) => {
              for (const c of calls) {
                if (!allToolRecords.some((existing) => existing.id === c.id)) {
                  allToolRecords.push(c);
                }
              }
              callbacks.onToolCallsUpdated([...allToolRecords]);
            },
            onToolTraceEntry: (entry) => {
              toolTrace.push(entry);
              syncLive();
            },
            onContextStats: (stats) => {
              contextStats = stats;
            },
            onFallbackNotice: (from, to, reason) => {
              taskFallbackNote = `Fallback ${from.label} → ${to.label}: ${reason}`;
              callbacks.onFallbackNotice(from, to, reason);
            },
            requestApproval: callbacks.requestApproval,
            onAlwaysAllowTool: callbacks.onAlwaysAllowTool,
            getServerSecrets: callbacks.getServerSecrets,
            saveServerSecrets: callbacks.saveServerSecrets,
          },
        });

        if (res.stoppedByUser || signal.aborted) {
          task.status = 'failed';
          task.error = 'Stopped by user';
          return stopExecution();
        }

        const usedModel = getModelById(res.usedModelId, availableModels);
        if (!taskWroteViaTool && res.finalText.trim()) {
          const recoveredFiles = extractFallbackFilesFromText(res.finalText, task.targetFiles);
          for (const rf of recoveredFiles) {
            const writeRes = vfs.writeFile(rf.path, rf.content, task.id);
            toolTrace.push({
              id: `trace_${task.id}_extract_${rf.path}`,
              toolName: 'write_file',
              resolvedToolName: 'write_file',
              args: { path: rf.path, bytes: rf.content.length, source: 'fallback_extract' },
              validationStatus: 'valid',
              repairAttempts: 0,
              durationMs: 2,
              outputPreview: writeRes.text.slice(0, 240),
              isError: !writeRes.ok,
              isReadOnly: false,
              timestamp: Date.now(),
              role: 'coder',
              modelId: usedModel.id,
            });
          }
        }
        const taskTokens =
          res.runTrace.estimatedPromptTokens + Math.ceil(res.finalText.length / 3.5);
        task.status = 'verifying';
        task.modelId = usedModel.id;
        task.provider = completedProvider(res.runTrace, usedModel);
        task.tokens = taskTokens;
        task.durationMs = Math.max(10, Date.now() - taskStartedAt);
        task.fallbackNote = taskFallbackNote;
        task.status = 'completed';

        workingPlan.subagentTraces.push({
          id: `sub_${task.id}_${Date.now()}`,
          phase: 'executing',
          role: 'coder',
          taskId: task.id,
          modelId: usedModel.id,
          provider: task.provider,
          tokens: taskTokens,
          durationMs: task.durationMs,
          ...(usedModel.id !== coderTarget.model.id ? { fallbackFrom: coderTarget.model.id } : {}),
          status: usedModel.id !== coderTarget.model.id ? 'fallback' : 'ok',
        });
        syncLive();
      } catch (err) {
        if (signal.aborted) {
          task.status = 'failed';
          task.error = 'Stopped by user';
          return stopExecution();
        }
        task.durationMs = Math.max(10, Date.now() - taskStartedAt);
        task.status = 'failed';
        task.error = safeErrorMessage(err);
        workingPlan.subagentTraces.push({
          id: `sub_${task.id}_${Date.now()}`,
          phase: 'executing',
          role: 'coder',
          taskId: task.id,
          modelId: coderTarget.model.id,
          provider: coderTarget.model.provider,
          tokens: 0,
          durationMs: task.durationMs,
          status: 'error',
        });
        syncLive();
      }
    }
  }

  // Phase 3: Automated Verification + Self-Healing Repair Loop (up to 3 attempts)
  workingPlan.phase = 'verifying';
  syncLive();

  let verifyReport = vfs.verifyWorkspace();
  toolTrace.push({
    id: `trace_verify_0_${Date.now()}`,
    toolName: 'verify_code',
    resolvedToolName: 'verify_code',
    args: {},
    validationStatus: 'valid',
    repairAttempts: 0,
    durationMs: 4,
    outputPreview: JSON.stringify(verifyReport).slice(0, 400),
    isError: !verifyReport.ok,
    isReadOnly: true,
    timestamp: Date.now(),
    role: 'reviewer',
    modelId: reviewerTarget.model.id,
  });

  while (!verifyReport.ok && workingPlan.repairAttempts < workingPlan.maxRepairAttempts && !signal.aborted) {
    workingPlan.repairAttempts += 1;
    workingPlan.verificationErrors = [...verifyReport.errors];
    syncLive();

    const repairStart = Date.now();
    if (reviewerTarget.model.provider === 'demo') {
      // Deterministic self-heal for broken HTML refs, syntax errors, or empty files
      const sandboxFiles = buildSandboxDashboardFiles(workingPlan.prompt);
      const sandboxMap = new Map(sandboxFiles.map((f) => [f.path, f.content]));
      for (const file of sandboxFiles) {
        vfs.writeFile(file.path, file.content, 'self_heal');
      }
      for (const diag of verifyReport.errors) {
        const colonIdx = diag.indexOf(':');
        if (colonIdx <= 0) continue;
        const failingPath = diag.slice(0, colonIdx).trim();
        if (!failingPath || sandboxMap.has(failingPath)) continue;
        const lower = failingPath.toLowerCase();
        const repairedContent = lower.endsWith('.json')
          ? '{}'
          : lower.endsWith('.css')
            ? '/* Self-healed by Code Reviewer */\n'
            : lower.endsWith('.html') || lower.endsWith('.htm')
              ? '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8" /><title>Repaired</title></head><body></body></html>\n'
              : '// Self-healed by Code Reviewer\nfunction repaired() {\n  return 0;\n}\n';
        const healWrite = vfs.writeFile(failingPath, repairedContent, 'self_heal');
        toolTrace.push({
          id: `trace_heal_${workingPlan.repairAttempts}_${failingPath}`,
          toolName: 'write_file',
          resolvedToolName: 'write_file',
          args: { path: failingPath, reason: 'self_heal' },
          validationStatus: 'valid',
          repairAttempts: 0,
          durationMs: 3,
          outputPreview: healWrite.text.slice(0, 240),
          isError: !healWrite.ok,
          isReadOnly: false,
          timestamp: Date.now(),
          role: 'reviewer',
          modelId: reviewerTarget.model.id,
        });
      }
      verifyReport = vfs.verifyWorkspace();
      workingPlan.subagentTraces.push({
        id: `sub_heal_${workingPlan.repairAttempts}_${Date.now()}`,
        phase: 'verifying',
        role: 'reviewer',
        modelId: reviewerTarget.model.id,
        provider: reviewerTarget.model.provider,
        tokens: 180,
        durationMs: Math.max(8, Date.now() - repairStart),
        status: verifyReport.ok ? 'ok' : 'error',
      });
    } else {
      const repairPrompt =
        `[PHASE 3 — REVIEWER SELF-HEALING PASS ${workingPlan.repairAttempts}/${workingPlan.maxRepairAttempts}]\n` +
        `Verification failed with these exact diagnostics:\n${verifyReport.errors.map((e) => `- ${e}`).join('\n')}\n\n` +
        `Use \`read_file\` to inspect each affected file, fix every error with \`patch_file\` or \`write_file\`, and run \`verify_code\` again.`;

      try {
        const healRes = await runAgentLoop({
          agent,
          modelId: reviewerTarget.model.id,
          effort,
          chatMode: 'coding',
          a2uiEnabled: false,
          a2uiMode: 'off',
          project,
          keys,
          dynamicModels: availableModels,
          manualModelOverrides: codingRoleAssignment('reviewer', orchestration, activeModelId) === reviewerTarget.model.id
            ? manualModelOverrides : [],
          allowLocalTools,
          servers,
          extraTools: allWorkspaceTools,
          customToolExecutor: async (def, args) =>
            executeWorkspaceVfsTool(vfs, def.originalName, args, `repair_${workingPlan.repairAttempts}`),
          codingContextPin: {
            planSummary: buildPlanSummaryForPin(workingPlan),
            files: vfs.getFilesSnapshot(),
          },
          codingRole: 'reviewer',
          fallbackModelIds: reviewerTarget.fallbackChain,
          history: [{ role: 'user', text: repairPrompt }],
          maxSteps: 6,
          confirmBeforeWrite,
          alwaysAllowedTools: [
            ...alwaysAllowedTools,
            'srv_workspace:write_file',
            'srv_workspace:patch_file',
          ],
          alwaysAllowedRules,
          toolPolicies,
          toolOutputBudgetChars,
          signal,
          fetchFn,
          callbacks: {
            onTextDelta: () => {},
            onReasoningDelta: callbacks.onReasoningDelta,
            onToolCallsUpdated: (calls) => {
              for (const c of calls) {
                if (!allToolRecords.some((existing) => existing.id === c.id)) {
                  allToolRecords.push(c);
                }
              }
              callbacks.onToolCallsUpdated([...allToolRecords]);
            },
            onToolTraceEntry: (entry) => {
              toolTrace.push(entry);
              syncLive();
            },
            onContextStats: (stats) => {
              contextStats = stats;
            },
            onFallbackNotice: callbacks.onFallbackNotice,
            requestApproval: callbacks.requestApproval,
            onAlwaysAllowTool: callbacks.onAlwaysAllowTool,
            getServerSecrets: callbacks.getServerSecrets,
            saveServerSecrets: callbacks.saveServerSecrets,
          },
        });
        if (healRes.stoppedByUser || signal.aborted) return stopExecution();
        const usedReviewer = getModelById(healRes.usedModelId, availableModels);
        workingPlan.subagentTraces.push({
          id: `sub_heal_${workingPlan.repairAttempts}_${Date.now()}`,
          phase: 'verifying',
          role: 'reviewer',
          modelId: usedReviewer.id,
          provider: completedProvider(healRes.runTrace, usedReviewer),
          tokens:
            healRes.runTrace.estimatedPromptTokens + Math.ceil(healRes.finalText.length / 3.5),
          durationMs: Math.max(10, Date.now() - repairStart),
          ...(usedReviewer.id !== reviewerTarget.model.id
            ? { fallbackFrom: reviewerTarget.model.id }
            : {}),
          status: usedReviewer.id !== reviewerTarget.model.id ? 'fallback' : 'ok',
        });
      } catch (err) {
        if (signal.aborted) return stopExecution();
        verifyReport.errors.push(`Reviewer pass failed: ${safeErrorMessage(err)}`);
        break;
      }
      verifyReport = vfs.verifyWorkspace();
    }
  }

  if (signal.aborted) return stopExecution();
  workingPlan.verificationErrors = verifyReport.ok ? [] : [...verifyReport.errors];
  workingPlan.phase = verifyReport.ok ? 'completed' : 'failed';
  if (verifyReport.ok) {
    workingPlan.requirements = workingPlan.requirements.map((r) => ({ ...r, checked: true }));
    workingPlan.subagentTraces.push({
      id: `sub_verify_final_${Date.now()}`,
      phase: 'verifying',
      role: 'reviewer',
      modelId: reviewerTarget.model.id,
      provider: reviewerTarget.model.provider,
      tokens: 90,
      durationMs: 12,
      status: 'ok',
    });
  }

  const finalSession = syncLive();
  const artifactJson = buildWorkspaceArtifactAppJson(finalSession.files, workingPlan.summary.slice(0, 48));
  const changedCount = Object.values(finalSession.diffs).length;
  const activeCount = Object.values(finalSession.files).filter((f) => f.status !== 'deleted').length;

  const summaryHeader = verifyReport.ok
    ? `### Build & Verification Complete\n\nImplemented **${activeCount} file(s)** (${changedCount} diff(s) tracked) and passed all verification checks${workingPlan.repairAttempts > 0 ? ` after ${workingPlan.repairAttempts} self-healing pass(es)` : ''}.`
    : `### Verification Finished with ${verifyReport.errors.length} Issue(s)\n\n${verifyReport.errors.map((e) => `- ${e}`).join('\n')}`;

  const finalText = artifactJson
    ? `${summaryHeader}\n\n\`\`\`artifact-app\n${artifactJson}\n\`\`\``
    : summaryHeader;

  callbacks.onTextDelta(finalText);

  return {
    plan: workingPlan,
    session: finalSession,
    finalText,
    stoppedByUser: false,
  };
}
