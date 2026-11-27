import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  FolderCode,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { getModelById, getShortModelName } from '../../config/models';
import type {
  CodingPhase,
  CodingPlan,
  CodingPlanRequirement,
  CodingPlanTaskStatus,
  ModelConfig,
} from '../../types';

interface CodingPlanCardProps {
  plan: CodingPlan;
  messageId: string;
  dynamicModels: ModelConfig[];
  isRunning: boolean;
  onApprovePlan: (messageId: string) => void;
  onUpdateRequirements: (
    messageId: string,
    requirements: CodingPlanRequirement[],
    extraInstruction?: string
  ) => void;
  onToggleAutoRun: () => void;
  onOpenWorkspace: () => void;
}

const PHASE_LABELS: Record<CodingPhase, string> = {
  idle: 'Ready',
  planning: 'Planning architecture',
  awaiting_approval: 'Plan ready for review',
  executing: 'Executing build tasks',
  verifying: 'Verifying & self-healing',
  completed: 'Build verified',
  failed: 'Verification issues remain',
};

const TASK_STATE: Record<
  CodingPlanTaskStatus,
  { label: string; Icon: typeof Circle; tone: string }
> = {
  pending: { label: 'Pending', Icon: Circle, tone: 'text-slate-500 dark:text-slate-400' },
  in_progress: { label: 'In progress', Icon: Clock, tone: 'text-blue-700 dark:text-blue-300' },
  verifying: { label: 'Verifying', Icon: Wrench, tone: 'text-amber-700 dark:text-amber-300' },
  completed: {
    label: 'Completed',
    Icon: CheckCircle2,
    tone: 'text-emerald-700 dark:text-emerald-300',
  },
  failed: { label: 'Failed', Icon: XCircle, tone: 'text-rose-700 dark:text-rose-300' },
};

export function CodingPlanCard({
  plan,
  messageId,
  dynamicModels,
  isRunning,
  onApprovePlan,
  onUpdateRequirements,
  onToggleAutoRun,
  onOpenWorkspace,
}: CodingPlanCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftReqs, setDraftReqs] = useState<CodingPlanRequirement[]>(plan.requirements);
  const [extraNote, setExtraNote] = useState('');

  useEffect(() => {
    if (!editing) {
      setDraftReqs(plan.requirements);
    }
  }, [plan.requirements, editing]);

  const completedTasks = plan.tasks.filter((t) => t.status === 'completed').length;
  const totalTokens = plan.subagentTraces.reduce((sum, t) => sum + (t.tokens || 0), 0);
  const totalMs = plan.subagentTraces.reduce((sum, t) => sum + (t.durationMs || 0), 0);

  const handleSaveEdits = () => {
    const cleaned = draftReqs
      .map((r) => ({ ...r, text: r.text.trim() }))
      .filter((r) => r.text.length > 0);
    if (cleaned.length === 0) return;
    onUpdateRequirements(messageId, cleaned, extraNote.trim() || undefined);
    setExtraNote('');
    setEditing(false);
  };

  return (
    <section
      aria-label="Coding architecture plan"
      data-testid="coding-plan-card"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="w-full rounded-2xl border p-4 space-y-4 text-slate-900 dark:text-slate-100"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            {(plan.phase === 'planning' ||
              plan.phase === 'executing' ||
              plan.phase === 'verifying') && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
            )}
            {plan.phase === 'completed' && (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            {plan.phase === 'failed' && (
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{PHASE_LABELS[plan.phase]}</span>
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white leading-snug">
            {plan.summary}
          </p>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">
          {completedTasks}/{plan.tasks.length} tasks
          {totalTokens > 0 && ` · ${totalTokens} tok`}
          {totalMs > 0 && ` · ${totalMs}ms`}
        </div>
      </div>

      {/* Requirements Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Requirements
          </h4>
          {plan.phase === 'awaiting_approval' && !editing && (
            <button
              type="button"
              data-testid="edit-requirements-btn"
              onClick={() => setEditing(true)}
              className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit Requirements</span>
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2" data-testid="edit-requirements-form">
            {draftReqs.map((req, idx) => (
              <div key={req.id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={req.text}
                  aria-label={`Requirement ${idx + 1}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDraftReqs((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, text: val } : item))
                    );
                  }}
                  style={{
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="flex-1 min-h-[44px] px-3 rounded-xl border text-xs text-slate-900 dark:text-white"
                />
                {draftReqs.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove requirement ${idx + 1}`}
                    onClick={() => setDraftReqs((prev) => prev.filter((_, i) => i !== idx))}
                    className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-500 hover:text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <input
              type="text"
              value={extraNote}
              onChange={(e) => setExtraNote(e.target.value)}
              placeholder="Optional tweak or constraint for the Coder..."
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[44px] px-3 rounded-xl border text-xs text-slate-900 dark:text-white"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  setDraftReqs((prev) => [
                    ...prev,
                    { id: `req_${Date.now()}`, text: '', checked: false },
                  ])
                }
                className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add requirement</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraftReqs(plan.requirements);
                    setEditing(false);
                  }}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="save-requirements-btn"
                  onClick={handleSaveEdits}
                  style={{
                    backgroundColor: 'var(--m3-primary)',
                    color: 'var(--m3-on-primary)',
                  }}
                  className="min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save edits</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {plan.requirements.map((req) => (
              <li key={req.id}>
                <label className="min-h-[44px] px-2 py-1.5 rounded-xl flex items-start gap-2.5 text-xs cursor-pointer hover:bg-slate-200/40 dark:hover:bg-slate-800/40">
                  <input
                    type="checkbox"
                    checked={req.checked}
                    disabled={plan.phase !== 'awaiting_approval'}
                    onChange={(e) => {
                      const next = plan.requirements.map((item) =>
                        item.id === req.id ? { ...item, checked: e.target.checked } : item
                      );
                      onUpdateRequirements(messageId, next);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-400 accent-blue-600 shrink-0"
                  />
                  <span
                    className={
                      req.checked
                        ? 'line-through text-slate-500 dark:text-slate-400'
                        : 'text-slate-800 dark:text-slate-200'
                    }
                  >
                    {req.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* File Manifest */}
      {plan.fileManifest.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            File Manifest
          </h4>
          <div className="divide-y divide-slate-200/70 dark:divide-slate-800 border-t border-b border-slate-200/70 dark:border-slate-800">
            {plan.fileManifest.map((item) => (
              <div
                key={`${item.action}:${item.path}`}
                className="py-2 flex flex-wrap items-baseline justify-between gap-2 text-xs"
              >
                <div className="flex items-baseline gap-2 min-w-0">
                  <span
                    className={`font-mono font-semibold shrink-0 ${
                      item.action === 'delete'
                        ? 'text-rose-700 dark:text-rose-300'
                        : item.action === 'modify'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {item.action}
                  </span>
                  <code className="font-mono text-slate-900 dark:text-white truncate">
                    {item.path}
                  </code>
                </div>
                <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                  {item.purpose}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ordered Tasks */}
      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Execution Tasks
        </h4>
        <ol className="space-y-2">
          {plan.tasks.map((task, idx) => {
            const { label, Icon, tone } = TASK_STATE[task.status];
            const modelName = task.modelId
              ? getShortModelName(getModelById(task.modelId, dynamicModels))
              : null;
            return (
              <li
                key={task.id}
                className="py-1.5 flex items-start justify-between gap-3 text-xs border-b last:border-b-0 border-slate-200/60 dark:border-slate-800/80"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <Icon
                    aria-hidden="true"
                    className={`w-4 h-4 mt-0.5 shrink-0 ${tone} ${
                      task.status === 'in_progress' || task.status === 'verifying'
                        ? 'motion-safe:animate-pulse'
                        : ''
                    }`}
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-medium text-slate-900 dark:text-white">
                      {idx + 1}. {task.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {task.targetFiles.join(', ') || 'workspace'} · {task.verificationCheck}
                      {modelName && ` · Coder: ${modelName}`}
                      {task.durationMs ? ` · ${task.durationMs}ms` : ''}
                      {task.tokens ? ` · ${task.tokens} tok` : ''}
                    </div>
                    {task.fallbackNote && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        {task.fallbackNote}
                      </div>
                    )}
                    {task.error && (
                      <div className="text-[11px] text-rose-700 dark:text-rose-300">
                        {task.error}
                      </div>
                    )}
                  </div>
                </div>
                <span className={`shrink-0 font-medium ${tone}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Verification / Self-Healing Diagnostics */}
      {(plan.repairAttempts > 0 || plan.verificationErrors.length > 0) && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1 text-xs">
          <div className="font-semibold text-slate-700 dark:text-slate-200 font-mono tabular-nums">
            Self-healing passes: {plan.repairAttempts} / {plan.maxRepairAttempts}
          </div>
          {plan.verificationErrors.map((err, i) => (
            <div key={i} className="text-rose-700 dark:text-rose-300">
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Subagent Trace Summary (inline text metadata, zero pills) */}
      {plan.subagentTraces.length > 0 && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          Subagents:{' '}
          {plan.subagentTraces
            .map((tr) => {
              const name = getShortModelName(getModelById(tr.modelId, dynamicModels));
              return `${tr.role} (${name}, ${tr.durationMs}ms)`;
            })
            .join(' · ')}
        </div>
      )}

      {/* Action Controls (>= 44px touch targets) */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={plan.autoRun}
            onClick={onToggleAutoRun}
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="min-h-[44px] px-3 rounded-xl border text-xs font-medium text-slate-700 dark:text-slate-200 hover:opacity-90"
          >
            Auto-Run: {plan.autoRun ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={onOpenWorkspace}
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="min-h-[44px] px-3 rounded-xl border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:opacity-90"
          >
            <FolderCode className="w-4 h-4 shrink-0" />
            <span>Open Workspace</span>
          </button>
        </div>

        {plan.phase === 'awaiting_approval' && (
          <button
            type="button"
            data-testid="approve-build-btn"
            disabled={isRunning || editing}
            onClick={() => onApprovePlan(messageId)}
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[44px] px-5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Play className="w-4 h-4 shrink-0" />
            <span>Approve & Build</span>
          </button>
        )}
      </div>
    </section>
  );
}
