import type {
  CodeCheckpoint,
  CodingPlanFileAction,
  ToolHarnessValidationStatus,
  WorkspaceDiffEntry,
  WorkspaceFileEntry,
} from '../../types';
import { computeLineDiff } from '../../utils/proFeatures';
import type { LlmToolCall, LlmToolDefinition } from './types';

export const WORKSPACE_VIRTUAL_SERVER_ID = 'srv_workspace';
export const WORKSPACE_VIRTUAL_SERVER_NAME = 'Code Workspace';

const SENSITIVE_SEGMENT_PATTERNS: RegExp[] = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /credentials/i,
  /secret/i,
  /^id_rsa/i,
  /^id_ed25519/i,
];

export interface SafePathResult {
  ok: boolean;
  path: string;
  reason?: string;
}

export function normalizeSafeWorkspacePath(rawPath: string): SafePathResult {
  const trimmed = String(rawPath ?? '').trim().replace(/\\/g, '/');
  if (!trimmed) {
    return { ok: false, path: '', reason: 'File path cannot be empty.' };
  }
  if (trimmed.includes('\0')) {
    return { ok: false, path: '', reason: 'File path contains invalid null characters.' };
  }
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
    return {
      ok: false,
      path: '',
      reason: `Absolute OS paths are blocked ("${trimmed}"). Use workspace-relative paths like "src/app.ts" or "index.html".`,
    };
  }

  const stripped = trimmed.replace(/^(?:\.\/)+/, '').replace(/\/+/g, '/');
  if (!stripped || stripped === '.' || stripped === '/') {
    return { ok: false, path: '', reason: 'File path must point to a file inside the workspace.' };
  }

  const segments = stripped.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '..' || seg === '.') {
      return {
        ok: false,
        path: '',
        reason: `Path traversal segment "${seg}" is blocked.`,
      };
    }
    for (const pattern of SENSITIVE_SEGMENT_PATTERNS) {
      if (pattern.test(seg)) {
        return {
          ok: false,
          path: '',
          reason: `Access to sensitive file "${seg}" is blocked by workspace guardrails.`,
        };
      }
    }
  }

  if (segments.join('/').toLowerCase() === '.git/config') {
    return {
      ok: false,
      path: '',
      reason: 'Access to ".git/config" is blocked by workspace guardrails.',
    };
  }

  return { ok: true, path: segments.join('/') };
}

export function inferWorkspaceLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.svg')) return 'svg';
  return 'text';
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[n];
}

function normalizeToolIdentifier(name: string): string {
  return name.trim().toLowerCase().replace(/[-\s]+/g, '_');
}

export function resolveToolDefinition(
  rawName: string,
  tools: LlmToolDefinition[]
): { def: LlmToolDefinition | null; repairedFrom?: string } {
  const trimmed = rawName.trim();
  if (!trimmed || tools.length === 0) return { def: null };

  // 1. Exact qualifiedName
  const exactQualified = tools.find((t) => t.qualifiedName === trimmed);
  if (exactQualified) return { def: exactQualified };

  // 2. Exact originalName (only if unique or unambiguously matching workspace)
  const exactOriginals = tools.filter((t) => t.originalName === trimmed);
  if (exactOriginals.length === 1) {
    return { def: exactOriginals[0], repairedFrom: trimmed };
  }

  // 3. Normalized identifier match (case-insensitive / hyphen->underscore)
  const norm = normalizeToolIdentifier(trimmed);
  const normShort = norm.includes('__') ? norm.split('__').slice(1).join('__') : norm;
  const normMatches = tools.filter(
    (t) =>
      normalizeToolIdentifier(t.qualifiedName) === norm ||
      normalizeToolIdentifier(t.originalName) === norm ||
      normalizeToolIdentifier(t.originalName) === normShort
  );
  if (normMatches.length === 1) {
    return { def: normMatches[0], repairedFrom: trimmed };
  }

  // 4. Levenshtein <= 2 fuzzy match against qualifiedName or originalName
  let bestDef: LlmToolDefinition | null = null;
  let bestDist = Infinity;
  let tie = false;

  for (const t of tools) {
    const qDist = levenshtein(norm, normalizeToolIdentifier(t.qualifiedName));
    const oDist = levenshtein(normShort, normalizeToolIdentifier(t.originalName));
    const dist = Math.min(qDist, oDist);
    if (dist <= 2) {
      if (dist < bestDist) {
        bestDist = dist;
        bestDef = t;
        tie = false;
      } else if (dist === bestDist) {
        tie = true;
      }
    }
  }

  if (bestDef && !tie) {
    return { def: bestDef, repairedFrom: trimmed };
  }
  return { def: null };
}

function coerceValueToSchemaType(
  value: unknown,
  propSchema: Record<string, unknown>
): { ok: boolean; value: unknown; coerced: boolean; error?: string } {
  const expectedType =
    typeof propSchema.type === 'string'
      ? propSchema.type
      : Array.isArray(propSchema.type)
        ? propSchema.type.find((t) => typeof t === 'string' && t !== 'null')
        : undefined;

  let next = value;
  let coerced = false;

  if (expectedType === 'boolean' && typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') {
      next = true;
      coerced = true;
    } else if (lower === 'false') {
      next = false;
      coerced = true;
    }
  } else if ((expectedType === 'number' || expectedType === 'integer') && typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        next = expectedType === 'integer' ? Math.trunc(parsed) : parsed;
        coerced = true;
      }
    }
  } else if (expectedType === 'array' && typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          next = parsed;
          coerced = true;
        }
      } catch {
        // leave uncoerced so validation catches it cleanly
      }
    }
  } else if (expectedType === 'object' && typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          next = parsed;
          coerced = true;
        }
      } catch {
        // leave uncoerced
      }
    }
  }

  if (expectedType === 'string' && typeof next !== 'string') {
    return { ok: false, value: next, coerced, error: `expected string, received ${typeof next}` };
  }
  if (expectedType === 'boolean' && typeof next !== 'boolean') {
    return { ok: false, value: next, coerced, error: `expected boolean, received ${typeof next}` };
  }
  if (expectedType === 'number' && (typeof next !== 'number' || !Number.isFinite(next))) {
    return { ok: false, value: next, coerced, error: `expected finite number, received ${typeof next}` };
  }
  if (expectedType === 'integer' && (typeof next !== 'number' || !Number.isInteger(next))) {
    return { ok: false, value: next, coerced, error: `expected integer, received ${typeof next}` };
  }
  if (expectedType === 'array' && !Array.isArray(next)) {
    return { ok: false, value: next, coerced, error: `expected array, received ${typeof next}` };
  }
  if (expectedType === 'object' && (!next || typeof next !== 'object' || Array.isArray(next))) {
    return { ok: false, value: next, coerced, error: `expected object, received ${typeof next}` };
  }

  if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
    const allowed = propSchema.enum;
    if (!allowed.includes(next)) {
      return {
        ok: false,
        value: next,
        coerced,
        error: `value ${JSON.stringify(next)} is not in enum [${allowed.map((v) => JSON.stringify(v)).join(', ')}]`,
      };
    }
  }

  return { ok: true, value: next, coerced };
}

export interface ToolValidationResult {
  ok: boolean;
  def: LlmToolDefinition | null;
  resolvedToolName: string;
  args: Record<string, unknown>;
  validationStatus: ToolHarnessValidationStatus;
  structuredErrorJson?: string;
}

export function validateAndNormalizeToolCall(
  call: LlmToolCall,
  tools: LlmToolDefinition[]
): ToolValidationResult {
  const { def, repairedFrom } = resolveToolDefinition(call.name, tools);
  if (!def) {
    return {
      ok: false,
      def: null,
      resolvedToolName: call.name,
      args: call.parsedArguments ?? {},
      validationStatus: 'rejected',
      structuredErrorJson: JSON.stringify({
        tool_error: {
          code: 'UNKNOWN_TOOL',
          requestedTool: call.name,
          message: `Tool "${call.name}" does not exist or is disabled.`,
          availableTools: tools.map((t) => t.qualifiedName),
        },
      }),
    };
  }

  let rawArgs: Record<string, unknown> | undefined = call.parsedArguments;
  if (call.parseError) {
    // Attempt single safe recovery for trailing commas in JSON object
    const sanitized = (call.rawArguments ?? '').trim().replace(/,\s*([}\]])/g, '$1');
    let recovered = false;
    if (sanitized.startsWith('{') && sanitized.endsWith('}')) {
      try {
        const parsed = JSON.parse(sanitized);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          rawArgs = parsed as Record<string, unknown>;
          recovered = true;
        }
      } catch {
        recovered = false;
      }
    }
    if (!recovered) {
      return {
        ok: false,
        def,
        resolvedToolName: def.qualifiedName,
        args: {},
        validationStatus: 'rejected',
        structuredErrorJson: JSON.stringify({
          tool_error: {
            code: 'INVALID_JSON_ARGUMENTS',
            tool: def.qualifiedName,
            message: `Arguments for "${def.qualifiedName}" were not valid JSON: ${call.parseError}`,
            expectedSchema: def.parameters,
          },
        }),
      };
    }
  }

  const inputArgs =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? { ...rawArgs } : {};
  const schema = def.parameters ?? {};
  const props =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const requiredKeys = Array.isArray(schema.required)
    ? schema.required.filter((k): k is string => typeof k === 'string' && k !== '_placeholder')
    : [];

  const missing = requiredKeys.filter(
    (k) => inputArgs[k] === undefined || inputArgs[k] === null || (props[k]?.type === 'string' && inputArgs[k] === '')
  );
  if (missing.length > 0) {
    return {
      ok: false,
      def,
      resolvedToolName: def.qualifiedName,
      args: inputArgs,
      validationStatus: 'rejected',
      structuredErrorJson: JSON.stringify({
        tool_error: {
          code: 'MISSING_REQUIRED_PARAMETERS',
          tool: def.qualifiedName,
          missingParameters: missing,
          message: `Tool "${def.qualifiedName}" requires: ${missing.join(', ')}.`,
          expectedProperties: props,
        },
      }),
    };
  }

  let anyCoerced = Boolean(call.parseError);
  const schemaErrors: string[] = [];

  for (const [key, val] of Object.entries(inputArgs)) {
    if (key === '_placeholder') {
      delete inputArgs[key];
      continue;
    }
    const propSchema = props[key];
    if (!propSchema) continue;
    if (val === undefined || val === null) continue;
    const res = coerceValueToSchemaType(val, propSchema);
    if (!res.ok) {
      schemaErrors.push(`Parameter "${key}": ${res.error}`);
    } else {
      if (res.coerced) anyCoerced = true;
      inputArgs[key] = res.value;
    }
  }

  if (schemaErrors.length > 0) {
    return {
      ok: false,
      def,
      resolvedToolName: def.qualifiedName,
      args: inputArgs,
      validationStatus: 'rejected',
      structuredErrorJson: JSON.stringify({
        tool_error: {
          code: 'SCHEMA_VALIDATION_ERROR',
          tool: def.qualifiedName,
          errors: schemaErrors,
          expectedProperties: props,
        },
      }),
    };
  }

  const validationStatus: ToolHarnessValidationStatus = repairedFrom
    ? 'repaired'
    : anyCoerced
      ? 'coerced'
      : 'valid';

  return {
    ok: true,
    def,
    resolvedToolName: def.qualifiedName,
    args: inputArgs,
    validationStatus,
  };
}

export interface VfsOperationResult {
  ok: boolean;
  text: string;
  code?: string;
}

export interface WorkspaceVerificationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checkedFiles: string[];
}

export class WorkspaceVfs {
  private files: Record<string, WorkspaceFileEntry> = {};
  private diffs: Record<string, WorkspaceDiffEntry> = {};
  private checkpoints: CodeCheckpoint[] = [];
  private readFiles = new Set<string>();
  private baselineSnapshot: Record<string, string> = {};

  constructor(initial?: {
    files?: Record<string, WorkspaceFileEntry>;
    diffs?: Record<string, WorkspaceDiffEntry>;
    checkpoints?: CodeCheckpoint[];
    readFiles?: string[];
  }) {
    if (initial?.files) {
      for (const [path, entry] of Object.entries(initial.files)) {
        const safe = normalizeSafeWorkspacePath(path);
        if (!safe.ok) continue;
        this.files[safe.path] = { ...entry, path: safe.path };
        if (entry.status !== 'created' && entry.status !== 'deleted') {
          this.baselineSnapshot[safe.path] = entry.content;
        }
      }
    }
    if (initial?.diffs) {
      for (const [path, diff] of Object.entries(initial.diffs)) {
        const safe = normalizeSafeWorkspacePath(path);
        if (!safe.ok) continue;
        this.diffs[safe.path] = { ...diff, path: safe.path };
        if (diff.action !== 'create' && this.baselineSnapshot[safe.path] === undefined) {
          this.baselineSnapshot[safe.path] = diff.before;
        }
      }
    }
    if (initial?.checkpoints) {
      this.checkpoints = initial.checkpoints.map((cp) => ({
        ...cp,
        files: { ...cp.files },
      }));
    }
    if (initial?.readFiles) {
      for (const p of initial.readFiles) {
        const safe = normalizeSafeWorkspacePath(p);
        if (safe.ok) this.readFiles.add(safe.path);
      }
    }
  }

  seedFile(rawPath: string, content: string): boolean {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) return false;
    if (this.files[safe.path]) return false;
    this.files[safe.path] = {
      path: safe.path,
      content,
      language: inferWorkspaceLanguage(safe.path),
      status: 'unmodified',
      updatedAt: Date.now(),
    };
    this.baselineSnapshot[safe.path] = content;
    return true;
  }

  hasRead(rawPath: string): boolean {
    const safe = normalizeSafeWorkspacePath(rawPath);
    return safe.ok && this.readFiles.has(safe.path);
  }

  listFiles(dirPrefix?: string): VfsOperationResult {
    const normalizedPrefix = dirPrefix
      ? dirPrefix.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
      : '';

    const active = Object.values(this.files)
      .filter((f) => f.status !== 'deleted')
      .filter((f) => !normalizedPrefix || f.path.startsWith(`${normalizedPrefix}/`) || f.path === normalizedPrefix)
      .sort((a, b) => a.path.localeCompare(b.path));

    if (active.length === 0) {
      return {
        ok: true,
        text: JSON.stringify({ files: [], message: 'Workspace currently has no files.' }),
      };
    }

    return {
      ok: true,
      text: JSON.stringify({
        count: active.length,
        files: active.map((f) => ({
          path: f.path,
          language: f.language,
          status: f.status,
          bytes: f.content.length,
          lines: f.content.split(/\r?\n/).length,
        })),
      }),
    };
  }

  readFile(rawPath: string, startLine?: number, endLine?: number): VfsOperationResult {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) {
      return {
        ok: false,
        code: 'PATH_BLOCKED',
        text: JSON.stringify({ tool_error: { code: 'PATH_BLOCKED', message: safe.reason } }),
      };
    }

    const entry = this.files[safe.path];
    if (!entry || entry.status === 'deleted') {
      const available = Object.values(this.files)
        .filter((f) => f.status !== 'deleted')
        .map((f) => f.path);
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        text: JSON.stringify({
          tool_error: {
            code: 'FILE_NOT_FOUND',
            path: safe.path,
            message: `File "${safe.path}" does not exist in workspace.`,
            availableFiles: available,
          },
        }),
      };
    }

    this.readFiles.add(safe.path);
    const lines = entry.content.split(/\r?\n/);
    const from = Math.max(1, startLine ?? 1);
    const to = Math.min(lines.length, endLine ?? lines.length);
    const numbered = lines
      .slice(from - 1, to)
      .map((line, i) => `${from + i}: ${line}`)
      .join('\n');

    return {
      ok: true,
      text: `File: ${safe.path} (lines ${from}-${Math.max(from, to)} of ${lines.length})\n${numbered}`,
    };
  }

  searchCode(query: string, pathPrefix?: string): VfsOperationResult {
    const q = String(query ?? '').trim();
    if (!q) {
      return {
        ok: false,
        code: 'EMPTY_QUERY',
        text: JSON.stringify({ tool_error: { code: 'EMPTY_QUERY', message: 'search_code query cannot be empty.' } }),
      };
    }
    const lowerQ = q.toLowerCase();
    const normPrefix = pathPrefix
      ? pathPrefix.trim().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      : '';

    const matches: Array<{ path: string; line: number; text: string }> = [];
    const active = Object.values(this.files)
      .filter((f) => f.status !== 'deleted')
      .filter((f) => !normPrefix || f.path.startsWith(normPrefix))
      .sort((a, b) => a.path.localeCompare(b.path));

    for (const file of active) {
      const lines = file.content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQ)) {
          matches.push({ path: file.path, line: i + 1, text: lines[i].slice(0, 180) });
          if (matches.length >= 40) break;
        }
      }
      if (matches.length >= 40) break;
    }

    return {
      ok: true,
      text: JSON.stringify({ query: q, matchCount: matches.length, matches }),
    };
  }

  writeFile(rawPath: string, content: string, taskId?: string): VfsOperationResult {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) {
      return {
        ok: false,
        code: 'PATH_BLOCKED',
        text: JSON.stringify({ tool_error: { code: 'PATH_BLOCKED', message: safe.reason } }),
      };
    }

    const existing = this.files[safe.path];
    const existed = Boolean(existing && existing.status !== 'deleted');
    const before =
      this.baselineSnapshot[safe.path] !== undefined
        ? this.baselineSnapshot[safe.path]
        : existing?.content ?? '';
    const action: CodingPlanFileAction = existed ? 'modify' : 'create';
    const nextStatus = existing?.status === 'created' || !existed ? 'created' : 'modified';
    const now = Date.now();

    this.files[safe.path] = {
      path: safe.path,
      content,
      language: inferWorkspaceLanguage(safe.path),
      status: nextStatus,
      updatedAt: now,
    };
    this.readFiles.add(safe.path);

    if (before !== content || !existed) {
      this.diffs[safe.path] = {
        path: safe.path,
        before: action === 'create' ? '' : before,
        after: content,
        action: this.baselineSnapshot[safe.path] !== undefined ? 'modify' : 'create',
        status: 'pending',
        taskId,
        updatedAt: now,
      };
    }

    const diffLines = computeLineDiff(before, content, 200);
    const added = diffLines.filter((d) => d.kind === 'added').length;
    const removed = diffLines.filter((d) => d.kind === 'removed').length;

    return {
      ok: true,
      text: JSON.stringify({
        ok: true,
        action: nextStatus,
        path: safe.path,
        bytes: content.length,
        linesAdded: added,
        linesRemoved: removed,
      }),
    };
  }

  patchFile(
    rawPath: string,
    search: string,
    replace: string,
    taskId?: string
  ): VfsOperationResult {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) {
      return {
        ok: false,
        code: 'PATH_BLOCKED',
        text: JSON.stringify({ tool_error: { code: 'PATH_BLOCKED', message: safe.reason } }),
      };
    }

    const existing = this.files[safe.path];
    if (!existing || existing.status === 'deleted') {
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        text: JSON.stringify({
          tool_error: {
            code: 'FILE_NOT_FOUND',
            path: safe.path,
            message: `Cannot patch missing file "${safe.path}". Use write_file to create new files.`,
          },
        }),
      };
    }

    // Read-Before-Edit enforcement
    if (!this.readFiles.has(safe.path)) {
      return {
        ok: false,
        code: 'READ_BEFORE_EDIT_REQUIRED',
        text: JSON.stringify({
          tool_error: {
            code: 'READ_BEFORE_EDIT_REQUIRED',
            path: safe.path,
            message: `Read-Before-Edit rule: call read_file on "${safe.path}" before patching it.`,
          },
        }),
      };
    }

    if (!search) {
      return {
        ok: false,
        code: 'EMPTY_PATCH_SEARCH',
        text: JSON.stringify({
          tool_error: {
            code: 'EMPTY_PATCH_SEARCH',
            path: safe.path,
            message: 'patch_file "search" anchor cannot be empty.',
          },
        }),
      };
    }

    const source = existing.content;
    const matchLineNumbers: number[] = [];
    let searchFrom = 0;
    while (searchFrom <= source.length) {
      const idx = source.indexOf(search, searchFrom);
      if (idx === -1) break;
      const lineNum = source.slice(0, idx).split(/\r?\n/).length;
      matchLineNumbers.push(lineNum);
      searchFrom = idx + Math.max(1, search.length);
    }

    if (matchLineNumbers.length === 0) {
      const searchLines = search
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 3);
      const sourceLines = source.split(/\r?\n/);
      const hints: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < sourceLines.length; i++) {
        const trimmedLine = sourceLines[i].trim();
        if (!trimmedLine) continue;
        if (searchLines.some((needle) => trimmedLine.includes(needle) || needle.includes(trimmedLine))) {
          hints.push({ line: i + 1, text: sourceLines[i].slice(0, 140) });
          if (hints.length >= 8) break;
        }
      }
      return {
        ok: false,
        code: 'PATCH_NO_MATCH',
        text: JSON.stringify({
          tool_error: {
            code: 'PATCH_NO_MATCH',
            path: safe.path,
            message: `Search anchor not found in "${safe.path}". Call read_file to inspect exact lines.`,
            nearestLineHints: hints,
          },
        }),
      };
    }

    if (matchLineNumbers.length > 1) {
      return {
        ok: false,
        code: 'PATCH_AMBIGUOUS_MATCH',
        text: JSON.stringify({
          tool_error: {
            code: 'PATCH_AMBIGUOUS_MATCH',
            path: safe.path,
            message: `Search anchor matched ${matchLineNumbers.length} locations in "${safe.path}". Include more surrounding context so it matches uniquely.`,
            matchingLines: matchLineNumbers,
          },
        }),
      };
    }

    const matchIdx = source.indexOf(search);
    const updatedContent = source.slice(0, matchIdx) + replace + source.slice(matchIdx + search.length);
    const baseline =
      this.baselineSnapshot[safe.path] !== undefined ? this.baselineSnapshot[safe.path] : source;
    const now = Date.now();

    this.files[safe.path] = {
      ...existing,
      content: updatedContent,
      status: existing.status === 'created' ? 'created' : 'modified',
      updatedAt: now,
    };

    this.diffs[safe.path] = {
      path: safe.path,
      before: existing.status === 'created' ? '' : baseline,
      after: updatedContent,
      action: existing.status === 'created' ? 'create' : 'modify',
      status: 'pending',
      taskId,
      updatedAt: now,
    };

    return {
      ok: true,
      text: JSON.stringify({
        ok: true,
        path: safe.path,
        patchedAtLine: matchLineNumbers[0],
        bytes: updatedContent.length,
      }),
    };
  }

  deleteFile(rawPath: string, taskId?: string): VfsOperationResult {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) {
      return {
        ok: false,
        code: 'PATH_BLOCKED',
        text: JSON.stringify({ tool_error: { code: 'PATH_BLOCKED', message: safe.reason } }),
      };
    }

    const existing = this.files[safe.path];
    if (!existing || existing.status === 'deleted') {
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        text: JSON.stringify({
          tool_error: { code: 'FILE_NOT_FOUND', message: `File "${safe.path}" does not exist.` },
        }),
      };
    }

    const now = Date.now();
    const baseline = this.baselineSnapshot[safe.path] ?? existing.content;
    this.files[safe.path] = {
      ...existing,
      content: '',
      status: 'deleted',
      updatedAt: now,
    };

    this.diffs[safe.path] = {
      path: safe.path,
      before: baseline,
      after: '',
      action: 'delete',
      status: 'pending',
      taskId,
      updatedAt: now,
    };

    return {
      ok: true,
      text: JSON.stringify({ ok: true, action: 'deleted', path: safe.path }),
    };
  }

  verifyWorkspace(
    targetPaths?: string[],
    options?: { deferredPaths?: Set<string> }
  ): WorkspaceVerificationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const activeFiles = Object.values(this.files).filter((f) => f.status !== 'deleted');

    if (activeFiles.length === 0) {
      return {
        ok: false,
        errors: ['Workspace has no generated files to verify.'],
        warnings: [],
        checkedFiles: [],
      };
    }

    const normalizedTargets = targetPaths?.length
      ? new Set(
          targetPaths
            .map((p) => normalizeSafeWorkspacePath(p))
            .filter((r) => r.ok)
            .map((r) => r.path)
        )
      : null;

    const filesToCheck = normalizedTargets
      ? activeFiles.filter((f) => normalizedTargets.has(f.path))
      : activeFiles;
    const allPaths = new Set(activeFiles.map((f) => f.path));

    for (const file of filesToCheck) {
      if (file.language === 'json') {
        try {
          JSON.parse(file.content);
        } catch (err) {
          errors.push(
            `${file.path}: Invalid JSON — ${err instanceof Error ? err.message : 'parse error'}`
          );
        }
      } else if (file.language === 'javascript' || file.language === 'jsx') {
        if (/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(file.content)) {
          errors.push(
            `${file.path}: Avoid blocking alert()/confirm()/prompt() dialogs — they fail inside sandboxed previews.`
          );
        }
        // Strip ESM import/export wrappers only for syntax check via Function constructor
        const syntaxProbe = file.content
          .replace(/^\s*import\s+[\s\S]*?;\s*$/gm, '')
          .replace(/^\s*export\s+(?:default\s+)?/gm, '');
        if (!file.language.includes('jsx')) {
          try {
            new Function(syntaxProbe);
          } catch (err) {
            errors.push(
              `${file.path}: JavaScript syntax error — ${err instanceof Error ? err.message : 'syntax error'}`
            );
          }
        }
      } else if (file.language === 'html') {
        const assetRegex = /<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi;
        let match: RegExpExecArray | null;
        while ((match = assetRegex.exec(file.content)) !== null) {
          const ref = match[1].trim();
          if (
            !ref ||
            ref.startsWith('http://') ||
            ref.startsWith('https://') ||
            ref.startsWith('data:') ||
            ref.startsWith('blob:') ||
            ref.startsWith('#')
          ) {
            continue;
          }
          const cleanRef = ref.replace(/^\.\//, '').split('?')[0];
          if (!allPaths.has(cleanRef) && !options?.deferredPaths?.has(cleanRef)) {
            errors.push(`${file.path}: Referenced local asset "${ref}" does not exist in workspace.`);
          }
        }
        const openScripts = (file.content.match(/<script\b/gi) ?? []).length;
        const closeScripts = (file.content.match(/<\/script>/gi) ?? []).length;
        if (openScripts !== closeScripts) {
          errors.push(`${file.path}: Mismatched <script> / </script> tags (${openScripts} vs ${closeScripts}).`);
        }
      } else if (file.language === 'css') {
        let depth = 0;
        for (const ch of file.content) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
          if (depth < 0) break;
        }
        if (depth !== 0) {
          errors.push(`${file.path}: Unbalanced CSS curly braces.`);
        }
      }

      if (file.content.trim().length === 0) {
        warnings.push(`${file.path}: File is empty.`);
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      checkedFiles: filesToCheck.map((f) => f.path),
    };
  }

  createCheckpoint(label: string, taskId?: string): CodeCheckpoint {
    const filesSnapshot: Record<string, string> = {};
    for (const entry of Object.values(this.files)) {
      if (entry.status !== 'deleted') {
        filesSnapshot[entry.path] = entry.content;
      }
    }
    const checkpoint: CodeCheckpoint = {
      id: `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      ...(taskId ? { taskId } : {}),
      createdAt: Date.now(),
      files: filesSnapshot,
    };
    this.checkpoints = [...this.checkpoints, checkpoint].slice(-20);
    return checkpoint;
  }

  revertCheckpoint(checkpointId: string): boolean {
    const idx = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx === -1) return false;
    const target = this.checkpoints[idx];
    const now = Date.now();

    const nextFiles: Record<string, WorkspaceFileEntry> = {};
    const nextDiffs: Record<string, WorkspaceDiffEntry> = {};

    for (const [path, content] of Object.entries(target.files)) {
      const base = this.baselineSnapshot[path];
      const status = base === undefined ? 'created' : base === content ? 'unmodified' : 'modified';
      nextFiles[path] = {
        path,
        content,
        language: inferWorkspaceLanguage(path),
        status,
        updatedAt: now,
      };
      if (status !== 'unmodified') {
        nextDiffs[path] = {
          path,
          before: base ?? '',
          after: content,
          action: base === undefined ? 'create' : 'modify',
          status: 'pending',
          updatedAt: now,
        };
      }
    }

    for (const [basePath, baseContent] of Object.entries(this.baselineSnapshot)) {
      if (nextFiles[basePath] === undefined) {
        nextFiles[basePath] = {
          path: basePath,
          content: '',
          language: inferWorkspaceLanguage(basePath),
          status: 'deleted',
          updatedAt: now,
        };
        nextDiffs[basePath] = {
          path: basePath,
          before: baseContent,
          after: '',
          action: 'delete',
          status: 'pending',
          updatedAt: now,
        };
      }
    }

    this.files = nextFiles;
    this.diffs = nextDiffs;
    this.checkpoints = this.checkpoints.slice(0, idx + 1);
    return true;
  }

  acceptDiff(rawPath: string): boolean {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) return false;
    const diff = this.diffs[safe.path];
    if (!diff) return false;
    this.diffs[safe.path] = { ...diff, status: 'accepted', updatedAt: Date.now() };
    const file = this.files[safe.path];
    if (file && file.status !== 'deleted') {
      this.baselineSnapshot[safe.path] = file.content;
      this.files[safe.path] = { ...file, status: 'unmodified', updatedAt: Date.now() };
    }
    return true;
  }

  rejectDiff(rawPath: string): boolean {
    const safe = normalizeSafeWorkspacePath(rawPath);
    if (!safe.ok) return false;
    const diff = this.diffs[safe.path];
    if (!diff) return false;
    const now = Date.now();
    if (diff.action === 'create') {
      delete this.files[safe.path];
    } else {
      this.files[safe.path] = {
        path: safe.path,
        content: diff.before,
        language: inferWorkspaceLanguage(safe.path),
        status: 'unmodified',
        updatedAt: now,
      };
      this.baselineSnapshot[safe.path] = diff.before;
    }
    this.diffs[safe.path] = { ...diff, status: 'rejected', updatedAt: now };
    return true;
  }

  getFilesSnapshot(): Record<string, WorkspaceFileEntry> {
    const copy: Record<string, WorkspaceFileEntry> = {};
    for (const [k, v] of Object.entries(this.files)) {
      copy[k] = { ...v };
    }
    return copy;
  }

  getDiffsSnapshot(): Record<string, WorkspaceDiffEntry> {
    const copy: Record<string, WorkspaceDiffEntry> = {};
    for (const [k, v] of Object.entries(this.diffs)) {
      copy[k] = { ...v };
    }
    return copy;
  }

  getCheckpointsSnapshot(): CodeCheckpoint[] {
    return this.checkpoints.map((cp) => ({ ...cp, files: { ...cp.files } }));
  }
}

export function buildWorkspaceToolDefinitions(): LlmToolDefinition[] {
  const mk = (
    originalName: string,
    description: string,
    parameters: Record<string, unknown>,
    isReadOnly: boolean,
    isDestructive = false
  ): LlmToolDefinition => ({
    qualifiedName: `${WORKSPACE_VIRTUAL_SERVER_ID}__${originalName}`,
    originalName,
    serverId: WORKSPACE_VIRTUAL_SERVER_ID,
    serverName: WORKSPACE_VIRTUAL_SERVER_NAME,
    description: `[${WORKSPACE_VIRTUAL_SERVER_NAME}] ${description}`,
    parameters,
    isReadOnly,
    isDestructive,
  });

  return [
    mk(
      'list_files',
      'List files currently present in the Code workspace.',
      {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Optional directory prefix filter.' },
        },
      },
      true
    ),
    mk(
      'read_file',
      'Read file contents with 1-based line numbers. Required before calling patch_file.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          startLine: { type: 'integer', description: 'Optional 1-based start line.' },
          endLine: { type: 'integer', description: 'Optional 1-based end line.' },
        },
        required: ['path'],
      },
      true
    ),
    mk(
      'search_code',
      'Search across workspace files for a text substring with matching line numbers.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text substring to search for.' },
          pathPrefix: { type: 'string', description: 'Optional path prefix filter.' },
        },
        required: ['query'],
      },
      true
    ),
    mk(
      'write_file',
      'Create a new file or replace full contents of an explicit file path.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'Complete file content.' },
        },
        required: ['path', 'content'],
      },
      false
    ),
    mk(
      'patch_file',
      'Apply an exact unique search-and-replace patch to an existing file. Must call read_file first.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          search: { type: 'string', description: 'Exact unique existing snippet to replace.' },
          replace: { type: 'string', description: 'Replacement snippet.' },
        },
        required: ['path', 'search', 'replace'],
      },
      false
    ),
    mk(
      'delete_file',
      'Delete an existing file from the workspace.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path to remove.' },
        },
        required: ['path'],
      },
      false,
      true
    ),
    mk(
      'verify_code',
      'Run deterministic syntax, JSON, CSS, and asset reference verification on workspace files.',
      {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional subset of file paths to check.',
          },
        },
      },
      true
    ),
  ];
}

export function executeWorkspaceVfsTool(
  vfs: WorkspaceVfs,
  toolName: string,
  args: Record<string, unknown>,
  taskId?: string
): VfsOperationResult {
  switch (toolName) {
    case 'list_files':
      return vfs.listFiles(typeof args.dir === 'string' ? args.dir : undefined);
    case 'read_file':
      return vfs.readFile(
        String(args.path ?? ''),
        typeof args.startLine === 'number' ? args.startLine : undefined,
        typeof args.endLine === 'number' ? args.endLine : undefined
      );
    case 'search_code':
      return vfs.searchCode(
        String(args.query ?? ''),
        typeof args.pathPrefix === 'string' ? args.pathPrefix : undefined
      );
    case 'write_file':
      return vfs.writeFile(String(args.path ?? ''), String(args.content ?? ''), taskId);
    case 'patch_file':
      return vfs.patchFile(
        String(args.path ?? ''),
        String(args.search ?? ''),
        String(args.replace ?? ''),
        taskId
      );
    case 'delete_file':
      return vfs.deleteFile(String(args.path ?? ''), taskId);
    case 'verify_code':
      {
        const targetPaths = Array.isArray(args.paths)
          ? args.paths.filter((p): p is string => typeof p === 'string')
          : undefined;
        const report = vfs.verifyWorkspace(targetPaths);
        return {
          ok: report.ok,
          code: report.ok ? undefined : 'VERIFICATION_FAILED',
          text: JSON.stringify(report),
        };
      }
    default:
      return {
        ok: false,
        code: 'UNKNOWN_WORKSPACE_TOOL',
        text: JSON.stringify({
          tool_error: { code: 'UNKNOWN_WORKSPACE_TOOL', message: `Unsupported workspace tool "${toolName}".` },
        }),
      };
  }
}

export class PerKeyAsyncMutex {
  private queues = new Map<string, Promise<void>>();

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.queues.set(key, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.queues.get(key) === chained) {
        this.queues.delete(key);
      }
    }
  }
}

export interface BatchExecutableItem<T> {
  item: T;
  isReadOnly: boolean;
  mutexKey?: string;
}

export async function executeToolBatchDeterministically<T, R>(
  items: Array<BatchExecutableItem<T>>,
  executor: (item: T) => Promise<R>,
  mutex = new PerKeyAsyncMutex()
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  while (idx < items.length) {
    const curr = items[idx];
    if (curr.isReadOnly) {
      const readBatch: Array<BatchExecutableItem<T>> = [];
      while (idx < items.length && items[idx].isReadOnly) {
        readBatch.push(items[idx]);
        idx++;
      }
      const batchOut = await Promise.all(readBatch.map((entry) => executor(entry.item)));
      results.push(...batchOut);
    } else {
      idx++;
      const key = curr.mutexKey || '__global_write__';
      const out = await mutex.runExclusive(key, () => executor(curr.item));
      results.push(out);
    }
  }
  return results;
}

export function buildWorkspaceArtifactAppJson(
  files: Record<string, WorkspaceFileEntry>,
  title = 'Code Workspace Build'
): string | null {
  const active = Object.values(files)
    .filter((f) => f.status !== 'deleted')
    .sort((a, b) => a.path.localeCompare(b.path));
  const entryHtml = active.find((f) => f.path === 'index.html') ?? active.find((f) => f.path.endsWith('.html'));
  if (!entryHtml) return null;

  return JSON.stringify(
    {
      title,
      description: 'Generated by Code Orchestrator',
      framework: 'HTML / CSS / JS',
      entryFile: entryHtml.path,
      files: active.map((f) => ({
        path: f.path,
        language: f.language,
        content: f.content,
      })),
    },
    null,
    2
  );
}
