import { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Presentation,
  Sparkles,
  X,
} from 'lucide-react';
import { MermaidDiagramCard } from '../../ui/MermaidDiagramCard';
import {
  downloadDocumentSpec,
  parseArtifactBlock,
  sanitizeFilename,
  type DocFormat,
  type DocumentSpec,
  type PptxSlideSpec,
} from '../../utils/docExport';

export type CanvasArtifact =
  | {
      kind: 'code';
      id: string;
      title: string;
      language: string;
      code: string;
    }
  | {
      kind: 'document';
      id: string;
      title: string;
      spec: DocumentSpec;
      rawJson: string;
    };

interface ProCanvasPanelProps {
  open: boolean;
  artifact: CanvasArtifact | null;
  isRunning?: boolean;
  onChangeArtifact: (next: CanvasArtifact) => void;
  onAskCanvasAction: (prompt: string, displayLabel: string) => void;
  onClose: () => void;
}

const EXT_BY_LANG: Record<string, string> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  mermaid: 'mmd',
  tsx: 'tsx',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  javascript: 'js',
  js: 'js',
  python: 'py',
  py: 'py',
  css: 'css',
  sql: 'sql',
  json: 'json',
};

function SlidePreviewCard({
  slide,
  deckTitle,
  themeColor,
  index,
  total,
}: {
  slide: PptxSlideSpec;
  deckTitle: string;
  themeColor?: string;
  index: number;
  total: number;
}) {
  const accent = themeColor ? `#${themeColor.replace(/^#/, '')}` : '#0B57D0';

  if (slide.layout === 'title') {
    return (
      <div
        style={{ backgroundColor: accent }}
        className="w-full aspect-video rounded-2xl p-6 sm:p-8 text-white flex flex-col justify-between shadow-sm overflow-hidden"
      >
        <div className="w-12 h-1 rounded-full bg-white/40" />
        <div className="space-y-2">
          <h3 className="font-display text-xl sm:text-2xl font-bold leading-tight text-balance">
            {slide.title}
          </h3>
          {slide.subtitle && (
            <p className="text-xs sm:text-sm text-white/85 leading-relaxed line-clamp-3">
              {slide.subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-white/75 tabular-nums">
          <span>MCP Hub Pro Studio</span>
          <span>
            {index + 1} / {total}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full aspect-video rounded-2xl bg-white text-slate-900 border border-slate-200 p-4 sm:p-5 flex flex-col justify-between shadow-sm overflow-hidden">
      <div className="space-y-1 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <span style={{ backgroundColor: accent }} className="w-1.5 h-4 rounded-full shrink-0" />
          <h3 className="font-display text-sm sm:text-base font-bold text-slate-950 truncate">
            {slide.title}
          </h3>
        </div>
        {slide.subtitle && (
          <p className="text-[11px] text-slate-500 truncate pl-3.5">{slide.subtitle}</p>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-2">
        {slide.layout === 'metrics' && slide.metrics && (
          <div className="grid grid-cols-2 gap-2.5 h-full items-center">
            {slide.metrics.slice(0, 4).map((m, mi) => (
              <div
                key={mi}
                className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-0.5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate">
                  {m.label}
                </div>
                <div
                  style={{ color: accent }}
                  className="font-display text-lg sm:text-xl font-bold tabular-nums truncate"
                >
                  {m.value}
                </div>
                {m.note && <div className="text-[10px] text-slate-500 truncate">{m.note}</div>}
              </div>
            ))}
          </div>
        )}

        {slide.layout === 'two_col' && (
          <div className="grid grid-cols-2 gap-2.5 h-full">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-1 overflow-hidden">
              <div style={{ color: accent }} className="text-[11px] font-bold truncate">
                {slide.leftTitle || 'Column A'}
              </div>
              <ul className="space-y-1 text-[11px] text-slate-700">
                {(slide.leftBullets ?? []).slice(0, 5).map((b, bi) => (
                  <li key={bi} className="leading-snug truncate">
                    • {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-1 overflow-hidden">
              <div style={{ color: accent }} className="text-[11px] font-bold truncate">
                {slide.rightTitle || 'Column B'}
              </div>
              <ul className="space-y-1 text-[11px] text-slate-700">
                {(slide.rightBullets ?? []).slice(0, 5).map((b, bi) => (
                  <li key={bi} className="leading-snug truncate">
                    • {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {slide.layout === 'table' && slide.table && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left border-collapse text-[11px] tabular-nums">
              <thead>
                <tr style={{ backgroundColor: accent }} className="text-white">
                  {slide.table.headers.map((h, hi) => (
                    <th key={hi} className="px-2.5 py-1.5 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {slide.table.rows.slice(0, 6).map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1 text-slate-700">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(slide.layout === 'bullets' ||
          (!slide.metrics && !slide.table && slide.layout !== 'two_col')) && (
          <ul className="space-y-1.5 text-xs text-slate-700">
            {(slide.bullets ?? []).map((b, bi) => (
              <li key={bi} className="flex items-start gap-2 leading-snug">
                <span
                  style={{ backgroundColor: accent }}
                  className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-100 pt-1.5 tabular-nums">
        <span className="truncate">{deckTitle}</span>
        <span>
          Slide {index + 1} / {total}
        </span>
      </div>
    </div>
  );
}

export function ProCanvasPanel({
  open,
  artifact,
  isRunning,
  onChangeArtifact,
  onAskCanvasAction,
  onClose,
}: ProCanvasPanelProps) {
  const [tab, setTab] = useState<'preview' | 'source'>('preview');
  const [slideIdx, setSlideIdx] = useState(0);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [jsonError, setJsonError] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const codeLanguage = artifact?.kind === 'code' ? artifact.language.toLowerCase() : '';
  const isHtmlPreview = codeLanguage === 'html' || codeLanguage === 'htm';
  const isSvgPreview = codeLanguage === 'svg';
  const isMermaidPreview = codeLanguage === 'mermaid';

  const svgSrcDoc = useMemo(() => {
    if (!artifact || artifact.kind !== 'code' || !isSvgPreview) return '';
    return `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff;">${artifact.code}</body></html>`;
  }, [artifact, isSvgPreview]);

  if (!open || !artifact) return null;

  const handleCopy = async () => {
    const text = artifact.kind === 'code' ? artifact.code : artifact.rawJson;
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadCode = () => {
    if (artifact.kind !== 'code') return;
    const ext = EXT_BY_LANG[codeLanguage] ?? 'txt';
    const filename = sanitizeFilename(artifact.title, 'pdf').replace(/\.pdf$/, `.${ext}`);
    const blob = new Blob([artifact.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleDownloadDocument = async () => {
    if (artifact.kind !== 'document') return;
    setDownloading(true);
    try {
      await downloadDocumentSpec(artifact.spec);
    } finally {
      setDownloading(false);
    }
  };

  const handleUpdateDocumentJson = (nextRaw: string) => {
    if (artifact.kind !== 'document') return;
    const fmt: DocFormat = artifact.spec.format;
    const parsed = parseArtifactBlock(`artifact-${fmt}`, nextRaw);
    if (!parsed) {
      setJsonError('Invalid JSON format — preview will refresh once syntax is valid.');
      onChangeArtifact({ ...artifact, rawJson: nextRaw });
      return;
    }
    setJsonError('');
    onChangeArtifact({
      ...artifact,
      title: parsed.title,
      spec: parsed,
      rawJson: nextRaw,
    });
  };

  const renderHeaderGlyph = () => {
    if (artifact.kind === 'document') {
      if (artifact.spec.format === 'pptx') return <Presentation className="w-4 h-4" />;
      if (artifact.spec.format === 'xlsx') return <FileSpreadsheet className="w-4 h-4" />;
      return <FileText className="w-4 h-4" />;
    }
    return <Code2 className="w-4 h-4" />;
  };

  const panelBody = (
    <div
      data-testid="pro-canvas-panel"
      style={{
        backgroundColor: 'var(--m3-surface)',
        borderColor: 'var(--m3-outline)',
      }}
      className="flex flex-col h-full w-full overflow-hidden"
    >
      {/* Canvas Header */}
      <header
        style={{
          backgroundColor: 'var(--m3-surface-container)',
          borderColor: 'var(--m3-outline)',
        }}
        className="shrink-0 px-3.5 py-2.5 border-b flex items-center justify-between gap-2 pt-safe"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            style={{
              backgroundColor: 'var(--m3-primary-container)',
              color: 'var(--m3-on-primary-container)',
            }}
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          >
            {renderHeaderGlyph()}
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-sm font-bold text-slate-950 dark:text-white truncate">
              {artifact.title}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {artifact.kind === 'document'
                ? `${artifact.spec.format.toUpperCase()} Document Studio`
                : `${artifact.language.toUpperCase()} Canvas`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <div
            style={{ backgroundColor: 'var(--m3-surface-container-high)' }}
            className="inline-flex items-center p-0.5 rounded-full"
          >
            <button
              type="button"
              onClick={() => setTab('preview')}
              data-testid="canvas-tab-preview"
              style={
                tab === 'preview'
                  ? {
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }
                  : undefined
              }
              className="min-h-[30px] px-2.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('source')}
              data-testid="canvas-tab-source"
              style={
                tab === 'source'
                  ? {
                      backgroundColor: 'var(--m3-primary-container)',
                      color: 'var(--m3-on-primary-container)',
                    }
                  : undefined
              }
              className="min-h-[30px] px-2.5 rounded-full text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>{artifact.kind === 'document' ? 'Spec' : 'Code'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy artifact source"
            className="min-h-[34px] min-w-[34px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>

          {artifact.kind === 'document' ? (
            <button
              type="button"
              disabled={downloading}
              data-testid="canvas-download-btn"
              onClick={() => void handleDownloadDocument()}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[34px] px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:opacity-90"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {downloading ? 'Saving…' : `.${artifact.spec.format.toUpperCase()}`}
              </span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="canvas-download-btn"
              onClick={handleDownloadCode}
              style={{
                backgroundColor: 'var(--m3-primary)',
                color: 'var(--m3-on-primary)',
              }}
              className="min-h-[34px] px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:opacity-90"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Canvas"
            className="min-h-[34px] min-w-[34px] rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Canvas Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4">
        {tab === 'source' ? (
          <div className="h-full flex flex-col gap-2">
            {jsonError && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {jsonError}
              </div>
            )}
            <textarea
              aria-label="Canvas source editor"
              data-testid="canvas-source-editor"
              value={artifact.kind === 'code' ? artifact.code : artifact.rawJson}
              onChange={(e) => {
                if (artifact.kind === 'code') {
                  onChangeArtifact({ ...artifact, code: e.target.value });
                } else {
                  handleUpdateDocumentJson(e.target.value);
                }
              }}
              className="flex-1 w-full min-h-[320px] p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed resize-none focus:outline-none"
            />
          </div>
        ) : artifact.kind === 'code' ? (
          isHtmlPreview ? (
            <iframe
              title={artifact.title}
              data-testid="canvas-html-iframe"
              sandbox="allow-scripts"
              srcDoc={artifact.code}
              className="w-full h-full min-h-[380px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white"
            />
          ) : isSvgPreview ? (
            <iframe
              title={artifact.title}
              sandbox=""
              srcDoc={svgSrcDoc}
              className="w-full h-full min-h-[360px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white"
            />
          ) : isMermaidPreview ? (
            <MermaidDiagramCard code={artifact.code} />
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100 overflow-hidden">
              <div className="px-3.5 py-2 border-b border-slate-800 bg-slate-900 text-xs font-mono text-slate-400">
                {artifact.language || 'code'} · {artifact.code.split('\n').length} lines
              </div>
              <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono">
                <code>{artifact.code}</code>
              </pre>
            </div>
          )
        ) : artifact.spec.format === 'pptx' ? (
          (() => {
            const slides = artifact.spec.slides;
            const safeIdx = Math.min(slideIdx, Math.max(0, slides.length - 1));
            const currentSlide = slides[safeIdx];
            if (!currentSlide) return null;
            return (
              <div className="space-y-3">
                <SlidePreviewCard
                  slide={currentSlide}
                  deckTitle={artifact.spec.title}
                  themeColor={artifact.spec.themeColor}
                  index={safeIdx}
                  total={slides.length}
                />

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={safeIdx <= 0}
                    onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="min-h-[38px] px-3 rounded-full border text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>

                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                    Slide {safeIdx + 1} of {slides.length}
                  </span>

                  <button
                    type="button"
                    disabled={safeIdx >= slides.length - 1}
                    onClick={() => setSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="min-h-[38px] px-3 rounded-full border text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Slide Selector Strip */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {slides.map((s, idx) => {
                    const active = idx === safeIdx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSlideIdx(idx)}
                        style={
                          active
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                                borderColor: 'var(--m3-primary)',
                              }
                            : {
                                backgroundColor: 'var(--m3-surface-container)',
                                borderColor: 'var(--m3-outline)',
                              }
                        }
                        className="min-w-[112px] max-w-[140px] px-2.5 py-2 rounded-xl border text-left shrink-0"
                      >
                        <div className="text-[10px] font-semibold opacity-75 tabular-nums">
                          #{idx + 1} · {s.layout}
                        </div>
                        <div className="text-[11px] font-medium truncate">{s.title}</div>
                      </button>
                    );
                  })}
                </div>

                {currentSlide.speakerNotes && (
                  <div
                    style={{
                      backgroundColor: 'var(--m3-surface-container)',
                      borderColor: 'var(--m3-outline)',
                    }}
                    className="rounded-2xl border p-3 text-xs space-y-1"
                  >
                    <div className="font-semibold text-slate-900 dark:text-white">
                      Speaker Notes
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {currentSlide.speakerNotes}
                    </p>
                  </div>
                )}
              </div>
            );
          })()
        ) : artifact.spec.format === 'xlsx' ? (
          (() => {
            const sheets = artifact.spec.sheets;
            const safeSheetIdx = Math.min(sheetIdx, Math.max(0, sheets.length - 1));
            const sheet = sheets[safeSheetIdx];
            if (!sheet) return null;
            return (
              <div className="space-y-3">
                {sheets.length > 1 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    {sheets.map((sh, idx) => (
                      <button
                        key={sh.name}
                        type="button"
                        onClick={() => setSheetIdx(idx)}
                        style={
                          idx === safeSheetIdx
                            ? {
                                backgroundColor: 'var(--m3-primary-container)',
                                color: 'var(--m3-on-primary-container)',
                                borderColor: 'var(--m3-primary)',
                              }
                            : {
                                backgroundColor: 'var(--m3-surface-container)',
                                borderColor: 'var(--m3-outline)',
                              }
                        }
                        className="min-h-[34px] px-3 rounded-full border text-xs font-semibold whitespace-nowrap"
                      >
                        {sh.name}
                      </button>
                    ))}
                  </div>
                )}

                <div
                  style={{ borderColor: 'var(--m3-outline)' }}
                  className="overflow-x-auto rounded-2xl border bg-white dark:bg-slate-950"
                >
                  <table className="w-full text-left border-collapse text-xs tabular-nums">
                    <thead>
                      <tr
                        style={{
                          backgroundColor: 'var(--m3-surface-container)',
                          borderColor: 'var(--m3-outline)',
                        }}
                        className="border-b"
                      >
                        <th className="px-2.5 py-2 text-[11px] font-semibold text-slate-400 w-9">
                          #
                        </th>
                        {sheet.headers.map((h, hi) => (
                          <th
                            key={hi}
                            className="px-3 py-2 font-semibold text-slate-900 dark:text-white whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                      {sheet.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                          <td className="px-2.5 py-2 text-[11px] text-slate-400">{ri + 1}</td>
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap"
                            >
                              {String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white text-slate-900 p-5 sm:p-6 space-y-4 shadow-xs">
            <div className="border-b border-slate-200 pb-3 space-y-1">
              <h3 className="font-display text-lg font-bold text-slate-950">
                {artifact.spec.title}
              </h3>
              {artifact.spec.subtitle && (
                <p className="text-xs text-slate-500">{artifact.spec.subtitle}</p>
              )}
            </div>

            {artifact.spec.sections.map((sec, si) => (
              <div key={si} className="space-y-2">
                <h4 className="font-display text-sm font-bold text-blue-700">{sec.heading}</h4>
                {sec.callout && (
                  <div className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-medium text-blue-950">
                    {sec.callout}
                  </div>
                )}
                {(sec.paragraphs ?? []).map((p, pi) => (
                  <p key={pi} className="text-xs leading-relaxed text-slate-700">
                    {p}
                  </p>
                ))}
                {sec.bullets && sec.bullets.length > 0 && (
                  <ul className="space-y-1 pl-3 text-xs text-slate-700">
                    {sec.bullets.map((b, bi) => (
                      <li key={bi}>• {b}</li>
                    ))}
                  </ul>
                )}
                {sec.table && sec.table.headers.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left border-collapse text-xs tabular-nums">
                      <thead>
                        <tr className="bg-blue-600 text-white">
                          {sec.table.headers.map((h, hi) => (
                            <th key={hi} className="px-2.5 py-1.5 font-semibold whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sec.table.rows.map((row, ri) => (
                          <tr key={ri} className={ri % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                            {row.map((c, ci) => (
                              <td key={ci} className="px-2.5 py-1.5 text-slate-700">
                                {c}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Quick AI Actions for Code Canvas */}
      {artifact.kind === 'code' && !isRunning && (
        <footer
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="shrink-0 px-3.5 py-2.5 border-t flex items-center gap-1.5 overflow-x-auto pb-safe"
        >
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 shrink-0 mr-1">
            <Sparkles className="w-3 h-3" />
            Iterate:
          </span>
          <button
            type="button"
            onClick={() =>
              onAskCanvasAction(
                `Add comprehensive unit tests for this ${artifact.language} code:\n\n\`\`\`${artifact.language}\n${artifact.code}\n\`\`\``,
                `Add unit tests for ${artifact.title}`
              )
            }
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 hover:opacity-85"
          >
            Add Tests
          </button>
          <button
            type="button"
            onClick={() =>
              onAskCanvasAction(
                `Refactor and harden this ${artifact.language} code for edge cases, accessibility, and clean modularity:\n\n\`\`\`${artifact.language}\n${artifact.code}\n\`\`\``,
                `Refactor & harden ${artifact.title}`
              )
            }
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 hover:opacity-85"
          >
            Refactor
          </button>
          <button
            type="button"
            onClick={() =>
              onAskCanvasAction(
                `Explain how this ${artifact.language} code works step by step:\n\n\`\`\`${artifact.language}\n${artifact.code}\n\`\`\``,
                `Explain ${artifact.title}`
              )
            }
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="min-h-[32px] px-3 rounded-full border text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 hover:opacity-85"
          >
            Explain
          </button>
        </footer>
      )}
    </div>
  );

  return (
    <>
      <aside
        style={{ borderColor: 'var(--m3-outline)' }}
        className="hidden lg:flex w-[46%] xl:w-[48%] shrink-0 border-l flex-col min-h-0"
      >
        {panelBody}
      </aside>

      <div role="dialog" aria-modal="true" aria-label={artifact.title} className="lg:hidden fixed inset-0 z-50 flex flex-col">
        {panelBody}
      </div>
    </>
  );
}
