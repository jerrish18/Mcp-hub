import { useState } from 'react';
import { CheckCircle2, Circle, Clock, MinusCircle, XCircle } from 'lucide-react';
import { normalizeProPlan, type ProTaskPlan, type ProTaskStepStatus } from '../../utils/proTaskPlan';

const STEP_STATE: Record<ProTaskStepStatus, { label: string; Icon: typeof Circle; tone: string }> = {
  pending: { label: 'Pending', Icon: Circle, tone: 'text-slate-500 dark:text-slate-400' },
  running: { label: 'In progress', Icon: Clock, tone: 'text-blue-700 dark:text-blue-300' },
  completed: { label: 'Completed', Icon: CheckCircle2, tone: 'text-emerald-700 dark:text-emerald-300' },
  failed: { label: 'Failed', Icon: XCircle, tone: 'text-rose-700 dark:text-rose-300' },
  skipped: { label: 'Skipped', Icon: MinusCircle, tone: 'text-slate-500 dark:text-slate-400' },
};

export function ProTaskPlanCard({ plan, onApprove, onCancel }: {
  plan: ProTaskPlan;
  onApprove?: (steps: string[]) => void;
  onCancel?: () => void;
}) {
  const [titles, setTitles] = useState(() => plan.steps.map((step) => step.title));
  const reviewing = plan.status === 'review' && Boolean(onApprove);
  const approvedTitles = normalizeProPlan(titles);
  return (
    <section className="w-full max-w-xl space-y-2 rounded-2xl border border-slate-300 p-3 text-slate-900 dark:border-slate-700 dark:text-slate-100"
      aria-label="Pro task plan" data-testid="pro-task-plan">
      <h3 className="text-sm font-semibold">Pro task plan</h3>
      {reviewing ? (
        <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          if (approvedTitles.length >= 2) onApprove?.(approvedTitles);
        }}>
          <p className="text-xs text-slate-600 dark:text-slate-300">Review or edit the steps before execution starts.</p>
          {titles.map((title, index) => (
            <input key={index} aria-label={`Step ${index + 1}`} value={title} maxLength={180} required
              onChange={(event) => {
                const next = event.target.value;
                setTitles((previous) => previous.map((item, i) => i === index ? next : item));
              }}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm dark:border-slate-700" />
          ))}
          <div className="flex gap-2">
            <button type="submit" disabled={approvedTitles.length < 2}
              className="min-h-[44px] rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Approve plan</button>
            <button type="button" onClick={onCancel}
              className="min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm dark:border-slate-700">Cancel</button>
          </div>
        </form>
      ) : (
        <ol className="space-y-2">
          {plan.steps.map((step, index) => {
            const { label, Icon, tone } = STEP_STATE[step.status];
            return (
              <li key={index} className="flex items-start gap-2 text-sm">
                <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${tone} ${step.status === 'running' ? 'motion-safe:animate-pulse' : ''}`} />
                <span className="min-w-0 flex-1 break-words">{step.title}</span>
                <span className={`shrink-0 text-xs ${tone}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
