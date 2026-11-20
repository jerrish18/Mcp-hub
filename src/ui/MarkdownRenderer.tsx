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
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g);
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
    if (token.startsWith('_') && token.endsWith('_') && token.length > 2) {
      return (
        <em key={idx} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{token}</React.Fragment>;
  });
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

        const blocks = seg.content.split(/\n{2,}/).filter((b) => b.trim().length > 0);
        return blocks.map((block, bIdx) => {
          const lines = block.split('\n');
          if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
            return (
              <ul key={`${i}-${bIdx}`} className="list-disc pl-5 space-y-1">
                {lines.map((l, li) => (
                  <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ''))}</li>
                ))}
              </ul>
            );
          }
          if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
            return (
              <ol key={`${i}-${bIdx}`} className="list-decimal pl-5 space-y-1">
                {lines.map((l, li) => (
                  <li key={li}>{renderInline(l.replace(/^\s*\d+\.\s+/, ''))}</li>
                ))}
              </ol>
            );
          }
          if (block.startsWith('### ')) {
            return (
              <h4 key={`${i}-${bIdx}`} className="font-display text-base font-semibold text-slate-900 dark:text-white pt-1">
                {renderInline(block.slice(4))}
              </h4>
            );
          }
          if (block.startsWith('## ')) {
            return (
              <h3 key={`${i}-${bIdx}`} className="font-display text-lg font-semibold text-slate-900 dark:text-white pt-1">
                {renderInline(block.slice(3))}
              </h3>
            );
          }
          return (
            <p key={`${i}-${bIdx}`} className="whitespace-pre-wrap">
              {renderInline(block)}
            </p>
          );
        });
      })}
    </div>
  );
}
