import { useEffect, useRef, useState } from 'react';
import { verifyAnswer } from '../../services/llm/verifyAnswer';
import type { ChatMessage, ModelConfig, ProviderKeys } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import { MarkdownRenderer } from '../../ui/MarkdownRenderer';
import { safeErrorMessage } from '../../utils/redact';

export function VerificationSheet({ answer, question, models, keys, onClose }: {
  answer: ChatMessage;
  question: string;
  models: ModelConfig[];
  keys: ProviderKeys;
  onClose: () => void;
}) {
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [running, setRunning] = useState(false);
  const [review, setReview] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const model = models.find((item) => item.id === modelId);

  const run = async () => {
    if (!model || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setReview('');
    setError('');
    setRunning(true);
    try {
      await verifyAnswer({ question, answer, model, keys, signal: abort.signal, onText: setReview });
    } catch (cause) {
      if (!abort.signal.aborted) setError(safeErrorMessage(cause, Object.values(keys).filter(Boolean)));
    } finally {
      if (!abort.signal.aborted) {
        controller.current = undefined;
        setRunning(false);
      }
    }
  };

  return (
    <BottomSheet open title="Verify answer" onClose={onClose}>
      <div className="space-y-3 text-slate-900 dark:text-slate-100">
        {models.length ? <>
          <label className="block text-sm font-medium">
            Review model
            <select className="mt-1 min-h-[44px] w-full rounded-lg border bg-white px-3 dark:border-slate-700 dark:bg-slate-900"
              value={modelId} disabled={running} onChange={(event) => setModelId(event.target.value)}>
              {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-slate-600 dark:text-slate-300">Sends the answer and redacted tool excerpts to the selected provider for review.</p>
          <button type="button" onClick={() => void run()} disabled={!model || running}
            className="min-h-[44px] rounded-lg bg-blue-700 px-3 text-sm font-semibold text-white disabled:opacity-50">
            {running ? 'Reviewing…' : 'Run verification'}
          </button>
        </> : <p className="text-sm">Configure another free-tier model in Settings to review this answer.</p>}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        {review && <section aria-label="Verification findings" className="rounded-lg border p-3 dark:border-slate-700">
          <h3 className="mb-2 text-sm font-semibold">Findings</h3>
          <MarkdownRenderer content={review} a2uiEnabled={false} isStreaming={running} />
        </section>}
      </div>
    </BottomSheet>
  );
}
