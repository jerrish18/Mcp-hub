import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  ExternalLink,
  HelpCircle,
  Layers,
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
import {
  extractOutlineHeadings,
  parseInlineTokens,
  parseMarkdownBlocks,
  stripMarkdownForSpeech,
  type MarkdownBlock,
} from '../../utils/markdownParser';
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
  onOpenFlashcards?: () => void;
  onOpenQuiz?: () => void;
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
    calloutBorder: '#B07D2B',
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

function renderStudyInline(text: string, theme: (typeof THEME_STYLES)[ReaderTheme]): React.ReactNode[] {
  const tokens = parseInlineTokens(text);
  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case 'code':
        return (
          <code
            key={idx}
            style={{ backgroundColor: theme.codeBg, color: theme.heading }}
            className="px-1.5 py-0.5 rounded-md font-mono text-[0.87em]"
          >
            {tok.text}
          </code>
        );
      case 'bold':
        return (
          <strong key={idx} style={{ color: theme.heading }} className="font-semibold">
            {tok.text}
          </strong>
        );
      case 'italic':
        return (
          <em key={idx} className="italic">
            {tok.text}
          </em>
        );
      case 'strike':
        return (
          <del key={idx} className="line-through opacity-75">
            {tok.text}
          </del>
        );
      case 'math':
        return (
          <code
            key={idx}
            style={{ backgroundColor: theme.calloutBg, color: theme.calloutBorder }}
            className="px-1.5 py-0.5 rounded-md font-mono text-[0.9em]"
          >
            {tok.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={idx}
            href={tok.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: theme.calloutBorder }}
            className="underline underline-offset-2 hover:opacity-80"
          >
            {tok.label}
          </a>
        );
      default:
        return <React.Fragment key={idx}>{tok.text}</React.Fragment>;
    }
  });
}

function renderStudyBlock(
  block: MarkdownBlock,
  key: number,
  theme: (typeof THEME_STYLES)[ReaderTheme],
  onOpenFlashcards?: () => void,
  onOpenQuiz?: () => void
): React.ReactNode {
  switch (block.type) {
    case 'code': {
      const lang = block.language.toLowerCase();
      if (lang === 'study-flashcards' && onOpenFlashcards) {
        return (
          <div
            key={key}
            style={{ backgroundColor: theme.calloutBg, borderColor: theme.border }}
            className="my-4 rounded-2xl border p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Layers style={{ color: theme.calloutBorder }} className="w-5 h-5 shrink-0" />
              <span style={{ color: theme.heading }} className="text-sm font-semibold">
                Flashcards Deck Ready
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenFlashcards();
              }}
              style={{ backgroundColor: theme.heading, color: theme.surface }}
              className="min-h-[38px] px-4 rounded-full text-xs font-semibold shrink-0"
            >
              Open Flashcards
            </button>
          </div>
        );
      }
      if (lang === 'study-quiz' && onOpenQuiz) {
        return (
          <div
            key={key}
            style={{ backgroundColor: theme.calloutBg, borderColor: theme.border }}
            className="my-4 rounded-2xl border p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <HelpCircle style={{ color: theme.calloutBorder }} className="w-5 h-5 shrink-0" />
              <span style={{ color: theme.heading }} className="text-sm font-semibold">
                Practice Quiz Ready
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenQuiz();
              }}
              style={{ backgroundColor: theme.heading, color: theme.surface }}
              className="min-h-[38px] px-4 rounded-full text-xs font-semibold shrink-0"
            >
              Start Quiz
            </button>
          </div>
        );
      }

      return (
        <div
          key={key}
          style={{ backgroundColor: theme.codeBg, borderColor: theme.border }}
          className="my-4 rounded-2xl border overflow-hidden"
        >
          <div
            style={{ borderColor: theme.border, color: theme.muted }}
            className="px-4 py-1.5 border-b text-xs font-mono"
          >
            {block.language || 'code'}
          </div>
          <pre
            style={{ color: theme.heading }}
            className="p-4 overflow-x-auto text-[14px] leading-relaxed font-mono"
          >
            <code>{block.code}</code>
          </pre>
        </div>
      );
    }

    case 'heading':
      if (block.level === 1) {
        return (
          <h1
            key={key}
            id={block.id}
            style={{ color: theme.heading, borderColor: theme.border }}
            className="font-display text-2xl sm:text-[28px] font-bold pt-2 pb-2 border-b scroll-mt-4"
          >
            {renderStudyInline(block.text, theme)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2
            key={key}
            id={block.id}
            style={{ color: theme.heading }}
            className="font-display text-xl sm:text-[22px] font-bold pt-3 scroll-mt-4"
          >
            {renderStudyInline(block.text, theme)}
          </h2>
        );
      }
      return (
        <h3
          key={key}
          id={block.id}
          style={{ color: theme.heading }}
          className="font-display text-lg font-semibold pt-2 scroll-mt-4"
        >
          {renderStudyInline(block.text, theme)}
        </h3>
      );

    case 'hr':
      return <hr key={key} style={{ borderColor: theme.border }} className="my-4" />;

    case 'table':
      return (
        <div
          key={key}
          style={{ borderColor: theme.border, backgroundColor: theme.bg }}
          className="my-4 overflow-x-auto rounded-2xl border"
        >
          <table className="w-full text-left border-collapse text-[0.86em]">
            <thead>
              <tr style={{ backgroundColor: theme.calloutBg, borderColor: theme.border }} className="border-b">
                {block.headers.map((h, hi) => (
                  <th
                    key={hi}
                    style={{ color: theme.heading, textAlign: block.alignments[hi] ?? 'left' }}
                    className="px-4 py-2.5 font-semibold whitespace-nowrap"
                  >
                    {renderStudyInline(h, theme)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {block.rows.map((row, ri) => (
                <tr key={ri} style={{ borderColor: theme.border }} className="border-t">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{ color: theme.text, textAlign: block.alignments[ci] ?? 'left' }}
                      className="px-4 py-2.5 align-top leading-relaxed min-w-[120px]"
                    >
                      {renderStudyInline(cell, theme)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'blockquote':
      return (
        <div
          key={key}
          style={{
            backgroundColor: theme.calloutBg,
            borderColor: theme.border,
            color: theme.heading,
          }}
          className="my-3 rounded-2xl border px-4 py-3 text-[0.95em] flex items-start gap-2.5"
        >
          <Sparkles style={{ color: theme.calloutBorder }} className="w-4 h-4 shrink-0 mt-1" />
          <div className="min-w-0 whitespace-pre-wrap">{renderStudyInline(block.lines.join('\n'), theme)}</div>
        </div>
      );

    case 'ul':
      return (
        <ul key={key} className="space-y-2 pl-1">
          {block.items.map((item, li) => (
            <li key={li} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                style={{ backgroundColor: theme.calloutBorder }}
                className="mt-2.5 w-1.5 h-1.5 rounded-full shrink-0"
              />
              <span className="min-w-0 flex-1">{renderStudyInline(item.text, theme)}</span>
            </li>
          ))}
        </ul>
      );

    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-6 space-y-2">
          {block.items.map((item, li) => (
            <li key={li}>{renderStudyInline(item, theme)}</li>
          ))}
        </ol>
      );

    case 'paragraph':
      return (
        <p key={key} className="whitespace-pre-wrap">
          {renderStudyInline(block.text, theme)}
        </p>
      );
  }
}

export function StudyReaderModal({
  open,
  title,
  content,
  modelLabel,
  citations,
  onClose,
  onAskFollowUp,
  onOpenFlashcards,
  onOpenQuiz,
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

  const { blocks, headings } = useMemo(() => {
    const parsed = parseMarkdownBlocks(content);
    const foundHeadings = extractOutlineHeadings(parsed);
    return { blocks: parsed, headings: foundHeadings };
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
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(content));
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
            <div style={{ color: theme.muted }} className="text-[11px] flex items-center gap-2 truncate tabular-nums">
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

          <button
            type="button"
            onClick={() => setFontFamily((f) => (f === 'sans' ? 'serif' : 'sans'))}
            aria-label={`Switch font to ${fontFamily === 'sans' ? 'serif' : 'sans-serif'}`}
            style={{ backgroundColor: theme.chipBg, color: theme.heading, borderColor: theme.border }}
            className="min-h-[36px] px-2.5 rounded-full border text-xs font-semibold"
          >
            {fontFamily === 'serif' ? 'Serif' : 'Sans'}
          </button>

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
          className="max-w-[74ch] mx-auto rounded-[28px] border px-5 sm:px-10 py-7 sm:py-10 shadow-sm space-y-5"
        >
          <div className={`space-y-4 ${fontSizeClass}`}>
            {blocks.map((block, i) =>
              renderStudyBlock(block, i, theme, onOpenFlashcards, onOpenQuiz)
            )}
          </div>

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
            className="pt-5 border-t flex flex-wrap items-center justify-between gap-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              {onOpenFlashcards && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFlashcards();
                  }}
                  style={{
                    backgroundColor: theme.chipBg,
                    color: theme.heading,
                    borderColor: theme.border,
                  }}
                  className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Flashcards</span>
                </button>
              )}
              {onOpenQuiz && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenQuiz();
                  }}
                  style={{
                    backgroundColor: theme.chipBg,
                    color: theme.heading,
                    borderColor: theme.border,
                  }}
                  className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Quiz Me</span>
                </button>
              )}
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
                  className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 hover:opacity-90"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  <span>Ask follow-up</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: theme.heading,
                color: theme.surface,
              }}
              className="min-h-[40px] px-5 rounded-full text-xs font-semibold hover:opacity-90"
            >
              Done Reading
            </button>
          </div>
        </article>
      </div>
    </motion.div>
  );
}
