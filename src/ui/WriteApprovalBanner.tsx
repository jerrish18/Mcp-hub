import { AlertTriangle, Check, ShieldCheck, X } from 'lucide-react';
import type { PendingApproval } from '../types';

interface WriteApprovalBannerProps {
  approval: PendingApproval;
  onDecision: (decision: 'approve' | 'always_allow' | 'deny') => void;
}

export function WriteApprovalBanner({ approval, onDecision }: WriteApprovalBannerProps) {
  return (
    <div
      role="alertdialog"
      aria-label={`Confirm write action ${approval.toolName}`}
      data-testid="write-approval-banner"
      className="mx-3 sm:mx-6 mb-3 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 p-4 shadow-sm"
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
              className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Check className="w-4 h-4" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => onDecision('always_allow')}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Always allow this tool
            </button>
            <button
              type="button"
              onClick={() => onDecision('deny')}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <X className="w-4 h-4" />
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
