import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

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
    <div className="my-2.5 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-slate-800 bg-slate-900/90 text-xs text-slate-400">
        <span className="font-mono">{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy code block"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
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

function renderInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return tokens.map((token, idx) => {
    if (token.startsWith('`') && token.endsWith('`') && token.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 font-mono text-[13px] text-slate-900 dark:text-slate-100"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**') && token.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-950 dark:text-white">
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

function renderTextBlocks(text: string, keyPrefix: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    // Headings (#, ##, ###) apply strictly to that single line
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      if (level === 1) {
        nodes.push(
          <h2 key={`${keyPrefix}-${blockIdx++}`} className="font-display text-lg font-bold text-slate-950 dark:text-white pt-1.5">
            {renderInline(title)}
          </h2>
        );
      } else if (level === 2) {
        nodes.push(
          <h3 key={`${keyPrefix}-${blockIdx++}`} className="font-display text-[16px] font-bold text-slate-900 dark:text-white pt-1.5">
            {renderInline(title)}
          </h3>
        );
      } else {
        nodes.push(
          <h4 key={`${keyPrefix}-${blockIdx++}`} className="font-display text-[15px] font-semibold text-slate-900 dark:text-white pt-1">
            {renderInline(title)}
          </h4>
        );
      }
      i++;
      continue;
    }

    // Blockquote lines (> ...)
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      nodes.push(
        <blockquote
          key={`${keyPrefix}-${blockIdx++}`}
          style={{
            backgroundColor: 'var(--m3-surface-container-high)',
            borderLeftColor: 'var(--m3-primary)',
          }}
          className="rounded-r-xl border-l-[3px] px-3 py-2 text-[14px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap"
        >
          {renderInline(quoteLines.join('\n'))}
        </blockquote>
      );
      continue;
    }

    // Bullet lists (- or *)
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      nodes.push(
        <ul key={`${keyPrefix}-${blockIdx++}`} className="list-disc pl-5 space-y-1">
          {listItems.map((item, li) => (
            <li key={li}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered lists (1. )
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      nodes.push(
        <ol key={`${keyPrefix}-${blockIdx++}`} className="list-decimal pl-5 space-y-1">
          {listItems.map((item, li) => (
            <li key={li}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph lines until blank line or structural prefix
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[i].trim()) &&
      !/^\s*>/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={`${keyPrefix}-${blockIdx++}`} className="whitespace-pre-wrap">
        {renderInline(paraLines.join('\n'))}
      </p>
    );
  }

  return nodes;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (!content) return null;

  const segments: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', lang: match[1] || 'text', content: match[2].replace(/\n$/, '') });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 break-words">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return <CodeBlock key={i} language={seg.lang ?? 'text'} code={seg.content} />;
        }
        return renderTextBlocks(seg.content, `seg-${i}`);
      })}
    </div>
  );
}
