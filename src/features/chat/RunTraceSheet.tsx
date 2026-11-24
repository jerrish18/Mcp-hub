import React from 'react';
import { Activity, ArrowRight, CheckCircle2, Clock, Database, Download, XCircle } from 'lucide-react';
import type { RunTrace } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';

interface RunTraceSheetProps {
  open: boolean;
  trace: RunTrace | null;
  messageTitle?: string;
  onClose: () => void;
}

export function RunTraceSheet({ open, trace, messageTitle, onClose }: RunTraceSheetProps) {
  const handleDownloadJson = () => {
    if (!trace) return;
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcphub-run-trace-${trace.startedAt}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <BottomSheet
      open={open && Boolean(trace)}
      onClose={onClose}
      title="Execution Run Trace"
      subtitle={messageTitle || 'Model routing, token estimate, RAG & tool timing telemetry'}
    >
      {trace && (
        <div className="space-y-4">
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
                {trace.durationMs >= 1000
                  ? `${(trace.durationMs / 1000).toFixed(2)}s`
                  : `${trace.durationMs}ms`}
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
                {trace.stepsExecuted}
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-2xl border p-3"
            >
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Est. Prompt Tokens</div>
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

          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-2xl border p-3.5 space-y-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Model Used</span>
              <span className="font-mono text-slate-900 dark:text-white">
                {trace.primaryModelId !== trace.usedModelId
                  ? `${trace.primaryModelId} → ${trace.usedModelId}`
                  : trace.usedModelId}
              </span>
            </div>
            {trace.stoppedByUser && (
              <div className="text-amber-700 dark:text-amber-300 font-medium">
                Run stopped early by user abort signal.
              </div>
            )}
          </div>

          {trace.fallbacks.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Rate-Limit / Model Fallbacks ({trace.fallbacks.length})
              </h3>
              <div className="space-y-1.5">
                {trace.fallbacks.map((fb, idx) => (
                  <div
                    key={`${fb.at}-${idx}`}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-xl border p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center gap-1.5 font-mono text-slate-900 dark:text-white">
                      <span>{fb.from}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                      <span>{fb.to}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{fb.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              MCP Tool Calls ({trace.toolCalls.length})
            </h3>
            {trace.toolCalls.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No external MCP tool calls were executed in this turn.
              </p>
            ) : (
              <div className="space-y-1.5">
                {trace.toolCalls.map((tc) => (
                  <div
                    key={tc.id}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-xl border p-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-mono font-semibold text-slate-900 dark:text-white truncate">
                        {tc.status === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                        )}
                        <span className="truncate">{tc.toolName}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {tc.serverName} · {tc.status}
                        {tc.truncated ? ' · output budgeted' : ''}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                      {tc.durationMs}ms
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid="export-run-trace-btn"
            onClick={handleDownloadJson}
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="w-full min-h-[44px] rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90"
          >
            <Download className="w-4 h-4" />
            <span>Export Trace JSON</span>
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
