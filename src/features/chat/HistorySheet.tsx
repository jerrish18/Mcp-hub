import { useMemo, useState } from 'react';
import { Check, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import type { Conversation } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';

interface HistoryListContentProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function HistoryListContent({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
}: HistoryListContentProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, query]);

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats..."
            aria-label="Search chat history"
            className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="Start new chat"
          className="min-h-[44px] px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium inline-flex items-center gap-1.5 shrink-0 transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" />
          <span>New</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          {query ? 'No conversations match your search.' : 'No saved conversations yet.'}
        </div>
      ) : (
        <div className="space-y-1.5 overflow-y-auto flex-1 pr-0.5">
          {filtered.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isEditing = editingId === conv.id;

            return (
              <div
                key={conv.id}
                className={`rounded-2xl border transition-colors ${
                  isActive
                    ? 'border-blue-500/70 bg-blue-50/70 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {isEditing ? (
                  <div className="p-2 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      aria-label="Rename conversation title"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void onRename(conv.id, draftTitle);
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 min-h-[40px] px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void onRename(conv.id, draftTitle);
                        setEditingId(null);
                      }}
                      aria-label={`Save title for ${conv.title}`}
                      className="min-h-[40px] min-w-[40px] rounded-xl bg-blue-600 text-white flex items-center justify-center"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel rename"
                      className="min-h-[40px] min-w-[40px] rounded-xl text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 flex items-center justify-center"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onSelect(conv.id)}
                      className="flex-1 min-h-[44px] text-left min-w-0 py-1"
                    >
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {conv.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {conv.messages.length} msgs · {new Date(conv.updatedAt).toLocaleDateString()}
                      </div>
                    </button>
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(conv.id);
                          setDraftTitle(conv.title);
                        }}
                        aria-label={`Rename ${conv.title}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(conv.id)}
                        aria-label={`Delete ${conv.title}`}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface HistorySheetProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function HistorySheet(props: HistorySheetProps) {
  return (
    <BottomSheet open={props.open} onClose={props.onClose} title="Chat History" subtitle="Stored locally on device">
      <div className="h-[60vh]">
        <HistoryListContent
          conversations={props.conversations}
          activeConversationId={props.activeConversationId}
          onSelect={(id) => {
            props.onSelect(id);
            props.onClose();
          }}
          onNewChat={() => {
            props.onNewChat();
            props.onClose();
          }}
          onRename={props.onRename}
          onDelete={props.onDelete}
        />
      </div>
    </BottomSheet>
  );
}
