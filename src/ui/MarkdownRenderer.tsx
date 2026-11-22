import React, { useMemo, useState } from 'react';
import { Check, Copy, HelpCircle, Layers, Sparkles } from 'lucide-react';
import {
  parseInlineTokens,
  parseMarkdownBlocks,
  type InlineToken,
  type MarkdownBlock,
} from '../utils/markdownParser';

interface MarkdownRendererProps {
  content: string;
  onOpenInteractiveFlashcards?: () => void;
  onOpenInteractiveQuiz?: () => void;
}

function CodeBlock({
  language,
  code,
  onOpenInteractiveFlashcards,
  onOpenInteractiveQuiz,
}: {
  language: string;
  code: string;
  onOpenInteractiveFlashcards?: () => void;
  onOpenInteractiveQuiz?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const normalizedLang = language.toLowerCase();
  if (normalizedLang === 'study-flashcards' && onOpenInteractiveFlashcards) {
    let count = 0;
    try {
      const parsed = JSON.parse(code) as unknown[];
      if (Array.isArray(parsed)) count = parsed.length;
    } catch {
      // streaming partial JSON
    }
    return (
      <div
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="my-3 rounded-2xl border p-4 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          >
            <Layers className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Interactive Flashcard Deck
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {count > 0 ? `${count} active-recall cards ready to flip` : 'Generating cards...'}
            </div>
          </div>
        </div>
        {count > 0 && (
          <button
            type="button"
            onClick={onOpenInteractiveFlashcards}
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[40px] px-4 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 hover:opacity-90"
          >
            Practice Cards
          </button>
        )}
      </div>
    );
  }

  if (normalizedLang === 'study-quiz' && onOpenInteractiveQuiz) {
    let count = 0;
    try {
      const parsed = JSON.parse(code) as unknown[];
      if (Array.isArray(parsed)) count = parsed.length;
    } catch {
      // streaming partial JSON
    }
    return (
      <div
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="my-3 rounded-2xl border p-4 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          >
            <HelpCircle className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Interactive Practice Quiz
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {count > 0 ? `${count} questions with instant explanations` : 'Preparing quiz...'}
            </div>
          </div>
        </div>
        {count > 0 && (
          <button
            type="button"
            onClick={onOpenInteractiveQuiz}
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[40px] px-4 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 hover:opacity-90"
          >
            Start Quiz
          </button>
        )}
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800 bg-slate-900/90 text-xs text-slate-400">
        <span className="font-mono lowercase">{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code block"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function renderInlineNodes(tokens: InlineToken[]): React.ReactNode[] {
  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case 'code':
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 rounded-md bg-slate-200/75 dark:bg-slate-800 font-mono text-[0.86em] text-slate-900 dark:text-slate-100"
          >
            {tok.text}
          </code>
        );
      case 'bold':
        return (
          <strong key={idx} className="font-semibold text-slate-950 dark:text-white">
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
            className="px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-300 font-mono text-[0.9em]"
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
            className="underline decoration-blue-500/60 underline-offset-2 text-blue-600 dark:text-blue-400 hover:opacity-80"
          >
            {tok.label}
          </a>
        );
      default:
        return <React.Fragment key={idx}>{tok.text}</React.Fragment>;
    }
  });
}

function renderInline(text: string): React.ReactNode[] {
  return renderInlineNodes(parseInlineTokens(text));
}

function renderBlock(
  block: MarkdownBlock,
  key: number,
  onOpenInteractiveFlashcards?: () => void,
  onOpenInteractiveQuiz?: () => void
): React.ReactNode {
  switch (block.type) {
    case 'code':
      return (
        <CodeBlock
          key={key}
          language={block.language}
          code={block.code}
          onOpenInteractiveFlashcards={onOpenInteractiveFlashcards}
          onOpenInteractiveQuiz={onOpenInteractiveQuiz}
        />
      );

    case 'heading': {
      if (block.level === 1) {
        return (
          <h2
            key={key}
            className="font-display text-xl font-bold tracking-tight text-slate-950 dark:text-white pt-3 pb-1 border-b border-slate-200/70 dark:border-slate-800/80"
          >
            {renderInline(block.text)}
          </h2>
        );
      }
      if (block.level === 2) {
        return (
          <h3
            key={key}
            className="font-display text-[17px] font-bold tracking-tight text-slate-950 dark:text-white pt-3"
          >
            {renderInline(block.text)}
          </h3>
        );
      }
      return (
        <h4 key={key} className="font-display text-[15px] font-semibold text-slate-900 dark:text-white pt-2">
          {renderInline(block.text)}
        </h4>
      );
    }

    case 'hr':
      return <hr key={key} className="my-3 border-slate-200 dark:border-slate-800" />;

    case 'table':
      return (
        <div
          key={key}
          style={{ borderColor: 'var(--m3-outline)' }}
          className="my-3 overflow-x-auto rounded-2xl border bg-white/70 dark:bg-slate-950/50"
        >
          <table className="w-full text-left border-collapse text-[13px] sm:text-[13.5px]">
            <thead>
              <tr
                style={{
                  backgroundColor: 'var(--m3-surface-container)',
                  borderColor: 'var(--m3-outline)',
                }}
                className="border-b"
              >
                {block.headers.map((h, hi) => (
                  <th
                    key={hi}
                    style={{ textAlign: block.alignments[hi] ?? 'left' }}
                    className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap"
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/80 tabular-nums">
              {block.rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{ textAlign: block.alignments[ci] ?? 'left' }}
                      className="px-3.5 py-2.5 text-slate-700 dark:text-slate-300 align-top leading-relaxed min-w-[110px]"
                    >
                      {renderInline(cell)}
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
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="my-2.5 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 flex items-start gap-2.5"
        >
          <Sparkles style={{ color: 'var(--m3-primary)' }} className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1 whitespace-pre-wrap">
            {renderInline(block.lines.join('\n'))}
          </div>
        </div>
      );

    case 'ul':
      return (
        <ul key={key} className="space-y-1.5 pl-1">
          {block.items.map((item, li) => (
            <li key={li} className="flex items-start gap-2.5 leading-relaxed">
              {typeof item.checked === 'boolean' ? (
                <span
                  aria-label={item.checked ? 'Completed' : 'Pending'}
                  className={`mt-1 w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                    item.checked
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {item.checked && <Check className="w-3 h-3" />}
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-2.5 w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 shrink-0"
                />
              )}
              <span className="min-w-0 flex-1">{renderInline(item.text)}</span>
            </li>
          ))}
        </ul>
      );

    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-5 space-y-1.5 marker:font-semibold marker:text-slate-500 dark:marker:text-slate-400">
          {block.items.map((item, li) => (
            <li key={li} className="pl-1 leading-relaxed">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );

    case 'paragraph':
      return (
        <p key={key} className="leading-[1.68] whitespace-pre-wrap">
          {renderInline(block.text)}
        </p>
      );
  }
}

export function MarkdownRenderer({
  content,
  onOpenInteractiveFlashcards,
  onOpenInteractiveQuiz,
}: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  if (!content) return null;

  return (
    <div className="space-y-3 text-[15px] leading-[1.68] text-slate-800 dark:text-slate-200 break-words">
      {blocks.map((block, i) =>
        renderBlock(block, i, onOpenInteractiveFlashcards, onOpenInteractiveQuiz)
      )}
    </div>
  );
}
