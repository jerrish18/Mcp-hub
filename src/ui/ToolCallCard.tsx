import { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  ShieldAlert,
  Slash,
  Wrench,
} from 'lucide-react';
import type { ToolCallRecord } from '../types';

interface ToolCallCardProps {
  record: ToolCallRecord;
}

const STATUS_META: Record<
  ToolCallRecord['status'],
  { label: string; colorClass: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  pending_approval: {
    label: 'Awaiting Approval',
    colorClass: 'text-amber-700 dark:text-amber-400',
    Icon: ShieldAlert,
  },
  running: {
    label: 'Running',
    colorClass: 'text-blue-700 dark:text-blue-400',
    Icon: Loader2,
    spin: true,
  },
  success: {
    label: 'Completed',
    colorClass: 'text-emerald-700 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  error: {
    label: 'Error',
    colorClass: 'text-rose-700 dark:text-rose-400',
    Icon: AlertCircle,
  },
  denied: {
    label: 'Denied',
    colorClass: 'text-slate-600 dark:text-slate-400',
    Icon: Slash,
  },
  cancelled: {
    label: 'Stopped',
    colorClass: 'text-slate-600 dark:text-slate-400',
    Icon: Slash,
  },
};

export function ToolCallCard({ record }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[record.status];
  const StatusIcon = meta.Icon;

  return (
    <div
      data-testid="tool-call-card"
      className="my-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={`Tool call ${record.toolName} on ${record.serverName}, status ${meta.label}`}
        className="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
            <Wrench className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate font-mono">
              {record.toolName}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
              <span>{record.serverName}</span>
              <span aria-hidden="true">·</span>
              <span>{record.isReadOnly ? 'Read-only' : 'Write action'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {typeof record.durationMs === 'number' && (
            <span className="hidden sm:inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums font-mono">
              <Clock className="w-3 h-3" />
              {record.durationMs}ms
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${meta.colorClass}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${meta.spin ? 'animate-spin' : ''}`} />
            <span>{meta.label}</span>
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 dark:border-slate-800 px-3.5 py-3 space-y-3 bg-slate-50/70 dark:bg-slate-950/50 text-xs">
          <div>
            <div className="font-medium text-slate-600 dark:text-slate-400 mb-1">Arguments</div>
            <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono overflow-x-auto leading-relaxed">
              {JSON.stringify(record.arguments, null, 2)}
            </pre>
          </div>
          {record.result !== undefined && (
            <div>
              <div className="flex items-center justify-between font-medium text-slate-600 dark:text-slate-400 mb-1">
                <span>Result</span>
                {typeof record.durationMs === 'number' && (
                  <span className="tabular-nums font-mono">{record.durationMs}ms</span>
                )}
              </div>
              <pre
                className={`p-2.5 rounded-xl font-mono overflow-x-auto leading-relaxed max-h-56 ${
                  record.isError
                    ? 'bg-rose-950/80 text-rose-100'
                    : 'bg-slate-900 text-slate-100'
                }`}
              >
                {record.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
