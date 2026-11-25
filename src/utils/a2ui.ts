import type { A2uiMode, ChatMode } from '../types';

export type A2UIWidget =
  | {
      type: 'kpi_grid';
      items: Array<{ label: string; value: string; delta?: string; hint?: string }>;
    }
  | {
      type: 'comparison_cards';
      cards: Array<{
        title: string;
        subtitle?: string;
        badge?: string;
        points: string[];
        actionLabel?: string;
        actionPrompt?: string;
      }>;
    }
  | {
      type: 'checklist';
      title?: string;
      items: Array<{ id: string; label: string; checked?: boolean; note?: string }>;
    }
  | {
      type: 'form';
      title?: string;
      submitLabel?: string;
      promptTemplate?: string;
      fields: Array<{
        id: string;
        label: string;
        kind: 'text' | 'number' | 'select' | 'toggle';
        placeholder?: string;
        defaultValue?: string | number | boolean;
        options?: string[];
      }>;
    }
  | {
      type: 'timeline';
      title?: string;
      steps: Array<{ title: string; detail?: string; status?: 'done' | 'active' | 'upcoming' }>;
    }
  | {
      type: 'bar_chart';
      title?: string;
      unit?: string;
      bars: Array<{ label: string; value: number; max?: number; note?: string }>;
    }
  | {
      type: 'actions';
      buttons: Array<{ label: string; prompt: string; style?: 'primary' | 'secondary' }>;
    }
  | {
      type: 'callout';
      title?: string;
      text: string;
      tone?: 'info' | 'success' | 'warning';
    };

export interface A2UISurfaceSpec {
  title: string;
  subtitle?: string;
  badge?: string;
  themeColor?: string;
  widgets: A2UIWidget[];
}

function asTrimmedString(val: unknown, maxLen = 240): string {
  return typeof val === 'string' ? val.trim().slice(0, maxLen) : '';
}

function parseWidget(raw: unknown): A2UIWidget | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const w = raw as Record<string, unknown>;
  const type = String(w.type ?? '').trim().toLowerCase();

  if (type === 'kpi_grid' && Array.isArray(w.items)) {
    const items = w.items
      .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
      .slice(0, 6)
      .map((it) => ({
        label: asTrimmedString(it.label, 60) || 'Metric',
        value: asTrimmedString(it.value, 48) || '—',
        delta: asTrimmedString(it.delta, 40) || undefined,
        hint: asTrimmedString(it.hint, 90) || undefined,
      }));
    return items.length > 0 ? { type: 'kpi_grid', items } : null;
  }

  if (type === 'comparison_cards' && Array.isArray(w.cards)) {
    const cards = w.cards
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
      .slice(0, 4)
      .map((c) => {
        const rawPoints = Array.isArray(c.points)
          ? c.points
          : Array.isArray(c.highlights)
            ? c.highlights
            : [];
        return {
          title: asTrimmedString(c.title, 80) || 'Option',
          subtitle: asTrimmedString(c.subtitle, 100) || undefined,
          badge: asTrimmedString(c.badge, 32) || undefined,
          points: rawPoints.map((p) => asTrimmedString(p, 160)).filter(Boolean).slice(0, 6),
          actionLabel: asTrimmedString(c.actionLabel, 48) || undefined,
          actionPrompt: asTrimmedString(c.actionPrompt, 400) || undefined,
        };
      });
    return cards.length > 0 ? { type: 'comparison_cards', cards } : null;
  }

  if (type === 'checklist' && Array.isArray(w.items)) {
    const items = w.items
      .filter((it): it is Record<string, unknown> => Boolean(it && typeof it === 'object'))
      .slice(0, 12)
      .map((it, idx) => ({
        id: asTrimmedString(it.id, 48) || `chk_${idx}`,
        label: asTrimmedString(it.label, 160) || `Step ${idx + 1}`,
        checked: Boolean(it.checked),
        note: asTrimmedString(it.note, 140) || undefined,
      }));
    return items.length > 0
      ? {
          type: 'checklist',
          title: asTrimmedString(w.title, 80) || undefined,
          items,
        }
      : null;
  }

  if (type === 'form' && Array.isArray(w.fields)) {
    const fields = w.fields
      .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
      .slice(0, 8)
      .map((f, idx) => {
        const rawKind = String(f.kind ?? 'text').toLowerCase();
        const kind: 'text' | 'number' | 'select' | 'toggle' =
          rawKind === 'number' || rawKind === 'select' || rawKind === 'toggle'
            ? rawKind
            : 'text';
        const defaultValue =
          typeof f.defaultValue === 'string' ||
          typeof f.defaultValue === 'number' ||
          typeof f.defaultValue === 'boolean'
            ? f.defaultValue
            : undefined;
        return {
          id: asTrimmedString(f.id, 48) || `field_${idx}`,
          label: asTrimmedString(f.label, 80) || `Field ${idx + 1}`,
          kind,
          placeholder: asTrimmedString(f.placeholder, 80) || undefined,
          defaultValue,
          options: Array.isArray(f.options)
            ? f.options.map((o) => asTrimmedString(o, 60)).filter(Boolean).slice(0, 12)
            : undefined,
        };
      });
    return fields.length > 0
      ? {
          type: 'form',
          title: asTrimmedString(w.title, 80) || undefined,
          submitLabel: asTrimmedString(w.submitLabel, 48) || 'Apply & Run',
          promptTemplate: asTrimmedString(w.promptTemplate, 320) || undefined,
          fields,
        }
      : null;
  }

  if (type === 'timeline' && Array.isArray(w.steps)) {
    const steps = w.steps
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
      .slice(0, 8)
      .map((s) => {
        const rawStatus = String(s.status ?? 'upcoming').toLowerCase();
        const status: 'done' | 'active' | 'upcoming' =
          rawStatus === 'done' || rawStatus === 'active' ? rawStatus : 'upcoming';
        return {
          title: asTrimmedString(s.title, 90) || 'Step',
          detail: asTrimmedString(s.detail, 200) || undefined,
          status,
        };
      });
    return steps.length > 0
      ? {
          type: 'timeline',
          title: asTrimmedString(w.title, 80) || undefined,
          steps,
        }
      : null;
  }

  if (type === 'bar_chart' && Array.isArray(w.bars)) {
    const bars = w.bars
      .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
      .slice(0, 8)
      .map((b) => ({
        label: asTrimmedString(b.label, 60) || 'Item',
        value: typeof b.value === 'number' && Number.isFinite(b.value) ? b.value : 0,
        max:
          typeof b.max === 'number' && Number.isFinite(b.max) && b.max > 0 ? b.max : undefined,
        note: asTrimmedString(b.note, 60) || undefined,
      }));
    return bars.length > 0
      ? {
          type: 'bar_chart',
          title: asTrimmedString(w.title, 80) || undefined,
          unit: asTrimmedString(w.unit, 20) || undefined,
          bars,
        }
      : null;
  }

  if (type === 'actions' && Array.isArray(w.buttons)) {
    const buttons = w.buttons
      .filter((b): b is Record<string, unknown> => Boolean(b && typeof b === 'object'))
      .slice(0, 6)
      .map((b) => {
        const tone = b.style ?? b.variant;
        return {
          label: asTrimmedString(b.label, 48) || 'Run',
          prompt: asTrimmedString(b.prompt, 400),
          style: (tone === 'primary' ? 'primary' : 'secondary') as 'primary' | 'secondary',
        };
      })
      .filter((b) => b.prompt.length > 0);
    return buttons.length > 0 ? { type: 'actions', buttons } : null;
  }

  if (type === 'callout') {
    const text = asTrimmedString(w.text ?? w.body, 500);
    if (!text) return null;
    const rawTone = String(w.tone ?? 'info').toLowerCase();
    const tone: 'info' | 'success' | 'warning' =
      rawTone === 'success' || rawTone === 'tip'
        ? 'success'
        : rawTone === 'warning'
          ? 'warning'
          : 'info';
    return {
      type: 'callout',
      title: asTrimmedString(w.title, 80) || undefined,
      text,
      tone,
    };
  }

  return null;
}

const PLAIN_OR_CODE_ONLY_RE =
  /\b(plain text only|raw json only|code only|just the code|no widget|without a2ui|skip a2ui|only code)\b/i;

const SHORT_GREETING_RE =
  /^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening|thanks|thank you|thx|ok|okay|cool|great|bye|goodbye)[!.?\s]*$/i;

const SMART_A2UI_INTENT_RE =
  /\b(compare|comparison|vs\.?|versus|pros and cons|trade-?offs?|steps?|step-by-step|plan|planning|roadmap|schedule|timeline|checklist|to-?do|todo|metrics?|kpi|budget|forecast|numbers?|table of|breakdown|chart|graph|dashboard|form|parameters?|quiz|flashcards?|study plan|review plan|milestones?|analyze|audit)\b/i;

export function resolveA2uiMode(settings?: {
  a2uiMode?: A2uiMode;
  a2uiEnabled?: boolean;
}): A2uiMode {
  if (
    settings?.a2uiMode === 'off' ||
    settings?.a2uiMode === 'smart' ||
    settings?.a2uiMode === 'always'
  ) {
    return settings.a2uiMode;
  }
  if (settings?.a2uiEnabled === false) return 'off';
  return 'smart';
}

export function shouldOfferA2ui(
  userText: string,
  chatMode: ChatMode,
  a2uiMode: A2uiMode,
  lastAssistantHadA2ui: boolean
): boolean {
  if (a2uiMode === 'off') return false;
  if (a2uiMode === 'always') return true;

  const trimmed = userText.trim();
  if (!trimmed) return false;
  if (PLAIN_OR_CODE_ONLY_RE.test(trimmed)) return false;
  if (SHORT_GREETING_RE.test(trimmed)) return false;

  const hasIntent = SMART_A2UI_INTENT_RE.test(trimmed);
  if (chatMode === 'general') {
    if (!hasIntent) return false;
    if (lastAssistantHadA2ui && trimmed.split(/\s+/).length < 6) {
      return false;
    }
    return true;
  }

  if (hasIntent) return true;

  // In Pro & Study modes, skip short conversational prompts when there is no structured/numeric/planning signal
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 6) return false;

  // Avoid consecutive unsolicited A2UI widgets if the previous turn already rendered one without explicit intent
  if (lastAssistantHadA2ui) return false;

  return chatMode === 'professional' && /\b(pptx|xlsx|docx|pdf|build|create|report|notes?)\b/i.test(trimmed);
}

export function repairA2uiJson(raw: string): string {
  let text = raw.trim();
  // Strip outer markdown fence remnants if accidentally included
  text = text.replace(/^```(?:a2ui|artifact-a2ui|json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // Replace curly smart quotes with straight quotes
  text = text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Trim leading/trailing non-JSON prose outside the outermost braces
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([}\]])/g, '$1');
  return text;
}

export function parseA2uiBlock(language: string, code: string): A2UISurfaceSpec | null {
  const norm = language.trim().toLowerCase();
  if (norm !== 'a2ui' && norm !== 'artifact-a2ui') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch {
    try {
      parsed = JSON.parse(repairA2uiJson(code));
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const rawWidgets = Array.isArray(obj.widgets) ? obj.widgets : [];
  const widgets = rawWidgets
    .map(parseWidget)
    .filter((w): w is A2UIWidget => Boolean(w))
    .slice(0, 8);
  if (widgets.length === 0) return null;

  return {
    title: asTrimmedString(obj.title, 100) || 'Interactive Panel',
    subtitle: asTrimmedString(obj.subtitle, 180) || undefined,
    badge: asTrimmedString(obj.badge, 32) || undefined,
    themeColor: asTrimmedString(obj.themeColor, 16) || undefined,
    widgets,
  };
}
