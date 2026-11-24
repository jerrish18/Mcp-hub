import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Ban, CheckCircle2, Clock, Copy, Download, XCircle } from 'lucide-react';
import type { RunTrace, RunTraceStep } from '../../types';
import type { TraceToolRetry } from '../../services/llm/agentLoop';
import { BottomSheet } from '../../ui/BottomSheet';
import { traceDuration, traceMarkdown, tracePercentages, traceServerStats, traceSteps, traceSummary } from '../../utils/runTrace';

const BUTTON = 'min-h-[44px] rounded-lg border border-slate-300 px-3 text-xs font-medium dark:border-slate-700';
const FILTERS = ['All', 'Tools', 'Models', 'Errors'] as const;
type Filter = (typeof FILTERS)[number];
const STATUS = {
  running: { Icon: Clock, tone: 'text-blue-600 dark:text-blue-300', bar: 'bg-blue-500' },
  success: { Icon: CheckCircle2, tone: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  error: { Icon: XCircle, tone: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500' },
  warning: { Icon: AlertTriangle, tone: 'text-amber-800 dark:text-amber-300', bar: 'bg-amber-500' },
  denied: { Icon: Ban, tone: 'text-rose-700 dark:text-rose-300', bar: 'bg-rose-500' },
  cancelled: { Icon: Ban, tone: 'text-slate-600 dark:text-slate-300', bar: 'bg-slate-500' },
};

function matchesFilter(step: RunTraceStep, filter: Filter) {
  if (filter === 'Tools') return step.type === 'tool_call' || step.type === 'approval_wait';
  if (filter === 'Models') return step.type === 'model_call' || step.type === 'fallback';
  if (filter === 'Errors') return ['error', 'denied', 'warning'].includes(step.status);
  return true;
}

function TracePreview({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const shortened = text.length > 200 && !expanded;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <button type="button" className={BUTTON} onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
        }}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-100 p-2 dark:bg-slate-900">
        {shortened ? text.slice(0, 200) + '…' : text}
      </pre>
      {text.length > 200 && <button type="button" className="min-h-[44px] underline" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>}
    </div>
  );
}

function RetryEditor({ step, onRetry }: { step: RunTraceStep; onRetry: (retry: TraceToolRetry) => void }) {
  const [editing, setEditing] = useState(false);
  const [args, setArgs] = useState(step.argumentsPreview ?? '{}');
  const [error, setError] = useState('');
  if (!step.serverId || !step.toolName || step.status === 'running') return null;
  const { serverId, toolName } = step;
  if (!editing) return <button type="button" className={BUTTON} onClick={() => setEditing(true)}>Retry this tool call</button>;
  return (
    <form className="space-y-2" onSubmit={(event) => {
      event.preventDefault();
      try {
        const parsed: unknown = JSON.parse(args);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || args.includes('[REDACTED]')) {
          throw new Error('Enter a JSON object and replace redacted values.');
        }
        onRetry({ serverId, toolName, args: parsed as Record<string, unknown>, retryCount: step.retryCount });
      } catch {
        setError('Enter a valid JSON object and replace any redacted fields.');
      }
    }}>
      <label className="block">
        Arguments for retry
        <textarea rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2 font-mono dark:border-slate-700"
          value={args} onChange={(event) => { setArgs(event.target.value); setError(''); }} />
      </label>
      {error && <p role="alert" className="text-rose-700 dark:text-rose-300">{error}</p>}
      <button className={BUTTON} type="submit">Run retry</button>
    </form>
  );
}

function Timeline({ trace, filter = 'All', compact = false, onRetry }: {
  trace: RunTrace;
  filter?: Filter;
  compact?: boolean;
  onRetry?: (retry: TraceToolRetry) => void;
}) {
  const steps = traceSteps(trace);
  const live = steps.some((step) => step.status === 'running');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 150);
    return () => window.clearInterval(timer);
  }, [live]);
  const elapsed = live ? Math.max(trace.durationMs, now - trace.startedAt) : trace.durationMs;
  const visible = steps.filter((step) => matchesFilter(step, filter));
  if (!visible.length) return <p className="text-xs text-slate-600 dark:text-slate-300">No matching steps.</p>;
  return (
    <ol className="space-y-1 border-l border-slate-200 pl-3 dark:border-slate-700">
      {visible.map((step) => {
        const { Icon, tone, bar } = STATUS[step.status];
        const { start, width, duration } = tracePercentages(step, elapsed, elapsed);
        const slow = duration >= 2000;
        const heading = (
          <span className="flex min-h-[44px] items-center gap-2">
            <Icon aria-label={step.status} className={`h-4 w-4 shrink-0 ${tone} ${step.status === 'running' ? 'motion-safe:animate-pulse' : ''}`} />
            <span className="min-w-0 flex-1 break-words text-xs font-medium">{step.label}</span>
            <span className={`shrink-0 text-xs tabular-nums ${slow ? 'font-semibold text-amber-800 dark:text-amber-300' : ''}`}>
              {traceDuration(duration)}{slow ? ' · Slow' : ''}
            </span>
          </span>
        );
        return (
          <li key={step.id} className="text-slate-800 dark:text-slate-100">
            {compact ? heading : (
              <details className="rounded-lg px-2 open:bg-slate-200/50 dark:open:bg-slate-800/60">
                <summary className="list-none cursor-pointer">{heading}</summary>
                <div className="space-y-2 pb-3 text-xs">
                  <p>{traceDuration(step.startOffsetMs)} into run · {step.status}{step.decision ? ` · ${step.decision}` : ''}</p>
                  {step.estimatedInputTokens !== undefined && <p>{step.estimatedInputTokens} estimated tokens in · {step.estimatedOutputTokens ?? 0} out</p>}
                  {step.originalChars !== undefined && <p>{step.keptChars} of {step.originalChars} result characters kept</p>}
                  {Boolean(step.retryCount) && <p>Retry {step.retryCount}</p>}
                  {step.argumentsPreview && <TracePreview label="Arguments" text={step.argumentsPreview} />}
                  {step.resultPreview && <TracePreview label="Result" text={step.resultPreview} />}
                  {step.type === 'tool_call' && onRetry && <RetryEditor step={step} onRetry={onRetry} />}
                </div>
              </details>
            )}
            <div aria-hidden="true" className="relative mx-2 h-1 rounded-full bg-slate-200 dark:bg-slate-700">
              <span className={`absolute h-full min-w-[2px] rounded-full ${bar}`} style={{ left: `min(${start}%, calc(100% - 2px))`, width: `${width}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function RunTraceChip({ trace, onOpen }: { trace: RunTrace; onOpen: () => void }) {
  return (
    <details className="w-full max-w-xl rounded-xl border border-slate-200 px-3 dark:border-slate-700">
      <summary data-testid="run-trace-chip" className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-xs">
        <Activity className="h-4 w-4 shrink-0" />{traceSummary(trace)}
      </summary>
      <div className="space-y-2 pb-2">
        <Timeline trace={trace} compact />
        <button type="button" data-testid="open-run-trace-btn" onClick={onOpen} className={BUTTON}>Open full trace</button>
      </div>
    </details>
  );
}

interface RunTraceSheetProps {
  open: boolean;
  trace: RunTrace | null;
  messageTitle?: string;
  history: Array<{ id: string; trace: RunTrace }>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onRetry?: (retry: TraceToolRetry) => void;
  onClose: () => void;
}

export function RunTraceSheet({ open, trace, messageTitle, history, selectedId, onSelect, onRetry, onClose }: RunTraceSheetProps) {
  const [filter, setFilter] = useState<Filter>('All');
  const [copied, setCopied] = useState(false);
  const stats = traceServerStats(history.map((item) => item.trace));
  return (
    <BottomSheet open={open && Boolean(trace)} onClose={onClose} title="Execution Run Trace" subtitle={messageTitle}>
      {trace && (
        <div className="space-y-4 text-slate-900 dark:text-slate-100">
          {history.length > 1 && (
            <select aria-label="Trace history" className={BUTTON + ' w-full bg-white dark:bg-slate-900'}
              value={selectedId} onChange={(event) => { setCopied(false); setFilter('All'); onSelect(event.target.value); }}>
              {history.map(({ id, trace: item }) => (
                <option key={id} value={id}>{new Date(item.startedAt).toLocaleTimeString()} · {traceSummary(item)}</option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}
                className={BUTTON + (filter === item ? ' bg-blue-100 dark:bg-blue-950' : '')}>{item}</button>
            ))}
          </div>
          <Timeline key={trace.startedAt} trace={trace} filter={filter} onRetry={onRetry} />
          {stats.length > 0 && (
            <section aria-label="Server statistics" className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
              <h3 className="mb-2 font-semibold">Server statistics</h3>
              {stats.map((server, index) => (
                <p key={index}>{server.name} · {server.calls} calls · {traceDuration(server.averageMs)} avg · {Math.round(server.errorRate * 100)}% errors</p>
              ))}
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="export-run-trace-btn" className={BUTTON} onClick={() => {
              const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `mcphub-run-trace-${trace.startedAt}.json`;
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}><Download className="mr-1 inline h-4 w-4" />Export JSON</button>
            <button type="button" className={BUTTON} onClick={() => {
              void navigator.clipboard?.writeText(traceMarkdown(trace)).then(() => setCopied(true)).catch(() => {});
            }}><Copy className="mr-1 inline h-4 w-4" />{copied ? 'Copied' : 'Copy Markdown summary'}</button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
