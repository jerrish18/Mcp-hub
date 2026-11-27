import { getModelById, getShortModelName } from '../config/models';
import type { ModelConfig, RunTrace, RunTraceStep } from '../types';
import { redactSecrets } from './redact';

export const SLOW_STEP_THRESHOLD_MS = 3000;

export function redactAndPreview(
  value: unknown,
  maxLen = 280,
  knownSecrets: string[] = []
): string {
  if (value == null) return '';
  let raw: string;
  if (typeof value === 'string') {
    raw = value;
  } else {
    try {
      raw = JSON.stringify(value, null, 2);
    } catch {
      raw = String(value);
    }
  }
  const redacted = redactSecrets(raw, knownSecrets).trim();
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, Math.max(20, maxLen - 1))}…`;
}

export function redactRunTrace(trace: RunTrace, knownSecrets: string[] = []): RunTrace {
  const redactOpt = (v?: string) => (typeof v === 'string' ? redactSecrets(v, knownSecrets) : v);
  return {
    ...trace,
    error: redactOpt(trace.error),
    fallbacks: (trace.fallbacks ?? []).map((fb) => ({
      ...fb,
      reason: redactSecrets(fb.reason, knownSecrets),
    })),
    steps: trace.steps?.map((step) => {
      if (step.kind === 'model_call') {
        return { ...step, error: redactOpt(step.error) };
      }
      if (step.kind === 'tool_call') {
        return {
          ...step,
          argsPreview: redactOpt(step.argsPreview),
          fullArgsJson: redactOpt(step.fullArgsJson),
          resultPreview: redactOpt(step.resultPreview),
          error: redactOpt(step.error),
        };
      }
      if (step.kind === 'approval_wait') {
        return { ...step, reason: redactOpt(step.reason) };
      }
      if (step.kind === 'fallback') {
        return { ...step, reason: redactSecrets(step.reason, knownSecrets) };
      }
      return { ...step };
    }),
  };
}

export function normalizeTraceSteps(trace: RunTrace): RunTraceStep[] {
  if (trace.steps && trace.steps.length > 0) {
    return trace.steps;
  }

  const synthetic: RunTraceStep[] = [];
  let cursor = trace.startedAt;

  if (trace.ragUsed) {
    synthetic.push({
      kind: 'rag',
      id: `rag_legacy_${trace.startedAt}`,
      startedAt: cursor,
      durationMs: 12,
      chunksCount: trace.ragChunksCount ?? 0,
      sourceChars: 0,
    });
    cursor += 12;
  }

  for (let i = 0; i < trace.fallbacks.length; i++) {
    const fb = trace.fallbacks[i];
    synthetic.push({
      kind: 'fallback',
      id: `fb_legacy_${i}`,
      startedAt: fb.at || cursor,
      durationMs: 0,
      from: fb.from,
      to: fb.to,
      reason: fb.reason,
    });
  }

  for (let i = 0; i < trace.toolCalls.length; i++) {
    const tc = trace.toolCalls[i];
    const dur = Math.max(0, tc.durationMs || 0);
    synthetic.push({
      kind: 'tool_call',
      id: tc.id || `tc_legacy_${i}`,
      startedAt: cursor,
      durationMs: dur,
      serverName: tc.serverName,
      toolName: tc.toolName,
      status: tc.status,
      truncated: tc.truncated,
    });
    cursor += dur;
  }

  if (trace.stepsExecuted > 0) {
    const toolsSum = trace.toolCalls.reduce((s, t) => s + (t.durationMs || 0), 0);
    const modelDur = Math.max(0, trace.durationMs - toolsSum);
    synthetic.unshift({
      kind: 'model_call',
      id: `model_legacy_${trace.startedAt}`,
      startedAt: trace.startedAt,
      durationMs: modelDur,
      modelId: trace.usedModelId || trace.primaryModelId,
      status: trace.error ? 'error' : 'ok',
      estimatedTokens: trace.estimatedPromptTokens,
      error: trace.error,
    });
  }

  return synthetic;
}

export function formatDurationCompact(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  if (safe >= 1000) return `${(safe / 1000).toFixed(1)}s`;
  return `${safe}ms`;
}

export function countTraceIssues(trace: RunTrace): {
  errors: number;
  warnings: number;
  toolCount: number;
} {
  const steps = normalizeTraceSteps(trace);
  let errors = trace.error ? 1 : 0;
  let warnings = trace.fallbacks.length + (trace.stoppedByUser ? 1 : 0);

  for (const s of steps) {
    if (s.kind === 'tool_call' && (s.status === 'error' || s.status === 'denied')) {
      errors++;
    } else if (s.kind === 'model_call' && s.status === 'error') {
      errors++;
    } else if (s.kind === 'injection_warning') {
      warnings++;
    } else if (s.kind === 'approval_wait' && s.decision === 'deny') {
      warnings++;
    }
  }

  return {
    errors,
    warnings,
    toolCount: trace.toolCalls.length,
  };
}

export function buildTraceSummaryChipText(
  trace: RunTrace,
  dynamicModels?: ModelConfig[]
): string {
  const model = getModelById(trace.usedModelId || trace.primaryModelId, dynamicModels);
  const shortModel = getShortModelName(model);
  const steps = normalizeTraceSteps(trace);

  if (trace.isLive) {
    const runningTool = [...steps]
      .reverse()
      .find((s) => (s.kind === 'tool_call' && s.status === 'running') || (s.kind === 'approval_wait' && s.decision === 'pending'));
    if (runningTool?.kind === 'tool_call') {
      return `Live · Running ${runningTool.toolName} · ${shortModel}`;
    }
    if (runningTool?.kind === 'approval_wait') {
      return `Live · Waiting approval (${runningTool.toolName})`;
    }
    return `Live · Step ${Math.max(1, trace.stepsExecuted)} · ${shortModel}`;
  }

  const { errors, warnings, toolCount } = countTraceIssues(trace);
  const parts: string[] = [];
  if (toolCount > 0) {
    parts.push(`${toolCount} tool call${toolCount === 1 ? '' : 's'}`);
  } else {
    parts.push('Direct');
  }
  parts.push(formatDurationCompact(trace.durationMs));
  parts.push(shortModel);

  const issueCount = errors + warnings;
  if (issueCount > 0) {
    parts.push(`${issueCount} ${errors > 0 ? 'issue' : 'warning'}${issueCount === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

export type TraceStepFilter = 'all' | 'tools' | 'models' | 'errors';

export function filterTraceSteps(steps: RunTraceStep[], filter: TraceStepFilter): RunTraceStep[] {
  switch (filter) {
    case 'tools':
      return steps.filter((s) => s.kind === 'tool_call' || s.kind === 'approval_wait');
    case 'models':
      return steps.filter((s) => s.kind === 'model_call' || s.kind === 'fallback' || s.kind === 'rag');
    case 'errors':
      return steps.filter(
        (s) =>
          (s.kind === 'tool_call' && (s.status === 'error' || s.status === 'denied' || s.status === 'cancelled')) ||
          (s.kind === 'model_call' && s.status === 'error') ||
          (s.kind === 'approval_wait' && s.decision === 'deny') ||
          s.kind === 'injection_warning' ||
          s.kind === 'fallback' ||
          s.durationMs >= SLOW_STEP_THRESHOLD_MS
      );
    case 'all':
    default:
      return steps;
  }
}

export function formatTraceAsMarkdown(
  trace: RunTrace,
  title = 'Execution Run Trace',
  knownSecrets: string[] = []
): string {
  const safeTrace = redactRunTrace(trace, knownSecrets);
  const steps = normalizeTraceSteps(safeTrace);
  const lines: string[] = [
    `## ${title}`,
    `- **Duration:** ${formatDurationCompact(safeTrace.durationMs)}`,
    `- **Model:** ${safeTrace.primaryModelId !== safeTrace.usedModelId ? `${safeTrace.primaryModelId} → ${safeTrace.usedModelId}` : safeTrace.usedModelId}`,
    `- **Steps Executed:** ${safeTrace.stepsExecuted}`,
    `- **Est. Prompt Tokens:** ${safeTrace.estimatedPromptTokens.toLocaleString()}`,
    `- **Local RAG:** ${safeTrace.ragUsed ? `${safeTrace.ragChunksCount ?? 0} chunks` : 'Direct'}`,
  ];

  if (safeTrace.stoppedByUser) {
    lines.push('- **Status:** Stopped early by user');
  }
  if (safeTrace.error) {
    lines.push(`- **Error:** ${redactSecrets(safeTrace.error, knownSecrets)}`);
  }

  lines.push('', '### Timeline Steps');
  if (steps.length === 0) {
    lines.push('_No recorded timeline steps._');
  } else {
    for (const s of steps) {
      const offsetMs = Math.max(0, s.startedAt - safeTrace.startedAt);
      const offsetStr = `+${formatDurationCompact(offsetMs)}`;
      const durStr = formatDurationCompact(s.durationMs);
      if (s.kind === 'model_call') {
        lines.push(`- \`${offsetStr}\` **Model** (\`${s.modelId}\`) — ${s.status} (${durStr})`);
      } else if (s.kind === 'tool_call') {
        lines.push(
          `- \`${offsetStr}\` **Tool** \`${s.serverName}/${s.toolName}\` — ${s.status} (${durStr})${s.argsPreview ? `\n  - Args: \`${redactSecrets(s.argsPreview, knownSecrets)}\`` : ''}${s.error ? `\n  - Error: ${redactSecrets(s.error, knownSecrets)}` : ''}`
        );
      } else if (s.kind === 'approval_wait') {
        lines.push(
          `- \`${offsetStr}\` **Approval Gate** \`${s.serverName}/${s.toolName}\` — ${s.decision} (${durStr})`
        );
      } else if (s.kind === 'rag') {
        lines.push(
          `- \`${offsetStr}\` **Local RAG** — retrieved ${s.chunksCount} chunk(s) (${durStr})`
        );
      } else if (s.kind === 'fallback') {
        lines.push(
          `- \`${offsetStr}\` **Fallback** \`${s.from}\` → \`${s.to}\` (${redactSecrets(s.reason, knownSecrets)})`
        );
      } else if (s.kind === 'injection_warning') {
        lines.push(
          `- \`${offsetStr}\` **Prompt-Injection Guard** \`${s.serverName}/${s.toolName}\` — ${s.signals.join(', ')}`
        );
      }
    }
  }

  return lines.join('\n');
}

export interface TraceServerStats {
  serverName: string;
  calls: number;
  successes: number;
  errors: number;
  successRatePct: number;
  avgLatencyMs: number;
}

export function aggregateTraceServerStats(traces: RunTrace[]): TraceServerStats[] {
  const byServer = new Map<
    string,
    { calls: number; successes: number; errors: number; totalMs: number }
  >();

  for (const trace of traces) {
    for (const tc of trace.toolCalls) {
      const key = tc.serverName || 'Unknown Server';
      const entry = byServer.get(key) ?? { calls: 0, successes: 0, errors: 0, totalMs: 0 };
      entry.calls++;
      if (tc.status === 'success') entry.successes++;
      else if (tc.status === 'error' || tc.status === 'denied') entry.errors++;
      entry.totalMs += Math.max(0, tc.durationMs || 0);
      byServer.set(key, entry);
    }
  }

  return Array.from(byServer.entries())
    .map(([serverName, s]) => ({
      serverName,
      calls: s.calls,
      successes: s.successes,
      errors: s.errors,
      successRatePct: s.calls > 0 ? Math.round((s.successes / s.calls) * 100) : 100,
      avgLatencyMs: s.calls > 0 ? Math.round(s.totalMs / s.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);
}
