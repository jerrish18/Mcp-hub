import { useEffect, useId, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  GitBranch,
  Maximize2,
  PanelRight,
  X,
} from 'lucide-react';

interface MermaidDiagramCardProps {
  code: string;
  isUnclosed?: boolean;
  onOpenInCanvas?: (language: string, code: string) => void;
}

let mermaidInitializedTheme: 'default' | 'dark' | null = null;

function useIsDarkMode(): boolean {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return dark;
}

export function MermaidDiagramCard({
  code,
  isUnclosed,
  onOpenInCanvas,
}: MermaidDiagramCardProps) {
  const reactId = useId().replace(/[:]/g, '_');
  const isDark = useIsDarkMode();
  const [svg, setSvg] = useState<string>('');
  const [renderError, setRenderError] = useState<string>('');
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');
  const [zoomOpen, setZoomOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const trimmed = useMemo(() => code.trim(), [code]);

  useEffect(() => {
    if (!trimmed || isUnclosed) {
      return;
    }
    let cancelled = false;
    const renderDiagram = async () => {
      try {
        const mod = await import('mermaid');
        const mermaid = mod.default;
        const theme: 'default' | 'dark' = isDark ? 'dark' : 'default';
        if (mermaidInitializedTheme !== theme) {
          mermaid.initialize({
            startOnLoad: false,
            theme,
            securityLevel: 'strict',
            fontFamily: 'var(--font-body), system-ui, sans-serif',
            flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
          });
          mermaidInitializedTheme = theme;
        }
        const uniqueId = `mmd_${reactId}_${Math.random().toString(36).slice(2, 7)}`;
        const result = await mermaid.render(uniqueId, trimmed);
        if (!cancelled) {
          setSvg(result.svg);
          setRenderError('');
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Unable to parse diagram syntax');
        }
      }
    };

    void renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [trimmed, isUnclosed, isDark, reactId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard?.writeText(trimmed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadSvg = () => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  return (
    <>
      <div
        data-testid="mermaid-diagram-card"
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="my-3 rounded-2xl border overflow-hidden"
      >
        <div
          style={{
            backgroundColor: 'var(--m3-surface-container-high)',
            borderColor: 'var(--m3-outline)',
          }}
          className="px-3.5 py-2 border-b flex items-center justify-between gap-2 flex-wrap"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
            <GitBranch style={{ color: 'var(--m3-primary)' }} className="w-3.5 h-3.5 shrink-0" />
            <span>Interactive Diagram</span>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {onOpenInCanvas && (
              <button
                type="button"
                onClick={() => onOpenInCanvas('mermaid', trimmed)}
                className="min-h-[30px] px-2.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <PanelRight className="w-3.5 h-3.5" />
                <span>Canvas</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode((v) => (v === 'diagram' ? 'code' : 'diagram'))}
              className="min-h-[30px] px-2.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{viewMode === 'diagram' ? 'Source' : 'Visual'}</span>
            </button>
            {svg && viewMode === 'diagram' && (
              <>
                <button
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  aria-label="Expand diagram"
                  className="min-h-[30px] px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Expand</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  aria-label="Download SVG"
                  className="min-h-[30px] px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">SVG</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label="Copy Mermaid source"
              className="min-h-[30px] px-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 inline-flex items-center gap-1 whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {viewMode === 'code' ? (
          <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono bg-slate-950 text-slate-100">
            <code>{trimmed}</code>
          </pre>
        ) : isUnclosed ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Building visual flowchart…
          </div>
        ) : renderError ? (
          <div className="p-4 space-y-2">
            <div className="text-xs text-amber-700 dark:text-amber-300">
              Diagram preview could not render automatically ({renderError.slice(0, 120)}). Showing Mermaid source:
            </div>
            <pre className="p-3 rounded-xl bg-slate-950 text-slate-100 overflow-x-auto text-xs font-mono">
              <code>{trimmed}</code>
            </pre>
          </div>
        ) : svg ? (
          <div
            style={{ backgroundColor: 'var(--m3-surface)' }}
            className="p-4 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
            // Mermaid strict mode outputs sanitized SVG markup
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Rendering diagram…
          </div>
        )}
      </div>

      {zoomOpen && svg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expanded Diagram Viewer"
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs p-4 sm:p-8 flex items-center justify-center"
          onClick={() => setZoomOpen(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="w-full max-w-5xl max-h-[88vh] rounded-[24px] border shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                backgroundColor: 'var(--m3-surface-container)',
                borderColor: 'var(--m3-outline)',
              }}
              className="px-4 py-3 border-b flex items-center justify-between gap-2"
            >
              <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Diagram Preview
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadSvg}
                  className="min-h-[36px] px-3 rounded-full border border-slate-300 dark:border-slate-700 text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download SVG</span>
                </button>
                <button
                  type="button"
                  onClick={() => setZoomOpen(false)}
                  aria-label="Close diagram preview"
                  className="min-h-[36px] min-w-[36px] rounded-full flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div
              className="flex-1 overflow-auto p-6 flex items-center justify-center [&_svg]:max-w-none [&_svg]:min-w-[420px]"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  );
}
