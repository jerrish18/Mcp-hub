import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  ShieldAlert,
  Slash,
  Wrench,
} from 'lucide-react';
import type { ToolCallRecord } from '../types';
import { M3_EMPHASIZED_EASE, M3_FAST_EASE } from '../utils/motion';

interface ToolCallCardProps {
  record: ToolCallRecord;
}

const STATUS_META: Record<
  ToolCallRecord['status'],
  { label: string; colorClass: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  pending_approval: {
    label: 'Approval needed',
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
    label: 'Done',
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

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return 'no arguments';
  const [firstKey, firstVal] = entries[0];
  const valStr = typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal);
  const compact = `${firstKey}: ${valStr}`.replace(/\s+/g, ' ');
  return compact.length > 48 ? `${compact.slice(0, 48)}…` : compact;
}

export function ToolCallCard({ record }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const meta = STATUS_META[record.status];
  const StatusIcon = meta.Icon;

  const handleCopyResult = async () => {
    if (!record.result) return;
    try {
      await navigator.clipboard?.writeText(record.result);
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={M3_EMPHASIZED_EASE}
      data-testid="tool-call-card"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="my-1.5 rounded-2xl border overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={`Tool call ${record.toolName} on ${record.serverName}, status ${meta.label}`}
        className="w-full min-h-[46px] px-3.5 py-2 flex items-center justify-between gap-3 text-left hover:bg-slate-200/35 dark:hover:bg-slate-800/45 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
            className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300"
          >
            <Wrench className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate font-mono">
                {record.toolName}
              </span>
              <span className="hidden md:inline text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[220px] font-mono">
                ({summarizeArgs(record.arguments)})
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 truncate">
              <span className="truncate">{record.serverName}</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{record.isReadOnly ? 'Read' : 'Write'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {typeof record.durationMs === 'number' && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums font-mono">
              <Clock className="w-3 h-3" />
              {record.durationMs}ms
            </span>
          )}
          <span className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap ${meta.colorClass}`}>
            <StatusIcon className={`w-3.5 h-3.5 ${meta.spin ? 'animate-spin' : ''}`} />
            <span>{meta.label}</span>
          </span>
          <motion.span
            initial={false}
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={M3_FAST_EASE}
            className="inline-flex text-slate-400"
          >
            <ChevronRight className="w-4 h-4" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="tool-details"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={M3_FAST_EASE}
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="border-t px-3.5 py-3 space-y-3 text-xs"
          >
            <div>
              <div className="font-medium text-slate-600 dark:text-slate-400 mb-1">Arguments</div>
              <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono overflow-x-auto leading-relaxed">
                {JSON.stringify(record.arguments, null, 2)}
              </pre>
            </div>
            {record.result !== undefined && (
              <div>
                <div className="flex items-center justify-between font-medium text-slate-600 dark:text-slate-400 mb-1">
                  <div className="flex items-center gap-2">
                    <span>Output</span>
                    {typeof record.durationMs === 'number' && (
                      <span className="tabular-nums font-mono text-[11px] opacity-75">
                        {record.durationMs}ms
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyResult()}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    {copiedResult ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedResult ? 'Copied' : 'Copy'}</span>
                  </button>
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
