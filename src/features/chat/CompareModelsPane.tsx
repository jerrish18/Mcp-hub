import React from 'react';
import { Check, Columns, Loader2, Sparkles, X } from 'lucide-react';
import { getModelById, getShortModelName } from '../../config/models';
import type { CompareResultItem } from '../../store/useHubStore';
import type { ModelConfig } from '../../types';
import { MarkdownRenderer } from '../../ui/MarkdownRenderer';

interface CompareModelsPaneProps {
  allModels: ModelConfig[];
  selectedModelIds: string[];
  results: CompareResultItem[];
  lastPrompt: string;
  isRunning: boolean;
  a2uiEnabled: boolean;
  onToggleModel: (modelId: string) => void;
  onAcceptReply: (item: CompareResultItem) => void;
  onClearResults: () => void;
  onCloseCompare: () => void;
}

export function CompareModelsPane({
  allModels,
  selectedModelIds,
  results,
  lastPrompt,
  isRunning,
  a2uiEnabled,
  onToggleModel,
  onAcceptReply,
  onClearResults,
  onCloseCompare,
}: CompareModelsPaneProps) {
  return (
    <section
      data-testid="compare-models-pane"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="mx-3.5 sm:mx-6 mt-3 rounded-[24px] border p-3.5 space-y-3 shrink-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Columns style={{ color: 'var(--m3-primary)' }} className="w-4 h-4 shrink-0" />
          <div>
            <h2 className="text-xs font-bold text-slate-900 dark:text-white">
              Side-by-Side Compare Mode ({selectedModelIds.length}/3 selected)
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Pick 2–3 models below and send a prompt in the composer to compare responses concurrently.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {results.length > 0 && !isRunning && (
            <button
              type="button"
              onClick={onClearResults}
              className="min-h-[30px] px-2.5 rounded-full border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onCloseCompare}
            aria-label="Exit compare mode"
            className="min-h-[30px] min-w-[30px] rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Model Multi-Select Bar */}
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {allModels.slice(0, 14).map((model) => {
          const selected = selectedModelIds.includes(model.id);
          return (
            <button
              key={model.id}
              type="button"
              data-testid={`compare-pick-${model.id}`}
              onClick={() => onToggleModel(model.id)}
              style={
                selected
                  ? {
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                      borderColor: 'var(--m3-primary)',
                    }
                  : {
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: 'var(--m3-outline)',
                    }
              }
              className="min-h-[30px] px-2.5 rounded-full border text-[11px] font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1"
            >
              {selected && <Check className="w-3 h-3 shrink-0" />}
              <span>{getShortModelName(model)}</span>
            </button>
          );
        })}
      </div>

      {/* Side-by-side Result Columns */}
      {results.length > 0 && (
        <div className="space-y-2">
          {lastPrompt && (
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Prompt: <span className="font-medium text-slate-800 dark:text-slate-200">{lastPrompt}</span>
            </div>
          )}
          <div
            className={`grid grid-cols-1 gap-3 max-h-[360px] overflow-y-auto pr-0.5 ${
              results.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'
            }`}
          >
            {results.map((item) => {
              const model = getModelById(item.modelId, allModels);
              return (
                <div
                  key={item.modelId}
                  data-testid={`compare-card-${item.modelId}`}
                  style={{
                    backgroundColor: 'var(--m3-surface)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="rounded-2xl border p-3 flex flex-col justify-between gap-2.5 min-w-0"
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 dark:border-slate-800 pb-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {getShortModelName(model)}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0 inline-flex items-center gap-1">
                        {item.status === 'running' ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Streaming</span>
                          </>
                        ) : item.status === 'error' ? (
                          <span className="text-rose-500">Error</span>
                        ) : (
                          <span>{item.durationMs}ms</span>
                        )}
                      </span>
                    </div>

                    {item.error ? (
                      <p className="text-xs text-rose-600 dark:text-rose-400 break-words">
                        {item.error}
                      </p>
                    ) : item.content ? (
                      <div className="text-xs max-h-48 overflow-y-auto pr-1">
                        <MarkdownRenderer content={item.content} a2uiEnabled={a2uiEnabled} />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Waiting for tokens...</p>
                    )}
                  </div>

                  {item.status === 'done' && item.content && (
                    <button
                      type="button"
                      data-testid={`compare-use-${item.modelId}`}
                      onClick={() => onAcceptReply(item)}
                      style={{
                        backgroundColor: 'var(--m3-primary-container)',
                        color: 'var(--m3-on-primary-container)',
                      }}
                      className="w-full min-h-[34px] rounded-full text-xs font-semibold hover:opacity-90"
                    >
                      Use this reply
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
