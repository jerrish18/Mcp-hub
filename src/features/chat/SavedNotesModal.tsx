import { useMemo, useState } from 'react';
import { Bookmark, BookOpen, Layers, Search, Trash2 } from 'lucide-react';
import type { SavedStudyNote } from '../../utils/studyTools';
import { BottomSheet } from '../../ui/BottomSheet';

interface SavedNotesModalProps {
  open: boolean;
  notes: SavedStudyNote[];
  onClose: () => void;
  onOpenReader: (note: SavedStudyNote) => void;
  onOpenFlashcards: (note: SavedStudyNote) => void;
  onDeleteNote: (noteId: string) => void;
}

export function SavedNotesModal({
  open,
  notes,
  onClose,
  onOpenReader,
  onOpenFlashcards,
  onDeleteNote,
}: SavedNotesModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    );
  }, [notes, query]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Saved Study Vault"
      subtitle={`${notes.length} pinned study note${notes.length === 1 ? '' : 's'} stored locally on this device`}
    >
      <div className="space-y-4">
        {notes.length > 0 && (
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search saved study notes..."
              aria-label="Search saved study notes"
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="w-full min-h-[42px] pl-10 pr-3.5 rounded-2xl border text-sm text-slate-900 dark:text-white"
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <div
            style={{
              backgroundColor: 'var(--m3-surface-container)',
              borderColor: 'var(--m3-outline)',
            }}
            className="rounded-2xl border p-6 text-center space-y-2"
          >
            <Bookmark className="w-6 h-6 text-slate-400 mx-auto" />
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {notes.length === 0 ? 'No saved study notes yet' : 'No matching saved notes'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tap <strong>Save</strong> on any Study Session explanation to keep it in your revision vault.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((note) => (
              <div
                key={note.id}
                style={{
                  backgroundColor: 'var(--m3-surface-container)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="rounded-2xl border p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-display text-sm font-bold text-slate-950 dark:text-white truncate">
                      {note.title}
                    </h3>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {new Date(note.createdAt).toLocaleDateString()}
                      {note.modelLabel ? ` · ${note.modelLabel}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteNote(note.id)}
                    aria-label={`Delete saved note ${note.title}`}
                    className="min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                  {note.content.replace(/[#*`>|]/g, '').trim()}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenReader(note);
                    }}
                    style={{
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }}
                    className="min-h-[36px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Open Reader</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFlashcards(note);
                    }}
                    style={{
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="min-h-[36px] px-3.5 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Flashcards</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
