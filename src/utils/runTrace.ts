import type { RunTrace, RunTraceStep, RunTraceStepStatus } from '../types';
import { redactSecrets } from './redact';

export const MAX_TRACE_STEPS = 64;
const MAX_TRACE_PREVIEW = 700;
const SENSITIVE_FIELD = /^(?:authorization|cookie|setcookie|password|passwd|secret|clientsecret|token|accesstoken|refreshtoken|apikey|privatekey|headers)$/i;

export function tracePreview(value: unknown, secrets: string[] = []): string {
  if (value === undefined) return '';
  let text: string;
  try {
    let data = value;
    if (typeof value === 'string' && /^\s*[{[]/.test(value)) {
      try { data = JSON.parse(value); } catch { /* Keep original when the result is text. */ }
    }
    text = typeof data === 'string' ? data : JSON.stringify(data, (key, entry) =>
      SENSITIVE_FIELD.test(key.replaceAll(/[-_]/g, '')) ? '[REDACTED]' : entry, 2);
  } catch {
    return 'Preview unavailable';
  }
  const redacted = redactSecrets(text ?? '', secrets);
  return redacted.length > MAX_TRACE_PREVIEW
    ? redacted.slice(0, MAX_TRACE_PREVIEW - 1) + '…'
    : redacted;
}

type StepFields = Omit<RunTraceStep, 'id' | 'startOffsetMs' | 'durationMs' | 'status'>;
type StepUpdate = Partial<Omit<StepFields, 'type' | 'label'>>;

export function createRunTraceRecorder(startedAt: number, onChange: () => void, clock = Date.now) {
  const steps: RunTraceStep[] = [];
  let nextId = 0;

  const start = (fields: StepFields) => {
    const startOffsetMs = Math.max(0, clock() - startedAt);
    const step: RunTraceStep = { ...fields, id: String(++nextId), startOffsetMs, durationMs: 0, status: 'running' };
    if (steps.length >= MAX_TRACE_STEPS) return () => {};
    steps.push(step);
    onChange();
    return (status: RunTraceStepStatus, update?: StepUpdate) => {
      if (step.status !== 'running') return;
      Object.assign(step, update, { status, durationMs: Math.max(0, clock() - startedAt - startOffsetMs) });
      onChange();
    };
  };

  return {
    start,
    snapshot: (stopped = false) => steps.map((step) =>
      stopped && step.status === 'running'
        ? { ...step, status: 'cancelled' as const, durationMs: Math.max(0, clock() - startedAt - step.startOffsetMs) }
        : { ...step }),
  };
}

export function traceSteps(trace: RunTrace): RunTraceStep[] {
  if (trace.steps?.length) return trace.steps;
  return [
    ...trace.fallbacks.map((fallback, index): RunTraceStep => ({
      id: `fallback-${index}`, type: 'fallback', status: 'warning', durationMs: 0,
      label: `${fallback.from} → ${fallback.to}`, startOffsetMs: Math.max(0, fallback.at - trace.startedAt),
      resultPreview: tracePreview(fallback.reason),
    })),
    ...trace.toolCalls.map((call): RunTraceStep => ({
      id: call.id, type: 'tool_call', toolCallId: call.id, toolName: call.toolName, serverName: call.serverName,
      label: `${call.serverName} · ${call.toolName}`, startOffsetMs: 0, durationMs: call.durationMs,
      status: call.status === 'success' || call.status === 'error' || call.status === 'denied' ? call.status : 'cancelled',
    })),
  ];
}

export function traceDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export function traceSummary(trace: RunTrace): string {
  const steps = traceSteps(trace);
  const calls = steps.filter((step) => step.type === 'tool_call').length;
  const warnings = steps.filter((step) => step.status === 'warning' || step.status === 'error').length;
  return [`${calls} tool call${calls === 1 ? '' : 's'}`, traceDuration(trace.durationMs),
    trace.usedModelId, warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}

export function traceMarkdown(trace: RunTrace): string {
  return ['## Run trace', traceSummary(trace), '',
    ...traceSteps(trace).map((step) => `- ${step.label} · ${step.status} · ${traceDuration(step.durationMs)}`)].join('\n');
}

export function traceServerStats(traces: RunTrace[]) {
  const servers = new Map<string, { name: string; calls: number; totalMs: number; errors: number }>();
  for (const trace of traces) {
    for (const step of traceSteps(trace)) {
      if (step.type !== 'tool_call' || !step.serverName || !['success', 'error'].includes(step.status)) continue;
      const key = step.serverId ?? step.serverName;
      const stats = servers.get(key) ?? { name: step.serverName, calls: 0, totalMs: 0, errors: 0 };
      stats.calls++;
      stats.totalMs += step.durationMs;
      if (step.status === 'error') stats.errors++;
      servers.set(key, stats);
    }
  }
  return [...servers.values()].map(({ name, calls, totalMs, errors }) => ({
    name, calls, averageMs: totalMs / calls, errorRate: errors / calls,
  }));
}

export function tracePercentages(step: RunTraceStep, totalMs: number, elapsed: number) {
  const total = Math.max(1, totalMs);
  const start = Math.min(100, step.startOffsetMs / total * 100);
  const duration = step.status === 'running' ? Math.max(0, elapsed - step.startOffsetMs) : step.durationMs;
  return { start, width: Math.min(100 - start, duration / total * 100), duration };
}
