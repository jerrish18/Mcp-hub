import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Layers,
  Lightbulb,
  PanelRight,
  Presentation,
  Sigma,
  Sparkles,
} from 'lucide-react';
import {
  downloadAppBundle,
  parseAppArtifactBlock,
  type AppArtifactSpec,
} from '../utils/appArtifact';
import {
  downloadDocumentSpec,
  parseArtifactBlock,
  type DocFormat,
  type DocumentSpec,
} from '../utils/docExport';
import {
  parseInlineTokens,
  parseMarkdownBlocks,
  type CalloutKind,
  type InlineToken,
  type MarkdownBlock,
} from '../utils/markdownParser';
import { KatexMath } from './KatexMath';
import { MermaidDiagramCard } from './MermaidDiagramCard';
import { StudyImageCard } from './StudyImageCard';

export type MarkdownCanvasRequest =
  | { kind: 'code'; title: string; language: string; code: string }
  | { kind: 'document'; title: string; spec: DocumentSpec; rawJson: string }
  | { kind: 'app'; title: string; spec: AppArtifactSpec; rawJson: string };

interface MarkdownRendererProps {
  content: string;
  onOpenInteractiveFlashcards?: () => void;
  onOpenInteractiveQuiz?: () => void;
  onOpenInCanvas?: (payload: MarkdownCanvasRequest) => void;
}

const CANVAS_CODE_LANGS = new Set([
  'html',
  'htm',
  'svg',
  'mermaid',
  'tsx',
  'jsx',
  'js',
  'javascript',
  'ts',
  'typescript',
  'python',
  'py',
  'css',
  'sql',
  'json',
]);

const CALLOUT_META: Record<
  CalloutKind,
  {
    label: string;
    Icon: typeof Sparkles;
    bgClass: string;
    borderClass: string;
    iconClass: string;
  }
> = {
  definition: {
    label: 'Definition',
    Icon: BookMarked,
    bgClass: 'bg-blue-50/75 dark:bg-blue-950/30',
    borderClass: 'border-blue-200 dark:border-blue-900/70',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
  formula: {
    label: 'Key Formula',
    Icon: Sigma,
    bgClass: 'bg-indigo-50/75 dark:bg-indigo-950/30',
    borderClass: 'border-indigo-200 dark:border-indigo-900/70',
    iconClass: 'text-indigo-600 dark:text-indigo-400',
  },
  tip: {
    label: 'Study Tip',
    Icon: Lightbulb,
    bgClass: 'bg-emerald-50/75 dark:bg-emerald-950/30',
    borderClass: 'border-emerald-200 dark:border-emerald-900/70',
    iconClass: 'text-emerald-600 dark:text-emerald-400',
  },
  important: {
    label: 'Important',
    Icon: Sparkles,
    bgClass: 'bg-violet-50/75 dark:bg-violet-950/30',
    borderClass: 'border-violet-200 dark:border-violet-900/70',
    iconClass: 'text-violet-600 dark:text-violet-400',
  },
  warning: {
    label: 'Common Trap',
    Icon: AlertTriangle,
    bgClass: 'bg-amber-50/80 dark:bg-amber-950/30',
    borderClass: 'border-amber-200 dark:border-amber-900/70',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  hint: {
    label: 'Hint',
    Icon: HelpCircle,
    bgClass: 'bg-slate-100/80 dark:bg-slate-900/70',
    borderClass: 'border-slate-200 dark:border-slate-800',
    iconClass: 'text-slate-600 dark:text-slate-300',
  },
  note: {
    label: 'Note',
    Icon: Sparkles,
    bgClass: 'bg-slate-100/80 dark:bg-slate-900/70',
    borderClass: 'border-slate-200 dark:border-slate-800',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
};

function getDocFormatMeta(format: DocFormat): {
  extLabel: string;
  Icon: typeof FileText;
  summary: (spec: DocumentSpec) => string;
} {
  switch (format) {
    case 'pptx':
      return {
        extLabel: '.PPTX',
        Icon: Presentation,
        summary: (spec) =>
          spec.format === 'pptx'
            ? `${spec.slides.length} slide${spec.slides.length === 1 ? '' : 's'} · 16:9 PowerPoint deck`
            : 'PowerPoint deck',
      };
    case 'xlsx':
      return {
        extLabel: '.XLSX',
        Icon: FileSpreadsheet,
        summary: (spec) =>
          spec.format === 'xlsx'
            ? `${spec.sheets.length} worksheet${spec.sheets.length === 1 ? '' : 's'} · Excel workbook`
            : 'Excel workbook',
      };
    case 'docx':
      return {
        extLabel: '.DOCX',
        Icon: FileText,
        summary: (spec) =>
          spec.format === 'docx'
            ? `${spec.sections.length} section${spec.sections.length === 1 ? '' : 's'} · Word document`
            : 'Word document',
      };
    case 'pdf':
      return {
        extLabel: '.PDF',
        Icon: FileText,
        summary: (spec) =>
          spec.format === 'pdf'
            ? `${spec.sections.length} section${spec.sections.length === 1 ? '' : 's'} · Formatted PDF report`
            : 'PDF report',
      };
  }
}

function DocumentArtifactCard({
  spec,
  rawJson,
  onOpenInCanvas,
}: {
  spec: DocumentSpec;
  rawJson: string;
  onOpenInCanvas?: (payload: MarkdownCanvasRequest) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadedName, setDownloadedName] = useState('');
  const meta = getDocFormatMeta(spec.format);
  const Icon = meta.Icon;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const filename = await downloadDocumentSpec(spec);
      setDownloadedName(filename);
      setTimeout(() => setDownloadedName(''), 2400);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      data-testid={`doc-artifact-card-${spec.format}`}
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="my-3 rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          style={{
            backgroundColor: 'var(--m3-primary-container)',
            color: 'var(--m3-on-primary-container)',
          }}
          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-sm font-semibold text-slate-950 dark:text-white truncate">
            {spec.title}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
            {meta.summary(spec)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {onOpenInCanvas && (
          <button
            type="button"
            data-testid={`preview-doc-${spec.format}`}
            onClick={() =>
              onOpenInCanvas({
                kind: 'document',
                title: spec.title,
                spec,
                rawJson,
              })
            }
            style={{
              backgroundColor: 'var(--m3-surface)',
              borderColor: 'var(--m3-outline)',
            }}
            className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap hover:opacity-90"
          >
            <PanelRight className="w-3.5 h-3.5" />
            <span>Preview in Canvas</span>
          </button>
        )}

        <button
          type="button"
          disabled={downloading}
          data-testid={`download-doc-${spec.format}`}
          onClick={() => void handleDownload()}
          style={{
            backgroundColor: 'var(--m3-primary)',
            color: 'var(--m3-on-primary)',
          }}
          className="min-h-[40px] px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:opacity-90 disabled:opacity-60"
        >
          {downloadedName ? <Check className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          <span>
            {downloading
              ? 'Building…'
              : downloadedName
                ? 'Downloaded'
                : `Download ${meta.extLabel}`}
          </span>
        </button>
      </div>
    </div>
  );
}

function AppArtifactCard({
  spec,
  rawJson,
  onOpenInCanvas,
}: {
  spec: AppArtifactSpec;
  rawJson: string;
  onOpenInCanvas?: (payload: MarkdownCanvasRequest) => void;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const fileNames = spec.files
    .slice(0, 3)
    .map((f) => f.path)
    .join(', ');
  const extraCount = Math.max(0, spec.files.length - 3);

  const handleDownload = () => {
    downloadAppBundle(spec);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 2200);
  };

  return (
    <div
      data-testid="app-artifact-card"
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="my-3 rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          style={{
            backgroundColor: 'var(--m3-primary-container)',
            color: 'var(--m3-on-primary-container)',
          }}
          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        >
          <Layers className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-sm font-semibold text-slate-950 dark:text-white truncate">
            {spec.title}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
            {spec.files.length} file{spec.files.length === 1 ? '' : 's'}
            {spec.framework ? ` · ${spec.framework}` : ''}
            {fileNames ? ` (${fileNames}${extraCount > 0 ? ` +${extraCount}` : ''})` : ''}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {onOpenInCanvas && (
          <button
            type="button"
            data-testid="open-app-canvas"
            onClick={() =>
              onOpenInCanvas({
                kind: 'app',
                title: spec.title,
                spec,
                rawJson,
              })
            }
            style={{
              backgroundColor: 'var(--m3-primary)',
              color: 'var(--m3-on-primary)',
            }}
            className="min-h-[40px] px-4 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap hover:opacity-90"
          >
            <PanelRight className="w-3.5 h-3.5" />
            <span>Open IDE Canvas</span>
          </button>
        )}

        <button
          type="button"
          data-testid="download-app-bundle"
          onClick={handleDownload}
          style={{
            backgroundColor: 'var(--m3-surface)',
            borderColor: 'var(--m3-outline)',
          }}
          className="min-h-[40px] px-3.5 rounded-full border text-xs font-semibold text-slate-800 dark:text-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap hover:opacity-90"
        >
          {downloaded ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Download className="w-3.5 h-3.5" />}
          <span>{downloaded ? 'Saved HTML' : 'Bundle .HTML'}</span>
        </button>
      </div>
    </div>
  );
}

function CalloutBlock({
  block,
}: {
  block: Extract<MarkdownBlock, { type: 'blockquote' }>;
}) {
  const [open, setOpen] = useState(() => !block.isCollapsible);
  const kind = block.calloutKind ?? 'note';
  const meta = CALLOUT_META[kind];
  const Icon = meta.Icon;
  const heading = block.calloutTitle?.trim() || meta.label;
  const bodyText = block.lines.join('\n');

  if (block.calloutKind) {
    return (
      <div
        data-testid={`callout-${kind}`}
        className={`my-2.5 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed text-slate-800 dark:text-slate-100 ${meta.bgClass} ${meta.borderClass}`}
      >
        {block.isCollapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="w-full flex items-center justify-between gap-2 text-left font-semibold text-xs text-slate-900 dark:text-white"
          >
            <span className="inline-flex items-center gap-2">
              <Icon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} />
              <span>{heading}</span>
            </span>
            {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
          </button>
        ) : (
          <div className="flex items-center gap-2 font-semibold text-xs text-slate-900 dark:text-white mb-1">
            <Icon className={`w-4 h-4 shrink-0 ${meta.iconClass}`} />
            <span>{heading}</span>
          </div>
        )}
        {open && bodyText && (
          <div className={`min-w-0 space-y-1 whitespace-pre-wrap ${block.isCollapsible ? 'mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60' : ''}`}>
            {renderInline(bodyText)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--m3-surface-container)',
        borderColor: 'var(--m3-outline)',
      }}
      className="my-2.5 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed text-slate-700 dark:text-slate-200 flex items-start gap-2.5"
    >
      <Sparkles style={{ color: 'var(--m3-primary)' }} className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-1 whitespace-pre-wrap">{renderInline(bodyText)}</div>
    </div>
  );
}

function CodeBlock({
  language,
  code,
  isUnclosed,
  onOpenInteractiveFlashcards,
  onOpenInteractiveQuiz,
  onOpenInCanvas,
}: {
  language: string;
  code: string;
  isUnclosed?: boolean;
  onOpenInteractiveFlashcards?: () => void;
  onOpenInteractiveQuiz?: () => void;
  onOpenInCanvas?: (payload: MarkdownCanvasRequest) => void;
}) {
  const [copied, setCopied] = useState(false);

  const normalizedLang = language.toLowerCase().trim();

  if (normalizedLang === 'mermaid') {
    return (
      <MermaidDiagramCard
        code={code}
        isUnclosed={isUnclosed}
        onOpenInCanvas={
          onOpenInCanvas
            ? (lang, mermaidCode) =>
                onOpenInCanvas({
                  kind: 'code',
                  title: 'Diagram Preview',
                  language: lang,
                  code: mermaidCode,
                })
            : undefined
        }
      />
    );
  }

  if (/^(?:artifact|doc)-(?:pptx|docx|xlsx|pdf)$/.test(normalizedLang)) {
    const parsedDoc = isUnclosed ? null : parseArtifactBlock(normalizedLang, code);
    if (parsedDoc) {
      return (
        <DocumentArtifactCard
          spec={parsedDoc}
          rawJson={code}
          onOpenInCanvas={onOpenInCanvas}
        />
      );
    }
    const fmtLabel = normalizedLang.replace(/^(?:artifact|doc)-/, '').toUpperCase();
    if (isUnclosed) {
      return (
        <div
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="my-3 rounded-2xl border p-4 flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300"
        >
          <Presentation style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
          <span>Building {fmtLabel} document structure…</span>
        </div>
      );
    }
  }

  if (normalizedLang === 'artifact-app' || normalizedLang === 'app-project') {
    const parsedApp = isUnclosed ? null : parseAppArtifactBlock(normalizedLang, code);
    if (parsedApp) {
      return (
        <AppArtifactCard
          spec={parsedApp}
          rawJson={code}
          onOpenInCanvas={onOpenInCanvas}
        />
      );
    }
    if (isUnclosed) {
      return (
        <div
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="my-3 rounded-2xl border p-4 flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300"
        >
          <Layers style={{ color: 'var(--m3-primary)' }} className="w-5 h-5 shrink-0" />
          <span>Assembling multi-file application…</span>
        </div>
      );
    }
  }

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

  const canOpenInCanvas = Boolean(onOpenInCanvas && (CANVAS_CODE_LANGS.has(normalizedLang) || code.length > 80));

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800 bg-slate-900/90 text-xs text-slate-400 gap-2">
        <span className="font-mono lowercase">{language || 'text'}</span>
        <div className="flex items-center gap-1">
          {canOpenInCanvas && onOpenInCanvas && (
            <button
              type="button"
              onClick={() =>
                onOpenInCanvas({
                  kind: 'code',
                  title: `${(language || 'code').toUpperCase()} Canvas`,
                  language: normalizedLang || 'text',
                  code,
                })
              }
              aria-label="Open code in Canvas"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-blue-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <PanelRight className="w-3.5 h-3.5" />
              <span>Open in Canvas</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy code block"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function renderInlineNodes(tokens: InlineToken[], depth = 0): React.ReactNode[] {
  const renderNested = (text: string): React.ReactNode =>
    depth < 3 ? renderInlineNodes(parseInlineTokens(text), depth + 1) : text;

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
            {renderNested(tok.text)}
          </strong>
        );
      case 'italic':
        return (
          <em key={idx} className="italic">
            {renderNested(tok.text)}
          </em>
        );
      case 'strike':
        return (
          <del key={idx} className="line-through opacity-75">
            {renderNested(tok.text)}
          </del>
        );
      case 'math':
        return (
          <KatexMath
            key={idx}
            latex={tok.text}
            className="text-slate-900 dark:text-slate-100"
          />
        );
      case 'image':
        return <StudyImageCard key={idx} url={tok.url} alt={tok.alt} />;
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
  onOpenInteractiveQuiz?: () => void,
  onOpenInCanvas?: (payload: MarkdownCanvasRequest) => void
): React.ReactNode {
  switch (block.type) {
    case 'code':
      return (
        <CodeBlock
          key={key}
          language={block.language}
          code={block.code}
          isUnclosed={block.isUnclosed}
          onOpenInteractiveFlashcards={onOpenInteractiveFlashcards}
          onOpenInteractiveQuiz={onOpenInteractiveQuiz}
          onOpenInCanvas={onOpenInCanvas}
        />
      );

    case 'math_block':
      return (
        <div
          key={key}
          style={{
            backgroundColor: 'var(--m3-surface-container)',
            borderColor: 'var(--m3-outline)',
          }}
          className="my-3 rounded-2xl border px-4 py-3 overflow-x-auto"
        >
          {block.isUnclosed ? (
            <code className="font-mono text-xs text-slate-600 dark:text-slate-300">
              {block.latex}
            </code>
          ) : (
            <KatexMath latex={block.latex} displayMode className="text-slate-950 dark:text-white" />
          )}
        </div>
      );

    case 'image':
      return (
        <StudyImageCard
          key={key}
          url={block.url}
          alt={block.alt}
          caption={block.caption}
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
      return <CalloutBlock key={key} block={block} />;

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

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  onOpenInteractiveFlashcards,
  onOpenInteractiveQuiz,
  onOpenInCanvas,
}: MarkdownRendererProps) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  if (!content) return null;

  return (
    <div className="space-y-3 text-[15px] leading-[1.68] text-slate-800 dark:text-slate-200 break-words">
      {blocks.map((block, i) =>
        renderBlock(
          block,
          i,
          onOpenInteractiveFlashcards,
          onOpenInteractiveQuiz,
          onOpenInCanvas
        )
      )}
    </div>
  );
});
