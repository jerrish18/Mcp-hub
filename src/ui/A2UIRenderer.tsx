import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  Circle,
  Info,
  LayoutGrid,
  Sparkles,
} from 'lucide-react';
import type { A2UISurfaceSpec, A2UIWidget } from '../utils/a2ui';

interface A2UIRendererProps {
  spec: A2UISurfaceSpec;
  enabled: boolean;
  onToggleEnabled?: () => void;
  onAction?: (prompt: string, displayLabel?: string) => void;
}

function ChecklistWidget({
  widget,
}: {
  widget: Extract<A2UIWidget, { type: 'checklist' }>;
}) {
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const it of widget.items) {
      initial[it.id] = Boolean(it.checked);
    }
    return initial;
  });

  const doneCount = widget.items.filter((it) => checkedMap[it.id]).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
          {widget.title || 'Interactive Checklist'}
        </span>
        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {doneCount} / {widget.items.length} done
        </span>
      </div>
      <div className="space-y-1.5">
        {widget.items.map((item) => {
          const checked = Boolean(checkedMap[item.id]);
          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => setCheckedMap((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
              style={{
                backgroundColor: 'var(--m3-surface)',
                borderColor: checked ? 'var(--m3-primary)' : 'var(--m3-outline)',
              }}
              className="w-full min-h-[40px] px-3 py-2 rounded-xl border text-left flex items-start gap-2.5 transition-colors hover:opacity-95"
            >
              <span
                style={
                  checked
                    ? { backgroundColor: 'var(--m3-primary)', color: 'var(--m3-on-primary)' }
                    : undefined
                }
                className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                  checked ? 'border-transparent' : 'border-slate-300 dark:border-slate-600'
                }`}
              >
                {checked && <Check className="w-3 h-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-xs font-medium ${
                    checked
                      ? 'line-through text-slate-400 dark:text-slate-500'
                      : 'text-slate-800 dark:text-slate-100'
                  }`}
                >
                  {item.label}
                </span>
                {item.note && (
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {item.note}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InteractiveFormWidget({
  widget,
  onAction,
}: {
  widget: Extract<A2UIWidget, { type: 'form' }>;
  onAction?: (prompt: string, displayLabel?: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => {
    const init: Record<string, string | number | boolean> = {};
    for (const f of widget.fields) {
      if (f.defaultValue !== undefined) {
        init[f.id] = f.defaultValue;
      } else if (f.kind === 'toggle') {
        init[f.id] = false;
      } else if (f.kind === 'select' && f.options && f.options.length > 0) {
        init[f.id] = f.options[0];
      } else {
        init[f.id] = '';
      }
    }
    return init;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAction) return;
    const summaryPairs = widget.fields
      .map((f) => `${f.label}: ${String(values[f.id] ?? '')}`)
      .join(', ');
    const baseInstruction = widget.promptTemplate?.trim()
      ? `${widget.promptTemplate.trim()}\nParameters: ${summaryPairs}`
      : `Apply these updated parameters (${summaryPairs}) and refine your output accordingly.`;
    onAction(baseInstruction, `${widget.title || 'A2UI Form'}: ${summaryPairs}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        backgroundColor: 'var(--m3-surface)',
        borderColor: 'var(--m3-outline)',
      }}
      className="rounded-2xl border p-3.5 space-y-3"
    >
      {widget.title && (
        <div className="text-xs font-semibold text-slate-900 dark:text-white">{widget.title}</div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {widget.fields.map((field) => {
          const val = values[field.id];
          if (field.kind === 'toggle') {
            const checked = Boolean(val);
            return (
              <button
                key={field.id}
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => setValues((prev) => ({ ...prev, [field.id]: !checked }))}
                style={{
                  backgroundColor: 'var(--m3-surface-container)',
                  borderColor: checked ? 'var(--m3-primary)' : 'var(--m3-outline)',
                }}
                className="min-h-[40px] px-3 rounded-xl border flex items-center justify-between gap-2 text-xs text-slate-800 dark:text-slate-100"
              >
                <span className="font-medium truncate">{field.label}</span>
                <span
                  style={
                    checked
                      ? { backgroundColor: 'var(--m3-primary)', color: 'var(--m3-on-primary)' }
                      : undefined
                  }
                  className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    checked ? '' : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {checked ? 'Yes' : 'No'}
                </span>
              </button>
            );
          }

          return (
            <div key={field.id} className="space-y-1">
              <label
                htmlFor={`a2ui-${field.id}`}
                className="block text-[11px] font-medium text-slate-600 dark:text-slate-300"
              >
                {field.label}
              </label>
              {field.kind === 'select' && field.options?.length ? (
                <select
                  id={`a2ui-${field.id}`}
                  value={String(val ?? '')}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="w-full min-h-[38px] px-2.5 rounded-xl border text-xs text-slate-900 dark:text-white"
                >
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`a2ui-${field.id}`}
                  type={field.kind === 'number' ? 'number' : 'text'}
                  value={String(val ?? '')}
                  placeholder={field.placeholder}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  style={{
                    backgroundColor: 'var(--m3-surface-container)',
                    borderColor: 'var(--m3-outline)',
                  }}
                  className="w-full min-h-[38px] px-3 rounded-xl border text-xs text-slate-900 dark:text-white"
                />
              )}
            </div>
          );
        })}
      </div>

      {onAction && (
        <div className="flex justify-end">
          <button
            type="submit"
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[36px] px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
          >
            <span>{widget.submitLabel || 'Apply & Run'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </form>
  );
}

export const A2UIRenderer = React.memo(function A2UIRenderer({
  spec,
  enabled,
  onToggleEnabled,
  onAction,
}: A2UIRendererProps) {
  const maxBarByWidget = useMemo(() => {
    const map = new Map<number, number>();
    spec.widgets.forEach((w, idx) => {
      if (w.type === 'bar_chart') {
        const computedMax = Math.max(
          1,
          ...w.bars.map((b) => (b.max && b.max > 0 ? b.max : Math.abs(b.value)))
        );
        map.set(idx, computedMax);
      }
    });
    return map;
  }, [spec]);

  if (!enabled) {
    return (
      <div
        data-testid="a2ui-disabled-card"
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="my-3 rounded-2xl border px-4 py-3 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <LayoutGrid className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
              A2UI surface paused: {spec.title}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Interactive cards are currently disabled across chat.
            </div>
          </div>
        </div>
        {onToggleEnabled && (
          <button
            type="button"
            onClick={onToggleEnabled}
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="min-h-[34px] px-3 rounded-full text-xs font-semibold shrink-0 hover:opacity-90"
          >
            Enable A2UI
          </button>
        )}
      </div>
    );
  }

  return (
    <section
      data-testid="a2ui-surface"
      aria-label={`Interactive UI: ${spec.title}`}
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="my-3 rounded-2xl border p-4 space-y-4 shadow-xs"
    >
      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-200/70 dark:border-slate-800">
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          >
            <LayoutGrid className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h4 className="font-display text-sm font-bold text-slate-950 dark:text-white truncate">
              {spec.title}
            </h4>
            {spec.subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {spec.subtitle}
              </p>
            )}
          </div>
        </div>

        <span
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 shrink-0"
        >
          {spec.badge || 'A2UI'}
        </span>
      </div>

      <div className="space-y-3.5">
        {spec.widgets.map((widget, wi) => {
          if (widget.type === 'kpi_grid') {
            return (
              <div key={wi} className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {widget.items.map((item, ii) => (
                  <div
                    key={ii}
                    style={{
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-xl border p-3 space-y-0.5"
                  >
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate">
                      {item.label}
                    </div>
                    <div
                      style={{ color: 'var(--m3-primary)' }}
                      className="font-display text-lg font-bold tabular-nums truncate"
                    >
                      {item.value}
                    </div>
                    {(item.delta || item.hint) && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {item.delta || item.hint}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          if (widget.type === 'comparison_cards') {
            return (
              <div key={wi} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {widget.cards.map((card, ci) => (
                  <div
                    key={ci}
                    style={{
                      backgroundColor: 'var(--m3-surface)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-2xl border p-3.5 flex flex-col justify-between gap-2.5"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {card.title}
                          </div>
                          {card.subtitle && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {card.subtitle}
                            </div>
                          )}
                        </div>
                        {card.badge && (
                          <span
                            style={{
                              backgroundColor: 'var(--m3-primary-container)',
                              color: 'var(--m3-on-primary-container)',
                            }}
                            className="px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0"
                          >
                            {card.badge}
                          </span>
                        )}
                      </div>
                      <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                        {card.points.map((pt, pi) => (
                          <li key={pi} className="flex items-start gap-1.5 leading-snug">
                            <Sparkles
                              style={{ color: 'var(--m3-primary)' }}
                              className="w-3 h-3 shrink-0 mt-0.5"
                            />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {card.actionLabel && card.actionPrompt && onAction && (
                      <button
                        type="button"
                        onClick={() => onAction(card.actionPrompt!, card.actionLabel)}
                        style={{
                          backgroundColor: 'var(--m3-primary-container)',
                          color: 'var(--m3-on-primary-container)',
                        }}
                        className="min-h-[34px] px-3 rounded-full text-xs font-semibold inline-flex items-center justify-center gap-1 hover:opacity-90"
                      >
                        <span>{card.actionLabel}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          if (widget.type === 'checklist') {
            return <ChecklistWidget key={wi} widget={widget} />;
          }

          if (widget.type === 'form') {
            return <InteractiveFormWidget key={wi} widget={widget} onAction={onAction} />;
          }

          if (widget.type === 'timeline') {
            return (
              <div key={wi} className="space-y-2">
                {widget.title && (
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {widget.title}
                  </div>
                )}
                <div className="space-y-1.5">
                  {widget.steps.map((st, si) => (
                    <div
                      key={si}
                      style={{
                        backgroundColor: 'var(--m3-surface)',
                        borderColor: 'var(--m3-outline)',
                      }}
                      className="rounded-xl border px-3 py-2 flex items-start gap-2.5"
                    >
                      {st.status === 'done' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : st.status === 'active' ? (
                        <Sparkles
                          style={{ color: 'var(--m3-primary)' }}
                          className="w-4 h-4 shrink-0 mt-0.5"
                        />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white">
                          {si + 1}. {st.title}
                        </div>
                        {st.detail && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {st.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (widget.type === 'bar_chart') {
            const chartMax = maxBarByWidget.get(wi) ?? 100;
            return (
              <div
                key={wi}
                style={{
                  backgroundColor: 'var(--m3-surface)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="rounded-2xl border p-3.5 space-y-2.5"
              >
                {widget.title && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                    <BarChart3 style={{ color: 'var(--m3-primary)' }} className="w-3.5 h-3.5" />
                    <span>{widget.title}</span>
                  </div>
                )}
                <div className="space-y-2">
                  {widget.bars.map((bar, bi) => {
                    const pct = Math.max(4, Math.min(100, Math.round((bar.value / chartMax) * 100)));
                    return (
                      <div key={bi} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">
                            {bar.label}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-slate-900 dark:text-white tabular-nums shrink-0">
                            {bar.value}
                            {widget.unit ? ` ${widget.unit}` : ''}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                          <div
                            style={{
                              width: `${pct}%`,
                              backgroundColor: 'var(--m3-primary)',
                            }}
                            className="h-full rounded-full transition-all"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          if (widget.type === 'callout') {
            const toneClass =
              widget.tone === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200'
                : widget.tone === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
                  : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-950 dark:text-blue-100';
            return (
              <div key={wi} className={`rounded-xl border px-3 py-2.5 text-xs flex items-start gap-2 ${toneClass}`}>
                {widget.tone === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  {widget.title && <div className="font-semibold mb-0.5">{widget.title}</div>}
                  <div className="leading-relaxed">{widget.text}</div>
                </div>
              </div>
            );
          }

          if (widget.type === 'actions' && onAction) {
            return (
              <div key={wi} className="flex flex-wrap gap-1.5 pt-0.5">
                {widget.buttons.map((btn, bi) => (
                  <button
                    key={bi}
                    type="button"
                    onClick={() => onAction(btn.prompt, btn.label)}
                    style={
                      btn.style === 'primary'
                        ? {
                            backgroundColor: 'var(--m3-primary)',
                            color: 'var(--m3-on-primary)',
                          }
                        : {
                            backgroundColor: 'var(--m3-surface)',
                            borderColor: 'var(--m3-outline)',
                          }
                    }
                    className={`min-h-[34px] px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90 ${
                      btn.style === 'primary' ? '' : 'border text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    <span>{btn.label}</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                ))}
              </div>
            );
          }

          return null;
        })}
      </div>
    </section>
  );
});
