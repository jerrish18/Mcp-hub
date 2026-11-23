import { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface KatexMathProps {
  latex: string;
  displayMode?: boolean;
  className?: string;
}

export function KatexMath({ latex, displayMode = false, className = '' }: KatexMathProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      katex.render(latex, el, {
        displayMode,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      el.textContent = latex;
    }
  }, [latex, displayMode]);

  if (displayMode) {
    return (
      <span
        ref={containerRef}
        data-testid="katex-block"
        className={`block overflow-x-auto py-1 text-center ${className}`}
      />
    );
  }

  return (
    <span
      ref={containerRef}
      data-testid="katex-inline"
      className={`inline-block align-baseline px-0.5 ${className}`}
    />
  );
}
