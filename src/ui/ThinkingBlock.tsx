import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Brain, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { M3_FAST_EASE } from '../utils/motion';

interface ThinkingBlockProps {
  reasoning: string;
  isStreaming?: boolean;
  isStillThinking?: boolean;
  durationMs?: number;
}

export function ThinkingBlock({
  reasoning,
  isStreaming,
  isStillThinking,
  durationMs,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!reasoning.trim() && !isStillThinking) return null;

  const secondsText =
    typeof durationMs === 'number' && durationMs > 0
      ? `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`
      : null;

  const heading = isStillThinking
    ? 'Thinking through approach…'
    : secondsText
      ? `Thought for ${secondsText}`
      : 'Thought process';

  return (
    <div
      data-testid="thinking-block"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="rounded-2xl border overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full min-h-[40px] px-3.5 py-2 flex items-center justify-between gap-2 text-left text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200/35 dark:hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isStillThinking || (isStreaming && !reasoning) ? (
            <Loader2 style={{ color: 'var(--m3-primary)' }} className="w-3.5 h-3.5 animate-spin shrink-0" />
          ) : (
            <Brain style={{ color: 'var(--m3-primary)' }} className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate">{heading}</span>
        </div>

        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>{expanded ? 'Hide' : 'Details'}</span>
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && reasoning.trim() && (
          <motion.div
            key="reasoning-body"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={M3_FAST_EASE}
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="border-t px-3.5 py-2.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap max-h-64 overflow-y-auto"
          >
            {reasoning}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
