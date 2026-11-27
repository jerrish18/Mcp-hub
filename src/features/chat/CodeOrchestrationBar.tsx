import { useState } from 'react';
import { ChevronDown, ChevronUp, Cpu, FolderCode, PlayCircle, Sparkles } from 'lucide-react';
import {
  CODING_ROLE_METADATA,
  formatContextWindowLabel,
  getModelById,
  getShortModelName,
  normalizeModelId,
  PROVIDER_INFO,
  scoreModelForCodingRole,
  selectDefaultRoleModels,
} from '../../config/models';
import type {
  CodeOrchestrationMode,
  CodeOrchestrationSettings,
  CodingRole,
  CodingSessionState,
  ModelConfig,
  ProviderId,
} from '../../types';

interface CodeOrchestrationBarProps {
  orchestration: CodeOrchestrationSettings;
  availableModels: ModelConfig[];
  activeModelId: string;
  codingSession?: CodingSessionState;
  workspaceOpen: boolean;
  onToggleWorkspace: () => void;
  onSetOrchestrationMode: (mode: CodeOrchestrationMode) => void;
  onSetRoleAssignment: (role: CodingRole, modelId: string | null) => void;
  onToggleAutoRun: () => void;
}

const ROLES: CodingRole[] = ['architect', 'coder', 'reviewer'];
const PROVIDER_ORDER: ProviderId[] = [
  'gemini',
  'groq',
  'openrouter',
  'cloudflare',
  'nvidia',
  'modelscope',
  'amd',
  'kilo',
  'local',
  'demo',
];

function formatTokensCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(Math.round(tokens));
}

export function CodeOrchestrationBar({
  orchestration,
  availableModels,
  activeModelId,
  codingSession,
  workspaceOpen,
  onToggleWorkspace,
  onSetOrchestrationMode,
  onSetRoleAssignment,
  onToggleAutoRun,
}: CodeOrchestrationBarProps) {
  const [rolesExpanded, setRolesExpanded] = useState(false);

  const usableModels = availableModels.filter((m) => m.id !== 'cloud-auto');
  const defaults = selectDefaultRoleModels(availableModels, activeModelId);
  const isSingle = orchestration.mode === 'single';

  const stats = codingSession?.contextStats ?? {
    estimatedTokens: 0,
    contextWindow: getModelById(activeModelId, availableModels).contextWindow || 128_000,
    ratio: 0,
    compacted: false,
  };
  const pct = Math.min(100, Math.round((stats.ratio || 0) * 100));

  const fileCount = Object.values(codingSession?.files ?? {}).filter(
    (f) => f.status !== 'deleted'
  ).length;
  const diffCount = Object.values(codingSession?.diffs ?? {}).filter(
    (d) => d.status === 'pending'
  ).length;

  return (
    <section
      aria-label="Code orchestration controls"
      data-testid="code-orchestration-bar"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="shrink-0 border-b px-3 sm:px-5 py-1.5 space-y-1.5"
    >
      {/* Primary Single-Row Bar */}
      <div className="flex items-center justify-between gap-1.5 flex-nowrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            data-testid="code-roles-expand-btn"
            aria-expanded={rolesExpanded}
            onClick={() => setRolesExpanded((v) => !v)}
            style={
              rolesExpanded
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                    borderColor: 'var(--m3-primary)',
                  }
                : {
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }
            }
            className="lg:hidden min-h-[44px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Cpu className="w-4 h-4 shrink-0" />
            <span>{isSingle ? 'Single' : 'Roles'}</span>
            {rolesExpanded ? (
              <ChevronUp className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            )}
          </button>

          <button
            type="button"
            data-testid="code-single-mode-btn"
            aria-pressed={isSingle}
            onClick={() => onSetOrchestrationMode(isSingle ? 'custom' : 'single')}
            style={
              isSingle
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                    borderColor: 'var(--m3-primary)',
                  }
                : {
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }
            }
            className="hidden lg:inline-flex min-h-[44px] px-3 rounded-xl border text-xs font-semibold text-slate-800 dark:text-slate-100 items-center gap-1.5 whitespace-nowrap shrink-0 hover:opacity-90"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{isSingle ? 'Single-Model Mode' : 'Multi-Role Custom'}</span>
          </button>

          <button
            type="button"
            data-testid="code-autorun-toggle"
            aria-pressed={orchestration.autoRun}
            onClick={onToggleAutoRun}
            style={
              orchestration.autoRun
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                    borderColor: 'var(--m3-primary)',
                  }
                : {
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }
            }
            className="min-h-[44px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:opacity-90"
          >
            <PlayCircle className="w-4 h-4 shrink-0" />
            <span className="sm:hidden">Auto</span>
            <span className="hidden sm:inline">Auto-Run</span>
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Unboxed Context Window Meter */}
          <div
            data-testid="code-context-meter"
            className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums whitespace-nowrap"
            title="Estimated context window usage before automatic 75% compaction"
          >
            <span>
              {formatTokensCompact(stats.estimatedTokens)} / {formatTokensCompact(stats.contextWindow)}
            </span>
            <span aria-hidden="true">·</span>
            <span className={pct >= 75 ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
              {pct}%
            </span>
            {stats.compacted && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-sans font-semibold text-blue-700 dark:text-blue-300">
                  Compacted
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            data-testid="code-workspace-toggle-btn"
            aria-pressed={workspaceOpen}
            onClick={onToggleWorkspace}
            style={
              workspaceOpen
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                    borderColor: 'var(--m3-primary)',
                  }
                : {
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }
            }
            className="min-h-[44px] px-2.5 sm:px-3 rounded-xl border text-xs font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:opacity-90"
          >
            <FolderCode className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Workspace</span>
            <span className="sm:hidden">Files</span>
            <span className="font-mono tabular-nums opacity-75">
              {fileCount}f · {diffCount}d
            </span>
          </button>
        </div>
      </div>

      {/* Role Model Pickers (compact on lg+, toggled on mobile to keep mobile header single-row) */}
      <div
        className={`${rolesExpanded ? 'grid' : 'hidden lg:grid'} grid-cols-1 sm:grid-cols-3 gap-2 pt-0.5`}
      >
        <div className="sm:col-span-3 lg:hidden flex items-center justify-between gap-2 pb-1">
          <button
            type="button"
            aria-pressed={isSingle}
            onClick={() => onSetOrchestrationMode(isSingle ? 'custom' : 'single')}
            style={
              isSingle
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                    borderColor: 'var(--m3-primary)',
                  }
                : {
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }
            }
            className="min-h-[44px] px-3 rounded-xl border text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span>{isSingle ? 'Single-Model Mode Active' : 'Switch to Single-Model Mode'}</span>
          </button>
          <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            {usableModels.length} models · Ctx {pct}%
          </span>
        </div>

        {ROLES.map((role) => {
          const meta = CODING_ROLE_METADATA[role];
          const normalizedActive = normalizeModelId(activeModelId);
          const rawCandidate = isSingle
            ? normalizedActive !== 'cloud-auto'
              ? normalizedActive
              : defaults[role]
            : orchestration.roles[role] ?? defaults[role];
          const normalizedCandidate = rawCandidate ? normalizeModelId(rawCandidate) : '';
          const matchedOption =
            usableModels.find((m) => normalizeModelId(m.id) === normalizedCandidate) ??
            usableModels.find((m) => normalizeModelId(m.id) === normalizeModelId(defaults[role] ?? '')) ??
            usableModels[0];
          const selectedId = matchedOption?.id ?? 'demo-sandbox';

          return (
            <label
              key={role}
              title={meta.shortHint}
              className="flex flex-col gap-0.5 min-w-0 text-[11px] text-slate-600 dark:text-slate-300"
            >
              <span className="px-0.5 font-semibold text-slate-700 dark:text-slate-200 truncate">
                {meta.label}
              </span>
              <select
                aria-label={`${meta.label} model`}
                data-testid={`role-select-${role}`}
                disabled={isSingle}
                value={selectedId}
                onChange={(e) => onSetRoleAssignment(role, e.target.value)}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[44px] w-full px-2.5 rounded-xl border text-xs font-medium text-slate-900 dark:text-slate-100 disabled:opacity-60 truncate focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVIDER_ORDER.map((provider) => {
                  const group = usableModels
                    .filter((m) => m.provider === provider)
                    .sort(
                      (a, b) =>
                        scoreModelForCodingRole(b, role) - scoreModelForCodingRole(a, role) ||
                        a.label.localeCompare(b.label)
                    );
                  if (group.length === 0) return null;
                  return (
                    <optgroup key={provider} label={PROVIDER_INFO[provider].name}>
                      {group.map((m) => (
                        <option key={m.id} value={m.id}>
                          {getShortModelName(m)} · {m.provider} · {formatContextWindowLabel(m.contextWindow)}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}
