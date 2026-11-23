import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, Edit3, MessageSquareX, ShieldCheck, X } from 'lucide-react';
import type { ApprovalResolution, PendingApproval } from '../types';
import { M3_SPRING } from '../utils/motion';

interface WriteApprovalBannerProps {
  approval: PendingApproval;
  onDecision: (result: ApprovalResolution) => void;
}

const DENY_SUGGESTIONS = [
  'Use read-only preview first',
  'Ask me before changing parameters',
  'Skip this action',
];

export function WriteApprovalBanner({ approval, onDecision }: WriteApprovalBannerProps) {
  const [editingArgs, setEditingArgs] = useState(false);
  const [argsText, setArgsText] = useState(() => JSON.stringify(approval.arguments, null, 2));
  const [argsError, setArgsError] = useState('');
  const [denyPanelOpen, setDenyPanelOpen] = useState(false);
  const [denyReason, setDenyReason] = useState('');

  const parseEditedArgs = (): Record<string, unknown> | undefined => {
    if (!editingArgs) return undefined;
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
  };

  const handleApprove = (decision: 'approve' | 'always_allow') => {
    if (editingArgs) {
      const edited = parseEditedArgs();
      if (!edited) return;
      onDecision({ decision, editedArguments: edited });
      return;
    }
    onDecision({ decision });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={M3_SPRING}
      role="alertdialog"
      aria-label={`Confirm write action ${approval.toolName}`}
      data-testid="write-approval-banner"
      className="mx-3 sm:mx-6 mb-3 rounded-[24px] border border-amber-300 dark:border-amber-800 bg-amber-50/95 dark:bg-amber-950/60 p-4 shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Confirm write action: <span className="font-mono">{approval.toolName}</span>
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                {approval.serverName}
                <span aria-hidden="true"> · </span>
                {approval.isDestructive ? 'Destructive action — verify carefully' : 'Modifies external state'}
              </p>
              {approval.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {approval.description}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setEditingArgs((v) => !v);
                setArgsError('');
              }}
              aria-pressed={editingArgs}
              className="min-h-[34px] px-3 rounded-full border border-amber-300 dark:border-amber-700 bg-white/75 dark:bg-slate-900/75 text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{editingArgs ? 'Preview JSON' : 'Edit Arguments'}</span>
            </button>
          </div>

          {editingArgs ? (
            <div className="space-y-1.5">
              <textarea
                aria-label="Edit tool arguments JSON"
                rows={4}
                value={argsText}
                onChange={(e) => {
                  setArgsText(e.target.value);
                  setArgsError('');
                }}
                className="w-full p-2.5 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono border border-slate-700 focus:outline-none"
              />
              {argsError && <div className="text-xs text-rose-700 dark:text-rose-300">{argsError}</div>}
            </div>
          ) : (
            <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto max-h-36">
              {JSON.stringify(approval.arguments, null, 2)}
            </pre>
          )}

          {denyPanelOpen && (
            <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-white/85 dark:bg-slate-900/85 p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Tell the assistant why you denied this action (optional)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DENY_SUGGESTIONS.map((hint) => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => setDenyReason(hint)}
                    className="px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  placeholder="Optional instruction for the agent..."
                  aria-label="Denial reason"
                  className="flex-1 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleApprove('approve')}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
            >
              <Check className="w-4 h-4" />
              <span>{editingArgs ? 'Approve Edited' : 'Approve'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleApprove('always_allow')}
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="min-h-[44px] px-4 py-2 rounded-full border hover:opacity-90 text-slate-900 dark:text-slate-100 text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Always allow tool</span>
            </button>
            <button
              type="button"
              onClick={() => setDenyPanelOpen((v) => !v)}
              style={{ backgroundColor: 'var(--m3-surface-container)' }}
              className="min-h-[44px] px-3.5 py-2 rounded-full border border-rose-300 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
            >
              {denyPanelOpen ? <X className="w-4 h-4" /> : <MessageSquareX className="w-4 h-4" />}
              <span>{denyPanelOpen ? 'Cancel' : 'Deny'}</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
