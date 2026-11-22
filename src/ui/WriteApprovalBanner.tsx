import { motion } from 'motion/react';
import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react';
import type { PendingApproval } from '../types';
import { M3_SPRING } from '../utils/motion';

interface WriteApprovalBannerProps {
  approval: PendingApproval;
  onDecision: (decision: 'approve' | 'always_allow' | 'deny') => void;
}

export function WriteApprovalBanner({ approval, onDecision }: WriteApprovalBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={M3_SPRING}
      role="alertdialog"
      aria-label={`Confirm write action ${approval.toolName}`}
      data-testid="write-approval-banner"
      className="mx-3 sm:mx-6 mb-3 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/95 dark:bg-amber-950/50 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Confirm write action: <span className="font-mono">{approval.toolName}</span>
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            {approval.serverName}
            <span aria-hidden="true"> · </span>
            {approval.isDestructive ? 'Marked destructive by server' : 'Modifies state'}
          </p>
          <pre className="mt-2.5 p-2.5 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto max-h-32">
            {JSON.stringify(approval.arguments, null, 2)}
          </pre>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onDecision('approve')}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
            >
              <Check className="w-4 h-4" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => onDecision('always_allow')}
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="min-h-[44px] px-4 py-2 rounded-full border hover:opacity-90 text-slate-900 dark:text-slate-100 text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Always allow this tool
            </button>
            <button
              type="button"
              onClick={() => onDecision('deny')}
              style={{ backgroundColor: 'var(--m3-surface-container)' }}
              className="min-h-[44px] px-4 py-2 rounded-full border border-rose-300 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-sm font-medium inline-flex items-center gap-1.5 transition-transform active:scale-95 whitespace-nowrap"
            >
              <X className="w-4 h-4" />
              Deny
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
