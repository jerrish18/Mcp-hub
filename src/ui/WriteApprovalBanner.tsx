import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  Code2,
  GitCompareArrows,
  ListChecks,
  MessageSquareX,
  Server,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { AlwaysAllowDuration, ApprovalResolution, PendingApproval } from '../types';
import { M3_SPRING } from '../utils/motion';
import { buildApprovalBeforeAfterDiff } from '../utils/proFeatures';

interface WriteApprovalBannerProps {
  approval: PendingApproval;
  onDecision: (result: ApprovalResolution) => void;
}

const DENY_SUGGESTIONS = [
  'Use read-only preview first',
  'Adjust parameters before running',
  'Skip this write step',
];

function formatKeyLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function WriteApprovalBanner({ approval, onDecision }: WriteApprovalBannerProps) {
  const [viewMode, setViewMode] = useState<'fields' | 'diff' | 'json'>('fields');
  const [draftArgs, setDraftArgs] = useState<Record<string, unknown>>(() => ({
    ...approval.arguments,
  }));
  const [argsText, setArgsText] = useState(() => JSON.stringify(approval.arguments, null, 2));
  const [argsError, setArgsError] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [denyPanelOpen, setDenyPanelOpen] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [alwaysDuration, setAlwaysDuration] = useState<AlwaysAllowDuration>('24h');

  const argEntries = useMemo(() => Object.entries(draftArgs), [draftArgs]);
  const diffEntries = useMemo(
    () => buildApprovalBeforeAfterDiff(approval.toolName, draftArgs),
    [approval.toolName, draftArgs]
  );

  const handleFieldChange = (key: string, nextValue: unknown) => {
    const nextArgs = { ...draftArgs, [key]: nextValue };
    setDraftArgs(nextArgs);
    setArgsText(JSON.stringify(nextArgs, null, 2));
    setArgsError('');
    setIsDirty(true);
  };

  const handleSwitchMode = (nextMode: 'fields' | 'diff' | 'json') => {
    if (nextMode === viewMode) return;
    if (viewMode === 'json' && nextMode !== 'json') {
      try {
        const parsed = JSON.parse(argsText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setArgsError('JSON must be an object before switching to Structured Fields.');
          return;
        }
        setDraftArgs(parsed as Record<string, unknown>);
        setArgsError('');
      } catch {
        setArgsError('Fix invalid JSON syntax before switching to Structured Fields.');
        return;
      }
    } else {
      setArgsText(JSON.stringify(draftArgs, null, 2));
      setArgsError('');
    }
    setViewMode(nextMode);
  };

  const resolveCurrentArguments = (): Record<string, unknown> | undefined => {
    if (!isDirty && viewMode === 'fields') return undefined;
    if (viewMode === 'json') {
      try {
        const parsed = JSON.parse(argsText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setArgsError('Arguments must be a JSON object.');
          return undefined;
        }
        setArgsError('');
        return parsed as Record<string, unknown>;
      } catch {
        setArgsError('Invalid JSON syntax. Fix before approving.');
        return undefined;
      }
    }
    return draftArgs;
  };

  const handleApprove = (decision: 'approve' | 'always_allow') => {
    const durationMeta =
      decision === 'always_allow' ? { alwaysAllowDuration: alwaysDuration } : {};
    if (isDirty || viewMode === 'json') {
      const edited = resolveCurrentArguments();
      if (!edited) return;
      onDecision({ decision, editedArguments: edited, ...durationMeta });
      return;
    }
    onDecision({ decision, ...durationMeta });
  };

  const isDestructive = Boolean(approval.isDestructive);
  const hasInjectionWarning = Boolean(approval.injectionWarning);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={M3_SPRING}
      role="alertdialog"
      aria-label={`Confirm write action ${approval.toolName}`}
      data-testid="write-approval-banner"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: isDestructive ? '#e11d48' : 'var(--m3-outline)',
      }}
      className="mx-3 sm:mx-6 mb-3 rounded-[24px] border shadow-lg overflow-hidden"
    >
      {/* Risk Tier Header Strip */}
      <div
        className={`px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap ${
          isDestructive
            ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/70'
            : 'bg-amber-50/90 dark:bg-amber-950/35 border-amber-200/80 dark:border-amber-900/60'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isDestructive
                ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300'
                : 'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300'
            }`}
          >
            {isDestructive ? (
              <AlertOctagon className="w-5 h-5" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                  isDestructive
                    ? 'bg-rose-600 text-white'
                    : 'bg-amber-500/20 text-amber-900 dark:text-amber-200'
                }`}
              >
                {isDestructive ? 'Destructive Action' : 'Write Approval'}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                <Server className="w-3 h-3" />
                {approval.serverName}
              </span>
            </div>
            <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white mt-1 break-all">
              <span className="font-mono">{approval.toolName}</span>
            </h3>
            {approval.description && (
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                {approval.description}
              </p>
            )}
          </div>
        </div>

        {/* Fields / Raw JSON Switcher */}
        <div
          style={{ backgroundColor: 'var(--m3-surface)' }}
          className="inline-flex items-center p-0.5 rounded-full border border-slate-200 dark:border-slate-700 shrink-0"
        >
          <button
            type="button"
            data-testid="approval-mode-fields"
            onClick={() => handleSwitchMode('fields')}
            style={
              viewMode === 'fields'
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }
                : undefined
            }
            className="min-h-[30px] px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>Fields</span>
          </button>
          <button
            type="button"
            data-testid="approval-mode-diff"
            onClick={() => handleSwitchMode('diff')}
            style={
              viewMode === 'diff'
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }
                : undefined
            }
            className="min-h-[30px] px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
          >
            <GitCompareArrows className="w-3.5 h-3.5" />
            <span>Diff</span>
          </button>
          <button
            type="button"
            data-testid="approval-mode-json"
            onClick={() => handleSwitchMode('json')}
            style={
              viewMode === 'json'
                ? {
                    backgroundColor: 'var(--m3-primary-container)',
                    color: 'var(--m3-on-primary-container)',
                  }
                : undefined
            }
            className="min-h-[30px] px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Raw JSON</span>
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {hasInjectionWarning && (
          <div
            role="alert"
            data-testid="approval-injection-warning"
            className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-3 py-2.5 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200"
          >
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <div className="space-y-0.5">
              <div className="font-semibold">Prompt-Injection Guard Triggered</div>
              <p className="leading-relaxed">{approval.injectionWarning}</p>
            </div>
          </div>
        )}

        {/* Structured Field-Level Editor or Raw JSON */}
        {viewMode === 'fields' ? (
          argEntries.length === 0 ? (
            <div
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="rounded-xl border px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400"
            >
              No parameters required for this action.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-0.5">
              {argEntries.map(([key, val]) => {
                const isComplex = typeof val === 'object' && val !== null;
                const isBool = typeof val === 'boolean';
                const isNumber = typeof val === 'number';
                const strVal = isComplex ? JSON.stringify(val, null, 2) : String(val ?? '');
                const isLong = strVal.length > 64 || strVal.includes('\n');

                return (
                  <div
                    key={key}
                    style={{
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className={`rounded-xl border p-2.5 space-y-1.5 ${
                      isComplex || isLong ? 'sm:col-span-2' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`approval-arg-${key}`}
                        className="text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                      >
                        {formatKeyLabel(key)}
                      </label>
                      <span className="font-mono text-[10px] text-slate-400">
                        {Array.isArray(val) ? 'array' : typeof val}
                      </span>
                    </div>

                    {isBool ? (
                      <button
                        id={`approval-arg-${key}`}
                        type="button"
                        role="switch"
                        aria-checked={val}
                        onClick={() => handleFieldChange(key, !val)}
                        style={
                          val
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                              }
                            : undefined
                        }
                        className="min-h-[34px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold"
                      >
                        {val ? 'true' : 'false'}
                      </button>
                    ) : isComplex || isLong ? (
                      <textarea
                        id={`approval-arg-${key}`}
                        rows={isComplex ? 3 : 2}
                        value={strVal}
                        onChange={(e) => {
                          if (!isComplex) {
                            handleFieldChange(key, e.target.value);
                            return;
                          }
                          try {
                            handleFieldChange(key, JSON.parse(e.target.value));
                          } catch {
                            setArgsError(`Field "${key}" requires valid JSON.`);
                          }
                        }}
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="w-full p-2 rounded-lg border text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
                      />
                    ) : (
                      <input
                        id={`approval-arg-${key}`}
                        type={isNumber ? 'number' : 'text'}
                        value={strVal}
                        onChange={(e) =>
                          handleFieldChange(
                            key,
                            isNumber ? Number(e.target.value) : e.target.value
                          )
                        }
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="w-full min-h-[36px] px-2.5 rounded-lg border text-xs text-slate-900 dark:text-white focus:outline-none"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : viewMode === 'diff' ? (
          <div
            data-testid="approval-diff-view"
            className="space-y-2 max-h-60 overflow-y-auto pr-0.5"
          >
            {diffEntries.length === 0 ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500">
                No write payload changes to diff.
              </div>
            ) : (
              diffEntries.map((entry) => (
                <div
                  key={entry.field}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-950 text-slate-100"
                >
                  <div className="px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] font-mono text-slate-300 flex items-center justify-between">
                    <span>{entry.field}</span>
                    <span className="text-[10px] text-slate-400">Before / After</span>
                  </div>
                  <div className="p-2 font-mono text-[11px] leading-relaxed overflow-x-auto space-y-0.5">
                    {entry.lines.map((line, li) => (
                      <div
                        key={li}
                        className={
                          line.kind === 'added'
                            ? 'bg-emerald-950/70 text-emerald-300 px-1.5 rounded'
                            : line.kind === 'removed'
                              ? 'bg-rose-950/70 text-rose-300 px-1.5 rounded'
                              : 'text-slate-400 px-1.5'
                        }
                      >
                        <span className="select-none mr-1.5 opacity-70">
                          {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
                        </span>
                        <span className="whitespace-pre-wrap break-all">{line.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <textarea
            aria-label="Edit tool arguments JSON"
            rows={5}
            value={argsText}
            onChange={(e) => {
              setArgsText(e.target.value);
              setArgsError('');
              setIsDirty(true);
            }}
            className="w-full p-3 rounded-xl bg-slate-950 text-slate-100 text-xs font-mono border border-slate-700 focus:outline-none"
          />
        )}

        {argsError && <div className="text-xs font-medium text-rose-600 dark:text-rose-400">{argsError}</div>}

        {denyPanelOpen && (
          <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/30 p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Guide the assistant on what to do instead (optional)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DENY_SUGGESTIONS.map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setDenyReason(hint)}
                  style={{
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="px-2.5 py-1 rounded-full border text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:opacity-85"
                >
                  {hint}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onDecision({
                      decision: 'deny',
                      denyReason: denyReason.trim() || undefined,
                    });
                  }
                }}
                placeholder="Explain why or request changes..."
                aria-label="Denial reason"
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="flex-1 min-h-[38px] px-3 rounded-xl border text-xs text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() =>
                  onDecision({
                    decision: 'deny',
                    denyReason: denyReason.trim() || undefined,
                  })
                }
                className="min-h-[38px] px-4 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap"
              >
                Confirm Deny
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="approval-approve-btn"
            onClick={() => handleApprove('approve')}
            style={{
              backgroundColor: isDestructive ? '#e11d48' : 'var(--m3-primary)',
              color: isDestructive ? '#ffffff' : 'var(--m3-on-primary)',
            }}
            className="min-h-[42px] px-4 py-2 rounded-full text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
          >
            <Check className="w-4 h-4" />
            <span>{isDirty ? 'Approve Edited' : 'Approve & Run'}</span>
          </button>

          {!isDestructive && !hasInjectionWarning && (
            <div className="inline-flex items-center gap-1.5 flex-wrap">
              <select
                aria-label="Always allow duration"
                value={alwaysDuration}
                onChange={(e) => setAlwaysDuration(e.target.value as AlwaysAllowDuration)}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[42px] px-2.5 rounded-full border text-xs font-medium text-slate-800 dark:text-slate-100"
              >
                <option value="1h">1 hour</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="never">Always</option>
              </select>
              <button
                type="button"
                data-testid="approval-always-btn"
                onClick={() => handleApprove('always_allow')}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="min-h-[42px] px-4 py-2 rounded-full border hover:opacity-90 text-slate-900 dark:text-slate-100 text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Always allow</span>
              </button>
            </div>
          )}

          <button
            type="button"
            data-testid="approval-deny-btn"
            onClick={() => setDenyPanelOpen((v) => !v)}
            style={{ backgroundColor: 'var(--m3-surface)' }}
            className="min-h-[42px] px-3.5 py-2 rounded-full border border-rose-300 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
          >
            {denyPanelOpen ? <X className="w-4 h-4" /> : <MessageSquareX className="w-4 h-4" />}
            <span>{denyPanelOpen ? 'Cancel' : 'Deny'}</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
