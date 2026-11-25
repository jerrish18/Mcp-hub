import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Database,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { ModelConfig, RunTrace, RunTraceStep } from '../../types';
import {
  buildTraceSummaryChipText,
  countTraceIssues,
  formatDurationCompact,
  normalizeTraceSteps,
  SLOW_STEP_THRESHOLD_MS,
} from '../../utils/runTrace';

interface InlineRunTraceBarProps {
  trace: RunTrace;
  dynamicModels?: ModelConfig[];
  onOpenFullWaterfall: () => void;
}

function StepMiniIcon({ step }: { step: RunTraceStep }) {
  if (step.kind === 'tool_call') {
    if (step.status === 'running') {
      return <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />;
    }
    if (step.status === 'success') {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />;
    }
    return <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  }
  if (step.kind === 'model_call') {
    if (step.status === 'running') {
      return <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />;
    }
    if (step.status === 'error') {
      return <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
    }
    return <Cpu className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
  }
  if (step.kind === 'approval_wait') {
    return step.decision === 'deny' ? (
      <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
    ) : (
      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
    );
  }
  if (step.kind === 'fallback') {
    return <ArrowRight className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }
  if (step.kind === 'injection_warning') {
    return <ShieldAlert className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  }
  return <Database className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
}

function describeStepLabel(step: RunTraceStep): string {
  switch (step.kind) {
    case 'model_call':
      return `Model · ${step.modelId}`;
    case 'tool_call':
      return `${step.serverName}/${step.toolName}`;
    case 'approval_wait':
      return `Approval (${step.decision}) · ${step.toolName}`;
    case 'rag':
      return `Local RAG · ${step.chunksCount} chunk${step.chunksCount === 1 ? '' : 's'}`;
    case 'fallback':
      return `Fallback · ${step.from} → ${step.to}`;
    case 'injection_warning':
      return `Injection Guard · ${step.toolName}`;
  }
}

export function InlineRunTraceBar({
  trace,
  dynamicModels,
  onOpenFullWaterfall,
}: InlineRunTraceBarProps) {
  const [expanded, setExpanded] = useState(false);
  const summaryText = buildTraceSummaryChipText(trace, dynamicModels);
  const { errors, warnings } = countTraceIssues(trace);
  const steps = normalizeTraceSteps(trace);

  const dotClass = trace.isLive
    ? 'bg-blue-500 animate-pulse'
    : errors > 0
      ? 'bg-rose-500'
      : warnings > 0
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  return (
    <div className="pt-0.5 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="inline-trace-chip"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: errors > 0 ? 'rgba(244, 63, 94, 0.35)' : 'var(--m3-outline)',
          }}
          className="min-h-[34px] px-3 py-1 rounded-full border text-xs text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:opacity-90 transition-opacity max-w-full"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
          <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate font-medium">{summaryText}</span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
        </button>

        <button
          type="button"
          data-testid="open-run-trace-btn"
          onClick={onOpenFullWaterfall}
          className="min-h-[34px] px-2.5 rounded-full text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 transition-colors"
        >
          <Wrench className="w-3 h-3" />
          <span>Waterfall</span>
        </button>
      </div>

      {expanded && (
        <div
          data-testid="inline-trace-timeline"
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="rounded-2xl border p-2.5 space-y-1.5"
        >
          {steps.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1 py-0.5">
              No trace events recorded for this turn.
            </p>
          ) : (
            <div className="space-y-1">
              {steps.slice(0, 12).map((step) => {
                const isSlow = step.durationMs >= SLOW_STEP_THRESHOLD_MS;
                return (
                  <div
                    key={step.id}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded-xl text-xs bg-white/50 dark:bg-slate-950/30"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StepMiniIcon step={step} />
                      <span className="font-mono truncate text-slate-800 dark:text-slate-200">
                        {describeStepLabel(step)}
                      </span>
                      {isSlow && (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 inline-flex items-center gap-0.5 shrink-0">
                          <AlertTriangle className="w-3 h-3" />
                          Slow
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                      {formatDurationCompact(step.durationMs)}
                    </span>
                  </div>
                );
              })}
              {steps.length > 12 && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 px-2">
                  +{steps.length - 12} more step(s)
                </div>
              )}
            </div>
          )}

          <div className="pt-1 flex justify-end">
            <button
              type="button"
              onClick={onOpenFullWaterfall}
              style={{
                backgroundColor: 'var(--m3-primary-container)',
                color: 'var(--m3-on-primary-container)',
              }}
              className="min-h-[36px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Open Full Waterfall</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
