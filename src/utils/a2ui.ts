import type { A2uiMode, AppSettings, ChatMode } from '../types';

export const A2UI_MODES: A2uiMode[] = ['off', 'smart', 'always'];

export function readA2uiMode(settings?: Partial<Pick<AppSettings, 'a2uiMode' | 'a2uiEnabled'>>): A2uiMode {
  if (settings?.a2uiMode && A2UI_MODES.includes(settings.a2uiMode)) return settings.a2uiMode;
  return settings?.a2uiEnabled === false ? 'off' : 'smart';
}

const PLAIN_OUTPUT = /\b(?:(?:plain text|(?:raw )?json|code) only|only (?:respond with |provide |return |the )?(?:code|raw json|plain text)|(?:no|without) (?:widgets?|a2ui|markdown|explanations?))\b/i;
const GREETING = /^(?:hi|hello|hey|good (?:morning|afternoon|evening)|thank(?:s| you))[!.\s]*$/i;
const WIDGET_INTENT = /\b(?:compare|versus|vs|trade-?offs|checklist|to-?do list|step by step|steps|plan|roadmap|schedule|timeline|milestones|metrics|kpis?|budget|forecast|(?:bar )?chart|table of (?:numbers|results)|rank|form|next steps)\b/i;
const SUPPORTING_INTENT = /\b(?:plan|process|recap|review|progress|status|options|results)\b/i;

export function requestsPlainA2uiOutput(text: string): boolean {
  return PLAIN_OUTPUT.test(text) || GREETING.test(text.trim());
}

export function shouldOfferA2ui(
  userText: string, chatMode: ChatMode, a2uiMode: A2uiMode, lastAssistantHadA2ui: boolean
): boolean {
  if (a2uiMode === 'always') return true;
  if (a2uiMode === 'off') return false;
  const text = userText.trim();
  if (!text || requestsPlainA2uiOutput(text)) return false;
  if (WIDGET_INTENT.test(text)) return true;
  return chatMode !== 'general' && !lastAssistantHadA2ui && SUPPORTING_INTENT.test(text);
}

// Keep other fenced languages intact, including examples containing an A2UI fence.
export function limitA2uiFences(text: string, allow: boolean): string {
  if (!/a2ui/i.test(text)) return text;
  let fence: { marker: string; skip: boolean } | undefined;
  let seen = false;
  return text.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (fence) {
      const { skip, marker } = fence;
      if (trimmed.length >= marker.length && [...trimmed].every((char) => char === marker[0])) {
        fence = undefined;
      }
      return !skip;
    }
    const opening = /^(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(trimmed);
    if (!opening) return true;
    const isWidget = /^(?:artifact-)?a2ui$/i.test(opening[2]);
    fence = { marker: opening[1], skip: isWidget && (!allow || seen) };
    if (isWidget) seen = true;
    return !fence.skip;
  }).join('\n');
}

function repairA2uiJson(code: string): string {
  let repaired = '';
  let closingQuote = '';
  let escaped = false;
  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    if (closingQuote) {
      if (escaped) {
        repaired += char;
        escaped = false;
      } else if (char === '\\') {
        repaired += char;
        escaped = true;
      } else if (char === closingQuote) {
        repaired += '"';
        closingQuote = '';
      } else {
        repaired += char === '"' ? '\\"' : char;
      }
    } else if (char === '"' || char === '“' || char === '”') {
      closingQuote = char === '“' ? '”' : char;
      repaired += '"';
    } else if (char !== ',' || !/^\s*[}\]]/.test(code.slice(i + 1))) {
      repaired += char;
    }
  }
  return repaired;
}

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

export function parseA2uiBlock(language: string, code: string, maxWidgets = 8): A2UISurfaceSpec | null {
  const norm = language.trim().toLowerCase();
  if (norm !== 'a2ui' && norm !== 'artifact-a2ui') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch {
    try { parsed = JSON.parse(repairA2uiJson(code)); }
    catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const rawWidgets = Array.isArray(obj.widgets) ? obj.widgets : [];
  const widgets = rawWidgets
    .map(parseWidget)
    .filter((w): w is A2UIWidget => Boolean(w))
    .slice(0, maxWidgets);
  if (widgets.length === 0) return null;

  return {
    title: asTrimmedString(obj.title, 100) || 'Interactive Panel',
    subtitle: asTrimmedString(obj.subtitle, 180) || undefined,
    badge: asTrimmedString(obj.badge, 32) || undefined,
    themeColor: asTrimmedString(obj.themeColor, 16) || undefined,
    widgets,
  };
}

export function loadA2uiState<T extends boolean | Record<string, unknown>>(
  storage: Pick<Storage, 'getItem'>, key: string, fallback: T
): T {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? 'null');
    if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value as T : fallback;
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...(fallback as Record<string, unknown>), ...value } as T : fallback;
  } catch {
    return fallback;
  }
}
