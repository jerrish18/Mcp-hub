import { useEffect, useState } from 'react';
import type { PendingApproval } from '../types';
import { approvalChanges, githubApprovalReads } from '../utils/approvalDiff';

export type LoadApprovalBefore = (
  approval: PendingApproval, args: Record<string, unknown>, signal: AbortSignal
) => Promise<Record<string, string>>;

export function ApprovalChangePreview({ approval, args, loadBefore }: {
  approval: PendingApproval;
  args: Record<string, unknown>;
  loadBefore?: LoadApprovalBefore;
}) {
  const [before, setBefore] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!loadBefore || !githubApprovalReads(approval, args).length) return;
    const controller = new AbortController();
    setLoading(true);
    void loadBefore(approval, args, controller.signal).then((data) => {
      if (!controller.signal.aborted) setBefore(data);
    }).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [approval, args, loadBefore]);

  return (
    <section aria-label="Proposed changes" className="max-h-[40vh] space-y-2 overflow-auto">
      {loading && <p role="status" className="text-xs">Fetching current files…</p>}
      {approvalChanges(approval.arguments, args, before).map((change, index) => (
        <details key={index} className="rounded-xl border border-slate-300 dark:border-slate-700" open={index === 0}>
          <summary className="min-h-[44px] cursor-pointer p-3 text-xs font-semibold">{change.name}</summary>
          {change.hasBefore && change.parts ? (
            <pre className="overflow-auto p-2 text-xs">
              {change.parts.filter((part) => part.added || part.removed).map((part, partIndex) => (
                <code key={partIndex} className={`block ${part.added ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>
                  {part.value.replace(/\n$/, '').split('\n').map((line) => (part.added ? '+ ' : '− ') + line).join('\n')}
                </code>
              ))}
              {change.parts.every((part) => !part.added && !part.removed) && 'No differences.'}
            </pre>
          ) : <>
            <p className="px-3 text-xs text-slate-600 dark:text-slate-300">
              {change.hasBefore ? 'The diff is too large to show.' : 'Before value unavailable. Proposed value below.'}
            </p>
            <pre className="overflow-auto whitespace-pre-wrap break-all p-3 text-xs">{change.next}</pre>
          </>}
          {change.truncated && <p className="p-3 text-xs">Preview limited to the first 12,000 characters.</p>}
        </details>
      ))}
    </section>
  );
}
