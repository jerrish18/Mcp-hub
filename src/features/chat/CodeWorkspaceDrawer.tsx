import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode2,
  GitCompare,
  History,
  ListChecks,
  Terminal,
  X,
} from 'lucide-react';
import { getModelById, getShortModelName } from '../../config/models';
import { buildWorkspaceArtifactAppJson } from '../../services/llm/toolHarness';
import type { CodingSessionState, ModelConfig } from '../../types';
import { computeLineDiff } from '../../utils/proFeatures';

type WorkspaceTab = 'plan' | 'files' | 'diffs' | 'trace';

interface CodeWorkspaceDrawerProps {
  open: boolean;
  onClose: () => void;
  session: CodingSessionState | undefined;
  dynamicModels: ModelConfig[];
  isRunning: boolean;
  onApprovePlan?: (messageId: string) => void;
  activePlanMessageId?: string;
  onAcceptDiff: (path: string) => void;
  onRejectDiff: (path: string) => void;
  onRevertCheckpoint: (checkpointId: string) => void;
  onOpenPreviewInCanvas: (artifactJson: string) => void;
}

export function CodeWorkspaceDrawer({
  open,
  onClose,
  session,
  dynamicModels,
  isRunning,
  onApprovePlan,
  activePlanMessageId,
  onAcceptDiff,
  onRejectDiff,
  onRevertCheckpoint,
  onOpenPreviewInCanvas,
}: CodeWorkspaceDrawerProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('files');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});

  const files = useMemo(
    () =>
      Object.values(session?.files ?? {}).sort((a, b) => a.path.localeCompare(b.path)),
    [session?.files]
  );
  const diffs = useMemo(
    () => Object.values(session?.diffs ?? {}).sort((a, b) => a.path.localeCompare(b.path)),
    [session?.diffs]
  );
  const checkpoints = useMemo(
    () => [...(session?.checkpoints ?? [])].reverse(),
    [session?.checkpoints]
  );
  const traces = useMemo(
    () => [...(session?.toolTrace ?? [])].reverse(),
    [session?.toolTrace]
  );

  const activeFile =
    files.find((f) => f.path === selectedFilePath) ??
    files.find((f) => f.status !== 'deleted') ??
    files[0] ??
    null;

  const previewArtifactJson = useMemo(
    () =>
      session?.files
        ? buildWorkspaceArtifactAppJson(
            session.files,
            session.activePlan?.summary.slice(0, 40) || 'Code Workspace App'
          )
        : null,
    [session?.files, session?.activePlan?.summary]
  );

  if (!open) return null;

  const tabs: Array<{ id: WorkspaceTab; label: string; count?: number; Icon: typeof ListChecks }> = [
    { id: 'plan', label: 'Plan', Icon: ListChecks },
    { id: 'files', label: 'Files', count: files.filter((f) => f.status !== 'deleted').length, Icon: FileCode2 },
    { id: 'diffs', label: 'Diffs', count: diffs.length, Icon: GitCompare },
    { id: 'trace', label: 'Trace', count: traces.length, Icon: Terminal },
  ];

  return (
    <aside
      aria-label="Code Workspace"
      data-testid="code-workspace-drawer"
      style={{
        backgroundColor: 'var(--m3-surface)',
        borderColor: 'var(--m3-outline)',
      }}
      className="fixed inset-0 z-40 lg:static lg:inset-auto lg:w-[440px] xl:w-[490px] lg:shrink-0 lg:border-l flex flex-col min-h-0"
    >
      {/* Top Bar */}
      <header
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="shrink-0 px-4 py-2.5 border-b flex items-center justify-between gap-3"
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
            Code Workspace
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {files.filter((f) => f.status !== 'deleted').length} files · {diffs.length} diffs · {traces.length} calls
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {previewArtifactJson && (
            <button
              type="button"
              data-testid="workspace-preview-canvas-btn"
              onClick={() => onOpenPreviewInCanvas(previewArtifactJson)}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span>Preview</span>
            </button>
          )}
          <button
            type="button"
            data-testid="close-code-workspace-btn"
            aria-label="Close Code Workspace"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 4-Tab Bar */}
      <div
        role="tablist"
        aria-label="Code Workspace views"
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="shrink-0 px-2 py-1.5 border-b grid grid-cols-4 gap-1"
      >
        {tabs.map(({ id, label, count, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`workspace-tab-${id}`}
              onClick={() => setActiveTab(id)}
              style={
                active
                  ? {
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }
                  : undefined
              }
              className={`min-h-[44px] px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                active
                  ? ''
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{label}</span>
              {typeof count === 'number' && (
                <span className="font-mono tabular-nums text-[11px] opacity-80">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {activeTab === 'plan' && (
          <div className="space-y-4" data-testid="workspace-pane-plan">
            {!session?.activePlan ? (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                Send a prompt in Code mode to generate an Architect specification plan.
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Active Plan ({session.activePlan.phase.replace('_', ' ')})
                  </div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {session.activePlan.summary}
                  </p>
                </div>

                {session.activePlan.phase === 'awaiting_approval' &&
                  onApprovePlan &&
                  activePlanMessageId && (
                    <button
                      type="button"
                      disabled={isRunning}
                      onClick={() => onApprovePlan(activePlanMessageId)}
                      style={{
                        backgroundColor: 'var(--m3-primary)',
                        color: 'var(--m3-on-primary)',
                      }}
                      className="w-full min-h-[44px] rounded-xl text-xs font-semibold"
                    >
                      Approve & Build
                    </button>
                  )}

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Subagent Execution Log
                  </h3>
                  {session.activePlan.subagentTraces.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No subagent executions yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-b border-slate-200 dark:border-slate-800">
                      {session.activePlan.subagentTraces.map((tr) => {
                        const modelName = getShortModelName(
                          getModelById(tr.modelId, dynamicModels)
                        );
                        return (
                          <div
                            key={tr.id}
                            className="py-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 dark:text-white capitalize">
                                {tr.role} · {tr.phase}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {modelName} ({tr.provider})
                                {tr.fallbackFrom ? ` · fallback from ${tr.fallbackFrom}` : ''}
                              </div>
                            </div>
                            <div className="text-right font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                              <div>{tr.tokens} tok</div>
                              <div>{tr.durationMs}ms</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'files' && (
          <div className="space-y-3" data-testid="workspace-pane-files">
            {files.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                No workspace files yet. Attach files or approve a plan to populate the sandbox VFS.
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  {files.map((f) => {
                    const selected = activeFile?.path === f.path;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => setSelectedFilePath(f.path)}
                        style={
                          selected
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                              }
                            : undefined
                        }
                        className={`w-full min-h-[44px] px-3 rounded-xl flex items-center justify-between gap-2 text-xs text-left ${
                          selected
                            ? 'font-semibold'
                            : 'hover:bg-slate-200/50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <code className="font-mono truncate">{f.path}</code>
                        <span className="font-mono tabular-nums text-[11px] opacity-80 shrink-0">
                          {f.status} · {f.content.split(/\r?\n/).length}L
                        </span>
                      </button>
                    );
                  })}
                </div>

                {activeFile && (
                  <div
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-xl border overflow-hidden"
                  >
                    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                      <code className="font-mono font-semibold text-slate-900 dark:text-white truncate">
                        {activeFile.path}
                      </code>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                        {activeFile.language}
                      </span>
                    </div>
                    <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto max-h-[380px] text-slate-900 dark:text-slate-100">
                      <code>{activeFile.content || '// Empty or deleted file'}</code>
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'diffs' && (
          <div className="space-y-4" data-testid="workspace-pane-diffs">
            {/* Checkpoints */}
            {checkpoints.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  <span>Checkpoints</span>
                </h3>
                <div className="space-y-1.5">
                  {checkpoints.map((cp) => (
                    <div
                      key={cp.id}
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="rounded-xl border px-3 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-white truncate">
                          {cp.label}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {new Date(cp.createdAt).toLocaleTimeString()} · {Object.keys(cp.files).length} files
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`revert-checkpoint-${cp.id}`}
                        disabled={isRunning}
                        onClick={() => onRevertCheckpoint(cp.id)}
                        style={{
                          backgroundColor: 'var(--m3-surface)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="min-h-[44px] px-3 rounded-xl border text-xs font-semibold text-slate-800 dark:text-slate-100 shrink-0 disabled:opacity-50"
                      >
                        Revert
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Diffs */}
            {diffs.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                No pending or recorded file diffs in this workspace yet.
              </div>
            ) : (
              <div className="space-y-3">
                {diffs.map((d) => {
                  const lines = computeLineDiff(d.before, d.after, 120);
                  return (
                    <div
                      key={d.path}
                      style={{
                        backgroundColor: 'var(--m3-surface-container)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="rounded-xl border overflow-hidden"
                    >
                      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <code className="text-xs font-mono font-semibold text-slate-900 dark:text-white truncate block">
                            {d.path}
                          </code>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 capitalize">
                            Status: {d.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`accept-diff-${d.path}`}
                            disabled={isRunning || d.status === 'accepted'}
                            onClick={() => onAcceptDiff(d.path)}
                            className="min-h-[44px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-45"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`reject-diff-${d.path}`}
                            disabled={isRunning}
                            onClick={() => onRejectDiff(d.path)}
                            style={{
                              backgroundColor: 'var(--m3-surface)',
                              borderColor: 'var(--m3-outline)',
                            }}
                            className="min-h-[44px] px-3 rounded-xl border text-xs font-semibold text-rose-700 dark:text-rose-300 disabled:opacity-45"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                      <pre className="p-2.5 text-[11px] font-mono overflow-x-auto max-h-64 leading-relaxed">
                        {lines.map((line, i) => (
                          <div
                            key={i}
                            className={
                              line.kind === 'added'
                                ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 px-1.5'
                                : line.kind === 'removed'
                                  ? 'bg-rose-500/15 text-rose-800 dark:text-rose-200 px-1.5'
                                  : 'text-slate-600 dark:text-slate-400 px-1.5'
                            }
                          >
                            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
                            {line.text}
                          </div>
                        ))}
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'trace' && (
          <div className="space-y-2" data-testid="workspace-pane-trace">
            {traces.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                Tool validation and execution traces will appear here as tasks run.
              </div>
            ) : (
              traces.map((entry) => {
                const isExpanded = Boolean(expandedTraces[entry.id]);
                return (
                  <div
                    key={entry.id}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-xl border overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTraces((prev) => ({ ...prev, [entry.id]: !isExpanded }))
                      }
                      aria-expanded={isExpanded}
                      className="w-full min-h-[44px] px-3 py-2 flex items-center justify-between gap-2 text-left text-xs hover:bg-slate-200/40 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 shrink-0 text-slate-500" />
                        ) : (
                          <ChevronRight className="w-4 h-4 shrink-0 text-slate-500" />
                        )}
                        <code className="font-mono font-semibold text-slate-900 dark:text-white truncate">
                          {entry.resolvedToolName}
                        </code>
                        <span
                          className={`font-mono text-[11px] shrink-0 ${
                            entry.isError || entry.validationStatus === 'rejected'
                              ? 'text-rose-700 dark:text-rose-300'
                              : entry.validationStatus === 'repaired' ||
                                  entry.validationStatus === 'coerced'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {entry.validationStatus}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        {entry.repairAttempts > 0 ? `${entry.repairAttempts}r · ` : ''}
                        {entry.durationMs}ms
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-800 space-y-2 text-[11px]">
                        <div>
                          <div className="font-semibold text-slate-600 dark:text-slate-400">
                            Arguments
                          </div>
                          <pre className="font-mono overflow-x-auto text-slate-800 dark:text-slate-200">
                            {JSON.stringify(entry.args, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="font-semibold text-slate-600 dark:text-slate-400">
                            Result
                          </div>
                          <pre
                            className={`font-mono whitespace-pre-wrap break-words ${
                              entry.isError
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {entry.outputPreview}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
