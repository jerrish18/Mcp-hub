import React, { useMemo, useState } from 'react';
import { BookMarked, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import type { SavedPrompt } from '../../types';
import { BottomSheet } from '../../ui/BottomSheet';

export function extractMacroVariables(template: string): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      vars.push(key);
    }
  }
  return vars;
}

export function fillMacroVariables(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, key: string) => {
    const val = values[key]?.trim();
    return val ? val : `{{${key}}}`;
  });
}

interface PromptMacrosSheetProps {
  open: boolean;
  macros: SavedPrompt[];
  onClose: () => void;
  onInsertMacro: (resolvedPrompt: string) => void;
  onSaveMacro: (macro: Omit<SavedPrompt, 'id' | 'updatedAt'> & { id?: string }) => void;
  onDeleteMacro: (macroId: string) => void;
}

export function PromptMacrosSheet({
  open,
  macros,
  onClose,
  onInsertMacro,
  onSaveMacro,
  onDeleteMacro,
}: PromptMacrosSheetProps) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Pro');
  const [template, setTemplate] = useState('');

  const [fillTarget, setFillTarget] = useState<SavedPrompt | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  const filteredMacros = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return macros;
    return macros.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.template.toLowerCase().includes(q) ||
        (m.category ?? '').toLowerCase().includes(q)
    );
  }, [macros, search]);

  const startNew = () => {
    setEditingId(null);
    setTitle('');
    setCategory('Pro');
    setTemplate('');
    setShowForm(true);
    setFillTarget(null);
  };

  const startEdit = (macro: SavedPrompt) => {
    setEditingId(macro.id);
    setTitle(macro.title);
    setCategory(macro.category ?? 'General');
    setTemplate(macro.template);
    setShowForm(true);
    setFillTarget(null);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !template.trim()) return;
    onSaveMacro({
      id: editingId ?? undefined,
      title: title.trim(),
      category: category.trim() || undefined,
      template: template.trim(),
    });
    setShowForm(false);
    setEditingId(null);
  };

  const handleUseMacro = (macro: SavedPrompt) => {
    const vars = extractMacroVariables(macro.template);
    if (vars.length === 0) {
      onInsertMacro(macro.template);
      onClose();
      return;
    }
    const defaults: Record<string, string> = {};
    for (const v of vars) defaults[v] = '';
    setVarValues(defaults);
    setFillTarget(macro);
  };

  const handleSubmitFill = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fillTarget) return;
    onInsertMacro(fillMacroVariables(fillTarget.template, varValues));
    setFillTarget(null);
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Saved Prompts & Macros"
      subtitle="Reusable prompt templates with {{variable}} placeholders, synced to your account"
    >
      {fillTarget ? (
        <form onSubmit={handleSubmitFill} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Fill Variables · {fillTarget.title}
            </div>
            <button
              type="button"
              onClick={() => setFillTarget(null)}
              className="text-xs text-slate-500 hover:underline"
            >
              Back
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono bg-slate-100 dark:bg-slate-950 rounded-xl p-2.5">
            {fillTarget.template}
          </p>
          {extractMacroVariables(fillTarget.template).map((varName) => (
            <div key={varName}>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {`{{${varName}}}`}
              </label>
              <input
                type="text"
                required
                data-testid={`macro-var-${varName}`}
                value={varValues[varName] ?? ''}
                onChange={(e) =>
                  setVarValues((prev) => ({ ...prev, [varName]: e.target.value }))
                }
                placeholder={`Value for ${varName}...`}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
              />
            </div>
          ))}
          <button
            type="submit"
            data-testid="macro-insert-filled-btn"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="w-full min-h-[44px] rounded-full text-sm font-semibold"
          >
            Insert into Composer
          </button>
        </form>
      ) : showForm ? (
        <form onSubmit={handleSaveForm} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {editingId ? 'Edit Prompt Macro' : 'New Prompt Macro'}
            </span>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-slate-500 hover:underline"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Macro title (e.g. API Spec Review)"
              data-testid="macro-title-input"
              className="sm:col-span-2 min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              className="min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <textarea
            rows={4}
            required
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="Write your prompt template using {{variable}} placeholders..."
            data-testid="macro-template-input"
            className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
          />
          <button
            type="submit"
            data-testid="macro-save-btn"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="w-full min-h-[44px] rounded-full text-sm font-semibold"
          >
            Save Macro
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search saved macros..."
                className="w-full min-h-[40px] pl-9 pr-3 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              data-testid="new-macro-btn"
              onClick={startNew}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[40px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Macro</span>
            </button>
          </div>

          {filteredMacros.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
              No saved prompt macros match your filter.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {filteredMacros.map((macro) => {
                const vars = extractMacroVariables(macro.template);
                return (
                  <div
                    key={macro.id}
                    data-testid="saved-macro-card"
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-2xl border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <BookMarked className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {macro.title}
                          </span>
                          {macro.category && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-800 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                              {macro.category}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                          {macro.template}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(macro)}
                          aria-label={`Edit ${macro.title}`}
                          className="min-h-[34px] min-w-[34px] rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteMacro(macro.id)}
                          aria-label={`Delete ${macro.title}`}
                          className="min-h-[34px] min-w-[34px] rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1">
                        {vars.map((v) => (
                          <span
                            key={v}
                            className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300"
                          >
                            {`{{${v}}}`}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        data-testid={`use-macro-${macro.id}`}
                        onClick={() => handleUseMacro(macro)}
                        style={{
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                        }}
                        className="min-h-[32px] px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1 shrink-0"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>{vars.length > 0 ? 'Fill & Use' : 'Insert'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
