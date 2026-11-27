import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  Play,
  RefreshCw,
  Server,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { ModelConfig, RunTrace, RunTraceStep } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { useHubStore } from '../../store/useHubStore';
import {
  aggregateTraceServerStats,
  filterTraceSteps,
  formatDurationCompact,
  formatTraceAsMarkdown,
  normalizeTraceSteps,
  redactRunTrace,
  SLOW_STEP_THRESHOLD_MS,
  type TraceStepFilter,
} from '../../utils/runTrace';

export interface ConversationTraceEntry {
  id: string;
  label: string;
  trace: RunTrace;
}

interface RunTraceSheetProps {
  open: boolean;
  trace: RunTrace | null;
  messageTitle?: string;
  dynamicModels?: ModelConfig[];
  conversationTraces?: ConversationTraceEntry[];
  onSelectTrace?: (entry: ConversationTraceEntry) => void;
  onRetryToolCall?: (params: {
    serverId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => Promise<{ ok: boolean; result?: string; error?: string; denied?: boolean; durationMs: number }>;
  onClose: () => void;
}

function StepIcon({ step }: { step: RunTraceStep }) {
  if (step.kind === 'tool_call') {
    if (step.status === 'running') {
      return <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0" />;
    }
    if (step.status === 'success') {
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
    }
    return <XCircle className="w-4 h-4 text-rose-500 shrink-0" />;
  }
  if (step.kind === 'model_call') {
    if (step.status === 'running') {
      return <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse shrink-0" />;
    }
    if (step.status === 'error') {
      return <XCircle className="w-4 h-4 text-rose-500 shrink-0" />;
    }
    return <Cpu className="w-4 h-4 text-sky-500 shrink-0" />;
  }
  if (step.kind === 'approval_wait') {
    return step.decision === 'deny' ? (
      <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
    ) : (
      <Clock className="w-4 h-4 text-amber-500 shrink-0" />
    );
  }
  if (step.kind === 'fallback') {
    return <ArrowRight className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  if (step.kind === 'injection_warning') {
    return <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />;
  }
  return <Database className="w-4 h-4 text-indigo-500 shrink-0" />;
}

function stepTitle(step: RunTraceStep): string {
  switch (step.kind) {
    case 'model_call':
      return `Model Call · ${step.modelId}`;
    case 'tool_call':
      return `${step.toolName}`;
    case 'approval_wait':
      return `Approval Wait · ${step.toolName}`;
    case 'rag':
      return `Local RAG · ${step.chunksCount} chunk${step.chunksCount === 1 ? '' : 's'}`;
    case 'fallback':
      return `Model Fallback · ${step.from} → ${step.to}`;
    case 'injection_warning':
      return `Injection Guard · ${step.serverName}/${step.toolName}`;
  }
}

export function RunTraceSheet({
  open,
  trace,
  messageTitle,
  conversationTraces = [],
  onSelectTrace,
  onRetryToolCall,
  onClose,
}: RunTraceSheetProps) {
  const [viewTab, setViewTab] = useState<'timeline' | 'stats'>('timeline');
  const [filter, setFilter] = useState<TraceStepFilter>('all');
  const [expandedStepIds, setExpandedStepIds] = useState<Record<string, boolean>>({});
  const [showFullResultIds, setShowFullResultIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Tool retry state
  const [retryStepId, setRetryStepId] = useState<string | null>(null);
  const [retryArgsText, setRetryArgsText] = useState('{}');
  const [retryParseError, setRetryParseError] = useState('');
  const [retryRunning, setRetryRunning] = useState(false);
  const [retryOutcomes, setRetryOutcomes] = useState<
    Record<string, { ok: boolean; text: string; durationMs: number }>
  >({});

  const allSteps = useMemo(() => (trace ? normalizeTraceSteps(trace) : []), [trace]);
  const filteredSteps = useMemo(() => filterTraceSteps(allSteps, filter), [allSteps, filter]);
  const serverStats = useMemo(
    () =>
      aggregateTraceServerStats(
        conversationTraces.length > 0
          ? conversationTraces.map((c) => c.trace)
          : trace
            ? [trace]
            : []
      ),
    [conversationTraces, trace]
  );

  const totalRunMs = useMemo(() => {
    if (!trace) return 1;
    const stepMax = allSteps.reduce(
      (max, s) => Math.max(max, s.startedAt - trace.startedAt + s.durationMs),
      0
    );
    return Math.max(1, trace.durationMs || 0, stepMax);
  }, [trace, allSteps]);

  const toggleStep = (id: string) => {
    setExpandedStepIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  const providerKeys = useHubStore((s) => s.providerKeys);
  const knownSecrets = useMemo(
    () => Object.values(providerKeys).filter((v): v is string => typeof v === 'string' && v.length > 0),
    [providerKeys]
  );

  const handleDownloadJson = () => {
    if (!trace) return;
    const sanitized = redactRunTrace(trace, knownSecrets);
    const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcphub-run-trace-${sanitized.startedAt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenRetry = (step: Extract<RunTraceStep, { kind: 'tool_call' }>) => {
    setRetryParseError('');
    setRetryStepId((prev) => (prev === step.id ? null : step.id));
    setRetryArgsText(step.fullArgsJson || step.argsPreview || '{}');
  };

  const handleExecuteRetry = async (step: Extract<RunTraceStep, { kind: 'tool_call' }>) => {
    if (!onRetryToolCall || !step.serverId) return;
    setRetryParseError('');
    let parsedArgs: Record<string, unknown>;
    try {
      const parsed = JSON.parse(retryArgsText || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setRetryParseError('Arguments must be a JSON object.');
        return;
      }
      parsedArgs = parsed as Record<string, unknown>;
    } catch (err) {
      setRetryParseError(err instanceof Error ? err.message : 'Invalid JSON syntax');
      return;
    }

    setRetryRunning(true);
    try {
      const outcome = await onRetryToolCall({
        serverId: step.serverId,
        toolName: step.toolName,
        args: parsedArgs,
      });
      setRetryOutcomes((prev) => ({
        ...prev,
        [step.id]: {
          ok: outcome.ok,
          text: outcome.ok
            ? outcome.result || 'Tool executed successfully.'
            : outcome.error || 'Tool execution failed.',
          durationMs: outcome.durationMs,
        },
      }));
    } finally {
      setRetryRunning(false);
    }
  };

  return (
    <BottomSheet
      open={open && Boolean(trace)}
      onClose={onClose}
      title="Execution Run Trace"
      subtitle={messageTitle || 'Waterfall timeline, model routing & tool replay'}
    >
      {trace && (
        <div className="space-y-4">
          {/* View Tabs: This Turn vs Conversation Stats */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="tablist"
              aria-label="Trace view"
              style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
              className="inline-flex items-center p-1 rounded-2xl gap-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewTab === 'timeline'}
                data-testid="trace-tab-timeline"
                onClick={() => setViewTab('timeline')}
                style={
                  viewTab === 'timeline'
                    ? {
                        backgroundColor: 'var(--m3-primary-container)',
                        color: 'var(--m3-on-primary-container)',
                      }
                    : undefined
                }
                className="min-h-[44px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Turn Waterfall</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewTab === 'stats'}
                data-testid="trace-tab-stats"
                onClick={() => setViewTab('stats')}
                style={
                  viewTab === 'stats'
                    ? {
                        backgroundColor: 'var(--m3-primary-container)',
                        color: 'var(--m3-on-primary-container)',
                      }
                    : undefined
                }
                className="min-h-[44px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200"
              >
                <Server className="w-3.5 h-3.5" />
                <span>History & Stats ({conversationTraces.length || 1})</span>
              </button>
            </div>
          </div>

          {viewTab === 'stats' ? (
            <div className="space-y-4">
              {/* Per-server aggregate stats */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Per-Server Tool Telemetry (This Conversation)
                </h3>
                {serverStats.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No MCP tool calls have run in this conversation yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {serverStats.map((srv) => (
                      <div
                        key={srv.serverName}
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="rounded-2xl border p-3 space-y-1 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white truncate">
                            {srv.serverName}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                            {srv.successRatePct}% ok
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between tabular-nums">
                          <span>
                            {srv.calls} call{srv.calls === 1 ? '' : 's'}
                            {srv.errors > 0 ? ` · ${srv.errors} failed` : ''}
                          </span>
                          <span>avg {formatDurationCompact(srv.avgLatencyMs)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Conversation Trace History */}
              {conversationTraces.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Recorded Turns ({conversationTraces.length})
                  </h3>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {conversationTraces.map((entry) => {
                      const isCurrent = entry.trace.startedAt === trace.startedAt;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => {
                            onSelectTrace?.(entry);
                            setViewTab('timeline');
                          }}
                          style={{
                            backgroundColor: isCurrent
                              ? 'var(--m3-primary-container)'
                              : 'var(--m3-surface-container)',
                            borderColor: isCurrent ? 'var(--m3-primary)' : 'var(--m3-outline)',
                            color: isCurrent ? 'var(--m3-on-primary-container)' : undefined,
                          }}
                          className="w-full min-h-[44px] rounded-xl border px-3 py-2 text-left flex items-center justify-between gap-2 text-xs hover:opacity-90"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{entry.label}</div>
                            <div className="text-[11px] opacity-75">
                              {entry.trace.toolCalls.length} tools · {entry.trace.usedModelId}
                            </div>
                          </div>
                          <span className="font-mono text-[11px] tabular-nums shrink-0">
                            {formatDurationCompact(entry.trace.durationMs)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Top Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-2xl border p-3"
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Duration</span>
                  </div>
                  <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {formatDurationCompact(trace.durationMs)}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-2xl border p-3"
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                    <Activity className="w-3 h-3" />
                    <span>Steps</span>
                  </div>
                  <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {trace.stepsExecuted} ({allSteps.length} events)
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-2xl border p-3"
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Est. Prompt Tokens
                  </div>
                  <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {trace.estimatedPromptTokens.toLocaleString()}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-2xl border p-3"
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                    <Database className="w-3 h-3" />
                    <span>Local RAG</span>
                  </div>
                  <div className="text-base font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                    {trace.ragUsed ? `${trace.ragChunksCount ?? 0} chunks` : 'Direct'}
                  </div>
                </div>
              </div>

              {/* Filter Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: `All (${allSteps.length})` },
                      { id: 'tools', label: 'Tools' },
                      { id: 'models', label: 'Models' },
                      { id: 'errors', label: 'Errors & Slow' },
                    ] as const
                  ).map((item) => {
                    const active = filter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid={`trace-filter-${item.id}`}
                        onClick={() => setFilter(item.id)}
                        style={
                          active
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                                borderColor: 'var(--m3-primary)',
                              }
                            : {
                                backgroundColor: 'var(--m3-surface-container)',
                                borderColor: 'var(--m3-outline)',
                              }
                        }
                        className="min-h-[44px] px-3 rounded-xl border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:opacity-90"
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                {trace.stoppedByUser && (
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Stopped early by user
                  </span>
                )}
              </div>

              {/* Vertical Waterfall Timeline */}
              <div className="space-y-2">
                {filteredSteps.length === 0 ? (
                  <div
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-2xl border p-4 text-xs text-slate-500 dark:text-slate-400 text-center"
                  >
                    No steps match this filter.
                  </div>
                ) : (
                  filteredSteps.map((step) => {
                    const offsetMs = Math.max(0, step.startedAt - trace.startedAt);
                    const leftPct = Math.min(92, Math.max(0, (offsetMs / totalRunMs) * 100));
                    const widthPct = Math.min(
                      100 - leftPct,
                      Math.max(4, (Math.max(1, step.durationMs) / totalRunMs) * 100)
                    );
                    const isSlow = step.durationMs >= SLOW_STEP_THRESHOLD_MS;
                    const isError =
                      (step.kind === 'tool_call' &&
                        (step.status === 'error' || step.status === 'denied')) ||
                      (step.kind === 'model_call' && step.status === 'error') ||
                      step.kind === 'injection_warning';
                    const isExpanded = Boolean(expandedStepIds[step.id]);
                    const barColor = isError
                      ? 'bg-rose-500'
                      : isSlow || step.kind === 'fallback' || step.kind === 'approval_wait'
                        ? 'bg-amber-500'
                        : step.kind === 'model_call'
                          ? 'bg-sky-500'
                          : 'bg-emerald-500';
                    const outcome = retryOutcomes[step.id];

                    return (
                      <div
                        key={step.id}
                        data-testid={`trace-step-${step.kind}`}
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: isError
                            ? 'rgba(244, 63, 94, 0.45)'
                            : isSlow
                              ? 'rgba(245, 158, 11, 0.45)'
                              : 'var(--m3-outline)',
                        }}
                        className="rounded-2xl border p-3 space-y-2"
                      >
                        <button
                          type="button"
                          onClick={() => toggleStep(step.id)}
                          aria-expanded={isExpanded}
                          className="w-full min-h-[44px] text-left flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <StepIcon step={step} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white truncate">
                                  {stepTitle(step)}
                                </span>
                                {step.kind === 'tool_call' && (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                    ({step.serverName})
                                  </span>
                                )}
                                {isSlow && (
                                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-0.5">
                                    <AlertTriangle className="w-3 h-3" />
                                    Slow
                                  </span>
                                )}
                              </div>
                              {/* Horizontal relative waterfall bar */}
                              <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 relative overflow-hidden">
                                <div
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  className={`absolute top-0 bottom-0 rounded-full ${barColor}`}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
                              +{formatDurationCompact(offsetMs)} ·{' '}
                              {formatDurationCompact(step.durationMs)}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-2.5 text-xs">
                            {step.kind === 'tool_call' && (
                              <>
                                {step.argsPreview && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                      <span>Redacted Arguments</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void copyText(
                                            `${step.id}_args`,
                                            step.fullArgsJson || step.argsPreview || ''
                                          )
                                        }
                                        className="min-h-[32px] px-2 rounded-lg inline-flex items-center gap-1 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                                      >
                                        {copiedId === `${step.id}_args` ? (
                                          <Check className="w-3 h-3 text-emerald-500" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                        <span>Copy</span>
                                      </button>
                                    </div>
                                    <pre className="p-2.5 rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
                                      {showFullResultIds[`${step.id}_args`]
                                        ? step.fullArgsJson || step.argsPreview
                                        : step.argsPreview}
                                    </pre>
                                  </div>
                                )}

                                {(step.resultPreview || step.error) && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                      <span>
                                        {step.error ? 'Error' : 'Result Preview'}
                                        {step.truncated ? ' (output budgeted)' : ''}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void copyText(
                                            `${step.id}_res`,
                                            step.resultPreview || step.error || ''
                                          )
                                        }
                                        className="min-h-[32px] px-2 rounded-lg inline-flex items-center gap-1 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                                      >
                                        {copiedId === `${step.id}_res` ? (
                                          <Check className="w-3 h-3 text-emerald-500" />
                                        ) : (
                                          <Copy className="w-3 h-3" />
                                        )}
                                        <span>Copy</span>
                                      </button>
                                    </div>
                                    <pre className="p-2.5 rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap break-words max-h-48">
                                      {showFullResultIds[step.id]
                                        ? step.resultPreview || step.error
                                        : (step.resultPreview || step.error || '').slice(0, 320)}
                                    </pre>
                                    {(step.resultPreview || '').length > 320 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setShowFullResultIds((p) => ({
                                            ...p,
                                            [step.id]: !p[step.id],
                                          }))
                                        }
                                        className="text-[11px] font-semibold text-blue-600 dark:text-blue-400"
                                      >
                                        {showFullResultIds[step.id] ? 'Show less' : 'Show more'}
                                      </button>
                                    )}
                                  </div>
                                )}

                                {onRetryToolCall && step.serverId && (
                                  <div className="space-y-2">
                                    <button
                                      type="button"
                                      data-testid="retry-trace-tool-btn"
                                      onClick={() => handleOpenRetry(step)}
                                      style={{
                                        backgroundColor: 'var(--m3-surface-container-high)',
                                        borderColor: 'var(--m3-outline)',
                                      }}
                                      className="min-h-[44px] px-3.5 rounded-xl border text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 hover:opacity-90"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      <span>Retry this tool call</span>
                                      {!step.isReadOnly && (
                                        <span className="text-[11px] opacity-70">
                                          (approval required)
                                        </span>
                                      )}
                                    </button>

                                    {retryStepId === step.id && (
                                      <div className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-700 p-2.5">
                                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                                          Edit JSON arguments before replay
                                        </label>
                                        <textarea
                                          rows={4}
                                          value={retryArgsText}
                                          onChange={(e) => setRetryArgsText(e.target.value)}
                                          className="w-full rounded-xl bg-slate-950 text-slate-100 font-mono text-[11px] p-2 border border-slate-700"
                                        />
                                        {retryParseError && (
                                          <p className="text-[11px] text-rose-500">
                                            {retryParseError}
                                          </p>
                                        )}
                                        <button
                                          type="button"
                                          disabled={retryRunning}
                                          data-testid="confirm-retry-tool-btn"
                                          onClick={() => void handleExecuteRetry(step)}
                                          style={{
                                            backgroundColor: 'var(--m3-primary-container)',
                                            color: 'var(--m3-on-primary-container)',
                                          }}
                                          className="min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                          <Play className="w-3.5 h-3.5" />
                                          <span>
                                            {retryRunning ? 'Running…' : 'Execute Tool Replay'}
                                          </span>
                                        </button>
                                      </div>
                                    )}

                                    {outcome && (
                                      <div
                                        className={`rounded-xl border p-2.5 text-[11px] space-y-1 ${
                                          outcome.ok
                                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                                            : 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                                        }`}
                                      >
                                        <div className="font-semibold flex items-center justify-between">
                                          <span>
                                            Replay {outcome.ok ? 'succeeded' : 'failed'}
                                          </span>
                                          <span className="font-mono">
                                            {formatDurationCompact(outcome.durationMs)}
                                          </span>
                                        </div>
                                        <pre className="whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
                                          {outcome.text}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}

                            {step.kind === 'model_call' && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                                <div>
                                  Status: <strong className="uppercase">{step.status}</strong> · Est.
                                  input tokens:{' '}
                                  {(step.estimatedTokens ?? trace.estimatedPromptTokens).toLocaleString()}
                                </div>
                                {step.error && (
                                  <div className="text-rose-500 font-mono">{step.error}</div>
                                )}
                              </div>
                            )}

                            {step.kind === 'approval_wait' && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                Write-approval gate resolution:{' '}
                                <strong className="uppercase">{step.decision}</strong>
                                {step.reason ? ` — ${step.reason}` : ''}
                              </div>
                            )}

                            {step.kind === 'fallback' && (
                              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                                Switched <code>{step.from}</code> → <code>{step.to}</code>:{' '}
                                {step.reason}
                              </div>
                            )}

                            {step.kind === 'rag' && (
                              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                Retrieved {step.chunksCount} chunk(s) from{' '}
                                {step.sourceChars.toLocaleString()} attachment chars.
                              </div>
                            )}

                            {step.kind === 'injection_warning' && (
                              <div className="text-[11px] text-rose-600 dark:text-rose-400">
                                Signals detected: {step.signals.join(', ')}. Subsequent write tools
                                forced manual approval.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Export Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="copy-trace-md-btn"
                  onClick={() =>
                    void copyText('trace_md', formatTraceAsMarkdown(trace, messageTitle, knownSecrets))
                  }
                  style={{
                    backgroundColor: 'var(--m3-surface-container-high)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="min-h-[44px] rounded-full border text-sm font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center justify-center gap-2 hover:opacity-90"
                >
                  {copiedId === 'trace_md' ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Wrench className="w-4 h-4" />
                  )}
                  <span>{copiedId === 'trace_md' ? 'Copied Markdown' : 'Copy Markdown'}</span>
                </button>

                <button
                  type="button"
                  data-testid="export-run-trace-btn"
                  onClick={handleDownloadJson}
                  style={{
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }}
                  className="min-h-[44px] rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90"
                >
                  <Download className="w-4 h-4" />
                  <span>Export Trace JSON</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
