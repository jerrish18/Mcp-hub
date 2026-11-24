import { useState } from 'react';
import type { ChatMessage, ModelConfig } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';
import type { ConversationForkRequest } from '../../utils/chatBranches';

export function ConversationForkSheet({ mode, message, models, onClose, onConfirm }: {
  mode: 'edit' | 'regenerate';
  message: ChatMessage;
  models: ModelConfig[];
  onClose: () => void;
  onConfirm: (request: ConversationForkRequest) => Promise<void>;
}) {
  const [text, setText] = useState(message.content);
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = mode === 'edit';
  const title = editing ? 'Edit and rerun' : 'Regenerate with a different model';
  return (
    <BottomSheet open title={title} onClose={onClose}>
      <form className="space-y-3 text-slate-900 dark:text-slate-100" onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        void onConfirm({ mode, messageId: message.id, text, modelId: editing ? undefined : modelId })
          .catch((cause) => {
            setBusy(false);
            setError(cause instanceof Error ? cause.message : 'Could not fork this chat.');
          });
      }}>
        <p className="text-sm text-slate-600 dark:text-slate-300">The rerun starts in a linked conversation.</p>
        {editing ? <label className="block text-sm">Edited message
          <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent p-3 dark:border-slate-700" />
        </label> : <label className="block text-sm">Model
          <select value={modelId} onChange={(event) => setModelId(event.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-300 bg-white px-3 dark:border-slate-700 dark:bg-slate-900">
            {!models.length && <option value="">No other configured free-tier model</option>}
            {models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <button type="submit" disabled={busy || (editing ? !text.trim() && !message.attachments?.length : !modelId)}
          className="min-h-[44px] rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {editing ? 'Fork and run' : 'Fork and regenerate'}
        </button>
      </form>
    </BottomSheet>
  );
}
