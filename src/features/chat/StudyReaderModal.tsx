import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  ExternalLink,
  MessageSquarePlus,
  Moon,
  Sparkles,
  Sun,
  Type,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { GroundingCitation } from '../../types';
import { M3_EMPHASIZED_EASE } from '../../utils/motion';

export type ReaderTheme = 'warm_paper' | 'daylight' | 'night_slate';
export type ReaderFontSize = 'compact' | 'comfortable' | 'large';
export type ReaderFontFamily = 'sans' | 'serif';

interface StudyReaderModalProps {
  open: boolean;
  title?: string;
  content: string;
  modelLabel?: string;
  citations?: GroundingCitation[];
  onClose: () => void;
  onAskFollowUp?: (excerpt?: string) => void;
}

interface OutlineHeading {
  id: string;
  level: number;
  text: string;
}

const THEME_STYLES: Record<
  ReaderTheme,
  {
    label: string;
    bg: string;
    surface: string;
    border: string;
    text: string;
    muted: string;
    heading: string;
    calloutBg: string;
    calloutBorder: string;
    codeBg: string;
    chipBg: string;
  }
> = {
  warm_paper: {
    label: 'Warm Paper',
    bg: '#F7F2E8',
    surface: '#FCF9F2',
    border: '#E5DCCB',
    text: '#2B241B',
    muted: '#6F6353',
    heading: '#1B160F',
    calloutBg: '#F1E9D8',
    calloutBorder: '#C79B52',
    codeBg: '#EFE7D6',
    chipBg: '#ECE3D1',
  },
  daylight: {
    label: 'Daylight',
    bg: '#F4F7FB',
    surface: '#FFFFFF',
    border: '#DCE4F0',
    text: '#1E2430',
    muted: '#5D687A',
    heading: '#0E131D',
    calloutBg: '#EEF4FF',
    calloutBorder: '#2E6BE6',
    codeBg: '#F1F5F9',
    chipBg: '#E7EEF8',
  },
  night_slate: {
    label: 'Night Slate',
    bg: '#0E1218',
    surface: '#151B24',
    border: '#263040',
    text: '#E4EAF3',
    muted: '#9AA8BD',
    heading: '#F8FAFC',
    calloutBg: '#1C2636',
    calloutBorder: '#60A5FA',
    codeBg: '#1D2532',
    chipBg: '#1F2937',
  },
};

function slugifyHeading(text: string, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `study-sec-${base || 'part'}-${index}`;
}

function renderStudyInline(text: string, theme: (typeof THEME_STYLES)[ReaderTheme]): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={idx}
          style={{ backgroundColor: theme.codeBg, color: theme.heading }}
          className="px-1.5 py-0.5 rounded-md font-mono text-[0.88em]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={idx} style={{ color: theme.heading }} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    }
    if (
      ((token.startsWith('*') && token.endsWith('*')) ||
        (token.startsWith('_') && token.endsWith('_'))) &&
      token.length > 2
    ) {
      return (
        <em key={idx} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
}

export function StudyReaderModal({
  open,
  title,
  content,
  modelLabel,
  citations,
  onClose,
  onAskFollowUp,
}: StudyReaderModalProps) {
  const [themeKey, setThemeKey] = useState<ReaderTheme>('warm_paper');
  const [fontSize, setFontSize] = useState<ReaderFontSize>('comfortable');
  const [fontFamily, setFontFamily] = useState<ReaderFontFamily>('sans');
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const theme = THEME_STYLES[themeKey];

  const stats = useMemo(() => {
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 180));
    return { words, minutes };
  }, [content]);

  const { segments, headings } = useMemo(() => {
    const segs: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
    const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = fenceRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segs.push({ type: 'text', content: content.slice(lastIndex, match.index) });
      }
      segs.push({ type: 'code', lang: match[1] || 'text', content: match[2].replace(/\n$/, '') });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      segs.push({ type: 'text', content: content.slice(lastIndex) });
    }

    const foundHeadings: OutlineHeading[] = [];
    let hCounter = 0;
    for (const seg of segs) {
      if (seg.type !== 'text') continue;
      for (const line of seg.content.split('\n')) {
        const m = /^(#{1,3})\s+(.+)$/.exec(line.trim());
        if (m) {
          const clean = m[2].replace(/\*\*/g, '').replace(/`/g, '').trim();
          foundHeadings.push({
            id: slugifyHeading(clean, hCounter++),
            level: m[1].length,
            text: clean,
          });
        }
      }
    }

    return { segments: segs, headings: foundHeadings };
  }, [content]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setSpeaking(false);
    };
  }, [open, onClose]);

  if (!open) return null;

  const fontSizeClass =
    fontSize === 'compact'
      ? 'text-[15px] leading-[1.7]'
      : fontSize === 'large'
        ? 'text-[19px] leading-[1.82]'
        : 'text-[17px] leading-[1.76]';

  const fontFamilyStyle =
    fontFamily === 'serif'
      ? { fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }
      : { fontFamily: 'var(--font-body)' };

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleToggleListen = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content.replace(/[#*`>]/g, ''));
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const jumpToHeading = (id: string) => {
    const el = scrollContainerRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  let headingRenderIdx = 0;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Study Reader"
      data-testid="study-reader-modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={M3_EMPHASIZED_EASE}
      style={{ backgroundColor: theme.bg, color: theme.text }}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
    >
      {/* Top Distraction-Free Reader Toolbar */}
      <header
        style={{ backgroundColor: theme.surface, borderColor: theme.border }}
        className="shrink-0 border-b px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 pt-safe"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            style={{ backgroundColor: theme.calloutBg, color: theme.calloutBorder }}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          >
            <BookOpen className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div style={{ color: theme.heading }} className="font-display text-sm font-bold truncate">
              {title || 'Study Reader'}
            </div>
            <div style={{ color: theme.muted }} className="text-[11px] flex items-center gap-2 truncate">
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {stats.minutes} min read · {stats.words} words
              </span>
              {modelLabel && <span>· {modelLabel}</span>}
            </div>
          </div>
        </div>

        {/* Reading Comfort Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Paper / Daylight / Night Switcher */}
          <div
            style={{ backgroundColor: theme.chipBg, borderColor: theme.border }}
            className="flex items-center gap-0.5 p-0.5 rounded-full border"
            role="group"
            aria-label="Reader background theme"
          >
            {(
              [
                { id: 'warm_paper', label: 'Warm Paper', Icon: BookOpen },
                { id: 'daylight', label: 'Daylight', Icon: Sun },
                { id: 'night_slate', label: 'Night', Icon: Moon },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = themeKey === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemeKey(id)}
                  aria-label={`${label} reader theme`}
                  aria-pressed={active}
                  style={
                    active
                      ? { backgroundColor: theme.surface, color: theme.heading }
                      : { color: theme.muted }
                  }
                  className="min-h-[34px] px-2.5 rounded-full text-xs font-medium inline-flex items-center gap-1 transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Font Size Cycle */}
          <button
            type="button"
            onClick={() => {
              const order: ReaderFontSize[] = ['compact', 'comfortable', 'large'];
              setFontSize(order[(order.indexOf(fontSize) + 1) % order.length]);
            }}
            aria-label={`Font size: ${fontSize}, tap to change`}
            style={{ backgroundColor: theme.chipBg, color: theme.heading, borderColor: theme.border }}
            className="min-h-[36px] px-2.5 rounded-full border text-xs font-medium inline-flex items-center gap-1"
          >
            <Type className="w-3.5 h-3.5" />
            <span className="capitalize hidden md:inline">{fontSize}</span>
          </button>

          {/* Sans / Serif Toggle */}
          <button
            type="button"
            onClick={() => setFontFamily((f) => (f === 'sans' ? 'serif' : 'sans'))}
            aria-label={`Switch font to ${fontFamily === 'sans' ? 'serif' : 'sans-serif'}`}
            style={{ backgroundColor: theme.chipBg, color: theme.heading, borderColor: theme.border }}
            className="min-h-[36px] px-2.5 rounded-full border text-xs font-semibold"
          >
            {fontFamily === 'serif' ? 'Serif' : 'Sans'}
          </button>

          {/* Listen TTS */}
          <button
            type="button"
            onClick={handleToggleListen}
            aria-label={speaking ? 'Stop reading aloud' : 'Read notes aloud'}
            style={{ backgroundColor: theme.chipBg, color: theme.heading, borderColor: theme.border }}
            className="min-h-[36px] min-w-[36px] px-2.5 rounded-full border text-xs font-medium inline-flex items-center gap-1"
          >
            {speaking ? <VolumeX className="w-3.5 h-3.5 text-rose-500" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{speaking ? 'Stop' : 'Listen'}</span>
          </button>

          {/* Copy Notes */}
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy study notes"
            style={{ backgroundColor: theme.chipBg, color: theme.heading, borderColor: theme.border }}
            className="min-h-[36px] min-w-[36px] px-2.5 rounded-full border text-xs font-medium inline-flex items-center gap-1"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Study Reader"
            style={{ backgroundColor: theme.chipBg, color: theme.heading, borderColor: theme.border }}
            className="min-h-[38px] min-w-[38px] rounded-full border flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Section Outline Jump Strip */}
      {headings.length > 1 && (
        <div
          style={{ backgroundColor: theme.surface, borderColor: theme.border }}
          className="shrink-0 border-b px-3 sm:px-6 py-2 overflow-x-auto no-scrollbar"
        >
          <div className="max-w-3xl mx-auto flex items-center gap-1.5">
            <span style={{ color: theme.muted }} className="text-[11px] font-semibold uppercase tracking-wide mr-1 shrink-0">
              Jump to:
            </span>
            {headings.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => jumpToHeading(h.id)}
                style={{ backgroundColor: theme.chipBg, color: theme.text }}
                className="min-h-[30px] px-3 rounded-full text-xs font-medium whitespace-nowrap hover:opacity-80 transition-opacity"
              >
                {h.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Centered Editorial Reading Canvas */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 sm:py-10">
        <article
          style={{
            backgroundColor: theme.surface,
            borderColor: theme.border,
            ...fontFamilyStyle,
          }}
          className="max-w-[72ch] mx-auto rounded-[28px] border px-5 sm:px-10 py-7 sm:py-10 shadow-sm space-y-5"
        >
          <div className={`space-y-4 ${fontSizeClass}`}>
            {segments.map((seg, i) => {
              if (seg.type === 'code') {
                return (
                  <div
                    key={i}
                    style={{ backgroundColor: theme.codeBg, borderColor: theme.border }}
                    className="my-4 rounded-2xl border overflow-hidden"
                  >
                    <div
                      style={{ borderColor: theme.border, color: theme.muted }}
                      className="px-4 py-1.5 border-b text-xs font-mono"
                    >
                      {seg.lang || 'code'}
                    </div>
                    <pre
                      style={{ color: theme.heading }}
                      className="p-4 overflow-x-auto text-[14px] leading-relaxed font-mono"
                    >
                      <code>{seg.content}</code>
                    </pre>
                  </div>
                );
              }

              const lines = seg.content.split('\n');
              const nodes: React.ReactNode[] = [];
              let idx = 0;
              let bIdx = 0;

              while (idx < lines.length) {
                const line = lines[idx];
                const trimmed = line.trim();
                if (!trimmed) {
                  idx++;
                  continue;
                }

                const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
                if (headingMatch) {
                  const level = headingMatch[1].length;
                  const cleanText = headingMatch[2].replace(/\*\*/g, '').replace(/`/g, '').trim();
                  const assignedId = headings[headingRenderIdx]?.id ?? slugifyHeading(cleanText, headingRenderIdx);
                  headingRenderIdx++;

                  if (level === 1) {
                    nodes.push(
                      <h1
                        key={`${i}-${bIdx++}`}
                        id={assignedId}
                        style={{ color: theme.heading, borderColor: theme.border }}
                        className="font-display text-2xl sm:text-[28px] font-bold pt-2 pb-2 border-b scroll-mt-4"
                      >
                        {renderStudyInline(headingMatch[2], theme)}
                      </h1>
                    );
                  } else if (level === 2) {
                    nodes.push(
                      <h2
                        key={`${i}-${bIdx++}`}
                        id={assignedId}
                        style={{ color: theme.heading }}
                        className="font-display text-xl sm:text-[22px] font-bold pt-3 flex items-center gap-2 scroll-mt-4"
                      >
                        <span
                          style={{ backgroundColor: theme.calloutBorder }}
                          className="w-1.5 h-5 rounded-full shrink-0"
                        />
                        <span>{renderStudyInline(headingMatch[2], theme)}</span>
                      </h2>
                    );
                  } else {
                    nodes.push(
                      <h3
                        key={`${i}-${bIdx++}`}
                        id={assignedId}
                        style={{ color: theme.heading }}
                        className="font-display text-lg font-semibold pt-2 scroll-mt-4"
                      >
                        {renderStudyInline(headingMatch[2], theme)}
                      </h3>
                    );
                  }
                  idx++;
                  continue;
                }

                if (/^\s*>/.test(line)) {
                  const quoteLines: string[] = [];
                  while (idx < lines.length && /^\s*>/.test(lines[idx])) {
                    quoteLines.push(lines[idx].replace(/^\s*>\s?/, ''));
                    idx++;
                  }
                  nodes.push(
                    <blockquote
                      key={`${i}-${bIdx++}`}
                      style={{
                        backgroundColor: theme.calloutBg,
                        borderLeftColor: theme.calloutBorder,
                        color: theme.heading,
                      }}
                      className="my-3 rounded-r-2xl border-l-4 px-4 py-3 text-[0.96em] whitespace-pre-wrap"
                    >
                      {renderStudyInline(quoteLines.join('\n'), theme)}
                    </blockquote>
                  );
                  continue;
                }

                if (/^\s*[-*]\s+/.test(line)) {
                  const listItems: string[] = [];
                  while (idx < lines.length && /^\s*[-*]\s+/.test(lines[idx])) {
                    listItems.push(lines[idx].replace(/^\s*[-*]\s+/, ''));
                    idx++;
                  }
                  nodes.push(
                    <ul key={`${i}-${bIdx++}`} className="list-disc pl-6 space-y-2">
                      {listItems.map((item, li) => (
                        <li key={li}>{renderStudyInline(item, theme)}</li>
                      ))}
                    </ul>
                  );
                  continue;
                }

                if (/^\s*\d+\.\s+/.test(line)) {
                  const listItems: string[] = [];
                  while (idx < lines.length && /^\s*\d+\.\s+/.test(lines[idx])) {
                    listItems.push(lines[idx].replace(/^\s*\d+\.\s+/, ''));
                    idx++;
                  }
                  nodes.push(
                    <ol key={`${i}-${bIdx++}`} className="list-decimal pl-6 space-y-2">
                      {listItems.map((item, li) => (
                        <li key={li}>{renderStudyInline(item, theme)}</li>
                      ))}
                    </ol>
                  );
                  continue;
                }

                const paraLines: string[] = [];
                while (
                  idx < lines.length &&
                  lines[idx].trim() !== '' &&
                  !/^(#{1,3})\s+/.test(lines[idx].trim()) &&
                  !/^\s*>/.test(lines[idx]) &&
                  !/^\s*[-*]\s+/.test(lines[idx]) &&
                  !/^\s*\d+\.\s+/.test(lines[idx])
                ) {
                  paraLines.push(lines[idx]);
                  idx++;
                }
                nodes.push(
                  <p key={`${i}-${bIdx++}`} className="whitespace-pre-wrap">
                    {renderStudyInline(paraLines.join('\n'), theme)}
                  </p>
                );
              }

              return nodes;
            })}
          </div>

          {/* Grounded Web Citations */}
          {citations && citations.length > 0 && (
            <div style={{ borderColor: theme.border }} className="pt-5 border-t space-y-2.5">
              <div style={{ color: theme.muted }} className="text-xs font-semibold uppercase tracking-wide">
                Sources & Citations
              </div>
              <div className="flex flex-wrap gap-2">
                {citations.map((c) => (
                  <a
                    key={c.url}
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      backgroundColor: theme.chipBg,
                      borderColor: theme.border,
                      color: theme.heading,
                    }}
                    className="min-h-[34px] px-3 py-1 rounded-full border text-xs font-medium inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                  >
                    <span className="truncate max-w-[220px]">{c.title}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Learning Actions */}
          <div
            style={{ borderColor: theme.border }}
            className="pt-5 border-t flex flex-wrap items-center justify-between gap-3"
          >
            <div style={{ color: theme.muted }} className="text-xs inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Focused Study Reader · Distraction-free mode</span>
            </div>
            <div className="flex items-center gap-2">
              {onAskFollowUp && (
                <button
                  type="button"
                  onClick={() => {
                    onAskFollowUp();
                    onClose();
                  }}
                  style={{
                    backgroundColor: theme.calloutBg,
                    color: theme.calloutBorder,
                    borderColor: theme.border,
                  }}
                  className="min-h-[40px] px-4 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>Ask a follow-up</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                style={{
                  backgroundColor: theme.heading,
                  color: theme.surface,
                }}
                className="min-h-[40px] px-4 rounded-full text-xs font-semibold hover:opacity-90"
              >
                Done Reading
              </button>
            </div>
          </div>
        </article>
      </div>
    </motion.div>
  );
}
