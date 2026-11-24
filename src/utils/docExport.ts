import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import PptxGenJS from 'pptxgenjs';
import { parseMarkdownBlocks } from './markdownParser';

export type DocFormat = 'pptx' | 'docx' | 'xlsx' | 'pdf';

export interface DocTableData {
  headers: string[];
  rows: string[][];
}

export interface PptxMetricItem {
  label: string;
  value: string;
  note?: string;
}

export interface PptxSlideSpec {
  layout: 'title' | 'bullets' | 'two_col' | 'metrics' | 'table';
  title: string;
  subtitle?: string;
  bullets?: string[];
  leftTitle?: string;
  leftBullets?: string[];
  rightTitle?: string;
  rightBullets?: string[];
  metrics?: PptxMetricItem[];
  table?: DocTableData;
  speakerNotes?: string;
}

export interface PptxSpec {
  format: 'pptx';
  title: string;
  subtitle?: string;
  author?: string;
  themeColor?: string;
  slides: PptxSlideSpec[];
}

export interface DocMetricItem {
  label: string;
  value: string;
  note?: string;
}

export interface DocxSectionSpec {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  callout?: string;
  table?: DocTableData;
}

export interface DocxSpec {
  format: 'docx';
  title: string;
  subtitle?: string;
  author?: string;
  dateLabel?: string;
  themeColor?: string;
  metrics?: DocMetricItem[];
  sections: DocxSectionSpec[];
}

export interface PdfSpec {
  format: 'pdf';
  title: string;
  subtitle?: string;
  author?: string;
  dateLabel?: string;
  themeColor?: string;
  metrics?: DocMetricItem[];
  sections: DocxSectionSpec[];
}

export interface XlsxSheetSpec {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | boolean>>;
}

export interface XlsxSpec {
  format: 'xlsx';
  title: string;
  sheets: XlsxSheetSpec[];
}

export type DocumentSpec = PptxSpec | DocxSpec | XlsxSpec | PdfSpec;

function cleanText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export function sanitizeFilename(name: string, ext: DocFormat): string {
  const stem = cleanText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  return `${stem || 'document'}.${ext}`;
}

function normalizeHexColor(input?: string, fallback = '0B57D0'): string {
  const cleaned = (input ?? '').replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{6}$/.test(cleaned) ? cleaned.toUpperCase() : fallback;
}

/**
 * Parses fenced artifact JSON blocks such as:
 * ```artifact-pptx ... ```, ```artifact-docx ... ```, ```artifact-xlsx ... ```, ```artifact-pdf ... ```
 * (also accepts `doc-pptx`, `doc-docx`, `doc-xlsx`, `doc-pdf`).
 */
export function parseArtifactBlock(language: string, code: string): DocumentSpec | null {
  const lang = language.trim().toLowerCase();
  const formatMatch = /^(?:artifact|doc)-(pptx|docx|xlsx|pdf)$/.exec(lang);
  if (!formatMatch) return null;

  const format = formatMatch[1] as DocFormat;
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(code) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Generated Document';
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle.trim() : undefined;

  if (format === 'pptx') {
    const rawSlides = Array.isArray(raw.slides) ? raw.slides : [];
    const slides: PptxSlideSpec[] = rawSlides
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
      .map((s, idx) => {
        const rawLayout = String(s.layout ?? (idx === 0 ? 'title' : 'bullets'));
        const layout: PptxSlideSpec['layout'] =
          rawLayout === 'title' ||
          rawLayout === 'two_col' ||
          rawLayout === 'metrics' ||
          rawLayout === 'table'
            ? rawLayout
            : 'bullets';

        const metrics = Array.isArray(s.metrics)
          ? s.metrics
              .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
              .map((m) => ({
                label: String(m.label ?? 'Metric'),
                value: String(m.value ?? '—'),
                note: typeof m.note === 'string' ? m.note : undefined,
              }))
          : undefined;

        const rawTable = s.table as Record<string, unknown> | undefined;
        const table =
          rawTable && Array.isArray(rawTable.headers) && Array.isArray(rawTable.rows)
            ? {
                headers: rawTable.headers.map((h) => String(h)),
                rows: rawTable.rows.map((r) =>
                  Array.isArray(r) ? r.map((c) => String(c)) : [String(r)]
                ),
              }
            : undefined;

        return {
          layout,
          title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : `Slide ${idx + 1}`,
          subtitle: typeof s.subtitle === 'string' ? s.subtitle : undefined,
          bullets: Array.isArray(s.bullets) ? s.bullets.map((b) => String(b)) : undefined,
          leftTitle: typeof s.leftTitle === 'string' ? s.leftTitle : undefined,
          leftBullets: Array.isArray(s.leftBullets) ? s.leftBullets.map((b) => String(b)) : undefined,
          rightTitle: typeof s.rightTitle === 'string' ? s.rightTitle : undefined,
          rightBullets: Array.isArray(s.rightBullets) ? s.rightBullets.map((b) => String(b)) : undefined,
          metrics,
          table,
          speakerNotes: typeof s.speakerNotes === 'string' ? s.speakerNotes : undefined,
        };
      });

    if (slides.length === 0) {
      slides.push({ layout: 'title', title, subtitle });
    }

    return {
      format: 'pptx',
      title,
      subtitle,
      author: typeof raw.author === 'string' ? raw.author : 'MCP Hub Pro Studio',
      themeColor: normalizeHexColor(typeof raw.themeColor === 'string' ? raw.themeColor : undefined),
      slides,
    };
  }

  if (format === 'xlsx') {
    const rawSheets = Array.isArray(raw.sheets) ? raw.sheets : [];
    const sheets: XlsxSheetSpec[] = rawSheets
      .filter((sh): sh is Record<string, unknown> => Boolean(sh && typeof sh === 'object'))
      .map((sh, idx) => ({
        name: String(sh.name ?? `Sheet ${idx + 1}`).slice(0, 31),
        headers: Array.isArray(sh.headers) ? sh.headers.map((h) => String(h)) : ['Item', 'Value'],
        rows: Array.isArray(sh.rows)
          ? sh.rows.map((r) =>
              Array.isArray(r)
                ? r.map((c) =>
                    typeof c === 'number' || typeof c === 'boolean' ? c : String(c ?? '')
                  )
                : [String(r ?? '')]
            )
          : [],
      }));

    if (sheets.length === 0) {
      sheets.push({ name: 'Summary', headers: ['Field', 'Value'], rows: [['Title', title]] });
    }

    return {
      format: 'xlsx',
      title,
      sheets,
    };
  }

  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections: DocxSectionSpec[] = rawSections
    .filter((sec): sec is Record<string, unknown> => Boolean(sec && typeof sec === 'object'))
    .map((sec, idx) => {
      const rawTable = sec.table as Record<string, unknown> | undefined;
      const table =
        rawTable && Array.isArray(rawTable.headers) && Array.isArray(rawTable.rows)
          ? {
              headers: rawTable.headers.map((h) => String(h)),
              rows: rawTable.rows.map((r) =>
                Array.isArray(r) ? r.map((c) => String(c)) : [String(r)]
              ),
            }
          : undefined;
      return {
        heading:
          typeof sec.heading === 'string' && sec.heading.trim()
            ? sec.heading.trim()
            : `Section ${idx + 1}`,
        paragraphs: Array.isArray(sec.paragraphs) ? sec.paragraphs.map((p) => String(p)) : undefined,
        bullets: Array.isArray(sec.bullets) ? sec.bullets.map((b) => String(b)) : undefined,
        callout: typeof sec.callout === 'string' ? sec.callout : undefined,
        table,
      };
    });

  if (sections.length === 0) {
    sections.push({ heading: title, paragraphs: subtitle ? [subtitle] : [] });
  }

  const author = typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : undefined;
  const dateLabel =
    typeof raw.dateLabel === 'string' && raw.dateLabel.trim() ? raw.dateLabel.trim() : undefined;
  const themeColor =
    typeof raw.themeColor === 'string'
      ? normalizeHexColor(raw.themeColor)
      : undefined;
  const metrics: DocMetricItem[] | undefined = Array.isArray(raw.metrics)
    ? raw.metrics
        .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
        .slice(0, 4)
        .map((m) => ({
          label: String(m.label ?? 'Metric'),
          value: String(m.value ?? '—'),
          note: typeof m.note === 'string' ? m.note : undefined,
        }))
    : undefined;

  return format === 'docx'
    ? { format: 'docx', title, subtitle, author, dateLabel, themeColor, metrics, sections }
    : { format: 'pdf', title, subtitle, author, dateLabel, themeColor, metrics, sections };
}

/**
 * Converts arbitrary Markdown prose/tables/headings into a structured DocumentSpec
 * so any Pro or Study response can be exported cleanly to PPTX, DOCX, XLSX, or PDF.
 */
export function markdownToDocSpec(
  markdown: string,
  fallbackTitle: string,
  format: DocFormat
): DocumentSpec {
  const blocks = parseMarkdownBlocks(markdown);

  let docTitle = cleanText(fallbackTitle) || 'MCP Hub Report';
  const firstH1 = blocks.find((b) => b.type === 'heading' && b.level === 1);
  if (firstH1 && firstH1.type === 'heading') {
    docTitle = cleanText(firstH1.text);
  }

  // Group blocks into logical sections
  const sections: DocxSectionSpec[] = [];
  let current: DocxSectionSpec = {
    heading: 'Overview',
    paragraphs: [],
    bullets: [],
  };

  const pushCurrentIfNotEmpty = () => {
    if (
      (current.paragraphs && current.paragraphs.length > 0) ||
      (current.bullets && current.bullets.length > 0) ||
      current.callout ||
      current.table
    ) {
      sections.push(current);
    }
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (block.level === 1 && cleanText(block.text) === docTitle) continue;
      pushCurrentIfNotEmpty();
      current = {
        heading: cleanText(block.text),
        paragraphs: [],
        bullets: [],
      };
    } else if (block.type === 'paragraph') {
      current.paragraphs = current.paragraphs ?? [];
      current.paragraphs.push(cleanText(block.text));
    } else if (block.type === 'ul') {
      current.bullets = current.bullets ?? [];
      for (const item of block.items) {
        current.bullets.push(cleanText(item.text));
      }
    } else if (block.type === 'ol') {
      current.bullets = current.bullets ?? [];
      block.items.forEach((item, idx) => {
        current.bullets!.push(`${idx + 1}. ${cleanText(item)}`);
      });
    } else if (block.type === 'blockquote') {
      current.callout = cleanText(block.lines.join(' '));
    } else if (block.type === 'table') {
      if (current.table) {
        pushCurrentIfNotEmpty();
        current = {
          heading: `${current.heading} (Table)`,
          paragraphs: [],
          bullets: [],
        };
      }
      current.table = {
        headers: block.headers.map(cleanText),
        rows: block.rows.map((r) => r.map(cleanText)),
      };
    } else if (block.type === 'code') {
      const embedded = parseArtifactBlock(block.language, block.code);
      if (embedded && embedded.format === format) {
        return embedded;
      }
    }
  }
  pushCurrentIfNotEmpty();

  if (sections.length === 0) {
    sections.push({
      heading: 'Summary',
      paragraphs: [cleanText(markdown) || 'No content available.'],
    });
  }

  if (format === 'xlsx') {
    const sheets: XlsxSheetSpec[] = [];
    let tableIdx = 1;
    for (const sec of sections) {
      if (sec.table) {
        sheets.push({
          name: (sec.heading || `Table ${tableIdx}`).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet ${tableIdx}`,
          headers: sec.table.headers,
          rows: sec.table.rows,
        });
        tableIdx++;
      }
    }
    if (sheets.length === 0) {
      const rows: Array<Array<string>> = [];
      for (const sec of sections) {
        for (const p of sec.paragraphs ?? []) {
          rows.push([sec.heading, 'Paragraph', p]);
        }
        for (const b of sec.bullets ?? []) {
          rows.push([sec.heading, 'Point', b]);
        }
        if (sec.callout) {
          rows.push([sec.heading, 'Key Note', sec.callout]);
        }
      }
      sheets.push({
        name: 'Summary',
        headers: ['Section', 'Type', 'Details'],
        rows,
      });
    }
    return { format: 'xlsx', title: docTitle, sheets };
  }

  if (format === 'pptx') {
    const slides: PptxSlideSpec[] = [
      {
        layout: 'title',
        title: docTitle,
        subtitle: `Generated by MCP Hub Pro Studio · ${new Date().toLocaleDateString()}`,
      },
    ];

    for (const sec of sections) {
      if (sec.table) {
        slides.push({
          layout: 'table',
          title: sec.heading,
          table: sec.table,
          speakerNotes: sec.callout,
        });
      }
      const combinedBullets = [
        ...(sec.bullets ?? []),
        ...(sec.paragraphs ?? []).slice(0, 2),
      ].slice(0, 6);
      if (combinedBullets.length > 0 || !sec.table) {
        slides.push({
          layout: 'bullets',
          title: sec.heading,
          bullets: combinedBullets.length > 0 ? combinedBullets : [sec.callout || docTitle],
          speakerNotes: sec.callout,
        });
      }
    }
    return {
      format: 'pptx',
      title: docTitle,
      subtitle: 'Executive Summary Deck',
      author: 'MCP Hub Pro Studio',
      themeColor: '0B57D0',
      slides,
    };
  }

  if (format === 'docx') {
    return {
      format: 'docx',
      title: docTitle,
      subtitle: `Prepared ${new Date().toLocaleDateString()}`,
      sections,
    };
  }

  return {
    format: 'pdf',
    title: docTitle,
    subtitle: `Prepared ${new Date().toLocaleDateString()}`,
    sections,
  };
}

/**
 * Generates a genuine PowerPoint .pptx binary using PptxGenJS Slide Masters,
 * native typography, KPI cards, native tables, and speaker notes.
 */
export async function buildPptxBlob(spec: PptxSpec): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.author = spec.author ?? 'MCP Hub Pro Studio';
  pptx.title = spec.title;
  pptx.subject = spec.subtitle ?? spec.title;

  const accent = normalizeHexColor(spec.themeColor, '0B57D0');
  const darkInk = '0F172A';
  const mutedInk = '475569';
  const lightSurface = 'F8FAFC';
  const cardSurface = 'EFF6FF';
  const borderHex = 'CBD5E1';

  pptx.defineSlideMaster({
    title: 'PRO_CONTENT_MASTER',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: '100%', h: 0.1, fill: { color: accent } } },
      {
        text: {
          text: spec.title,
          options: { x: 0.65, y: 7.08, w: 9.5, h: 0.28, fontSize: 9, color: mutedInk, fontFace: 'Calibri' },
        },
      },
    ],
    slideNumber: { x: 12.1, y: 7.08, fontSize: 9, color: mutedInk, fontFace: 'Calibri' },
  });

  spec.slides.forEach((slideSpec) => {
    if (slideSpec.layout === 'title') {
      const slide = pptx.addSlide();
      slide.background = { color: darkInk };
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 0.28,
        h: 7.5,
        fill: { color: accent },
      });
      slide.addText('EXECUTIVE PRESENTATION', {
        x: 0.9,
        y: 1.55,
        w: 10.5,
        h: 0.4,
        fontSize: 12,
        bold: true,
        color: '93C5FD',
        charSpacing: 3,
        fontFace: 'Calibri',
      });
      slide.addText(slideSpec.title, {
        x: 0.9,
        y: 2.1,
        w: 11.2,
        h: 1.8,
        fontSize: 38,
        bold: true,
        color: 'FFFFFF',
        fontFace: 'Calibri',
        valign: 'top',
      });
      if (slideSpec.subtitle || spec.subtitle) {
        slide.addText(slideSpec.subtitle || spec.subtitle || '', {
          x: 0.9,
          y: 4.15,
          w: 10.5,
          h: 1.0,
          fontSize: 18,
          color: 'CBD5E1',
          fontFace: 'Calibri',
        });
      }
      slide.addText(`${spec.author || 'MCP Hub Pro Studio'} · ${new Date().toLocaleDateString()}`, {
        x: 0.9,
        y: 6.45,
        w: 9.0,
        h: 0.35,
        fontSize: 11,
        color: '94A3B8',
        fontFace: 'Calibri',
      });
      if (slideSpec.speakerNotes) slide.addNotes(slideSpec.speakerNotes);
      return;
    }

    const slide = pptx.addSlide({ masterName: 'PRO_CONTENT_MASTER' });
    slide.addText(slideSpec.title, {
      x: 0.65,
      y: 0.38,
      w: 12.0,
      h: 0.65,
      fontSize: 25,
      bold: true,
      color: darkInk,
      fontFace: 'Calibri',
    });

    if (slideSpec.subtitle) {
      slide.addText(slideSpec.subtitle, {
        x: 0.65,
        y: 1.0,
        w: 12.0,
        h: 0.4,
        fontSize: 13,
        color: mutedInk,
        fontFace: 'Calibri',
      });
    }

    const contentTop = slideSpec.subtitle ? 1.55 : 1.25;

    if (slideSpec.layout === 'metrics' && slideSpec.metrics && slideSpec.metrics.length > 0) {
      const items = slideSpec.metrics.slice(0, 4);
      const cols = Math.min(items.length, 4);
      const gap = 0.28;
      const totalW = 12.0;
      const cardW = (totalW - gap * (cols - 1)) / cols;

      items.forEach((m, mi) => {
        const x = 0.65 + mi * (cardW + gap);
        slide.addShape(pptx.ShapeType.roundRect, {
          x,
          y: contentTop + 0.15,
          w: cardW,
          h: 2.3,
          rectRadius: 0.1,
          fill: { color: cardSurface },
          line: { color: borderHex, pt: 1 },
        });
        slide.addText(m.label, {
          x: x + 0.2,
          y: contentTop + 0.38,
          w: cardW - 0.4,
          h: 0.4,
          fontSize: 12,
          bold: true,
          color: mutedInk,
          fontFace: 'Calibri',
        });
        slide.addText(m.value, {
          x: x + 0.2,
          y: contentTop + 0.88,
          w: cardW - 0.4,
          h: 0.75,
          fontSize: 28,
          bold: true,
          color: accent,
          fontFace: 'Calibri',
        });
        if (m.note) {
          slide.addText(m.note, {
            x: x + 0.2,
            y: contentTop + 1.72,
            w: cardW - 0.4,
            h: 0.5,
            fontSize: 11,
            color: mutedInk,
            fontFace: 'Calibri',
          });
        }
      });

      if (slideSpec.bullets && slideSpec.bullets.length > 0) {
        slide.addText(
          slideSpec.bullets.map((b) => ({
            text: cleanText(b),
            options: { bullet: true, breakLine: true, paraSpaceAfter: 8 },
          })),
          {
            x: 0.65,
            y: contentTop + 2.75,
            w: 12.0,
            h: 2.3,
            fontSize: 15,
            color: darkInk,
            fontFace: 'Calibri',
            valign: 'top',
          }
        );
      }
    } else if (slideSpec.layout === 'two_col') {
      const colW = 5.8;
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.65,
        y: contentTop,
        w: colW,
        h: 5.1,
        rectRadius: 0.08,
        fill: { color: lightSurface },
        line: { color: borderHex, pt: 1 },
      });
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 6.85,
        y: contentTop,
        w: colW,
        h: 5.1,
        rectRadius: 0.08,
        fill: { color: lightSurface },
        line: { color: borderHex, pt: 1 },
      });

      if (slideSpec.leftTitle) {
        slide.addText(slideSpec.leftTitle, {
          x: 0.9,
          y: contentTop + 0.22,
          w: colW - 0.5,
          h: 0.45,
          fontSize: 16,
          bold: true,
          color: accent,
          fontFace: 'Calibri',
        });
      }
      if (slideSpec.leftBullets?.length) {
        slide.addText(
          slideSpec.leftBullets.map((b) => ({
            text: cleanText(b),
            options: { bullet: true, breakLine: true, paraSpaceAfter: 10 },
          })),
          {
            x: 0.9,
            y: contentTop + 0.78,
            w: colW - 0.5,
            h: 4.1,
            fontSize: 14,
            color: darkInk,
            fontFace: 'Calibri',
            valign: 'top',
          }
        );
      }

      if (slideSpec.rightTitle) {
        slide.addText(slideSpec.rightTitle, {
          x: 7.1,
          y: contentTop + 0.22,
          w: colW - 0.5,
          h: 0.45,
          fontSize: 16,
          bold: true,
          color: accent,
          fontFace: 'Calibri',
        });
      }
      if (slideSpec.rightBullets?.length) {
        slide.addText(
          slideSpec.rightBullets.map((b) => ({
            text: cleanText(b),
            options: { bullet: true, breakLine: true, paraSpaceAfter: 10 },
          })),
          {
            x: 7.1,
            y: contentTop + 0.78,
            w: colW - 0.5,
            h: 4.1,
            fontSize: 14,
            color: darkInk,
            fontFace: 'Calibri',
            valign: 'top',
          }
        );
      }
    } else if (slideSpec.layout === 'table' && slideSpec.table) {
      const tableRows: PptxGenJS.TableRow[] = [
        slideSpec.table.headers.map((h) => ({
          text: cleanText(h),
          options: {
            bold: true,
            color: 'FFFFFF',
            fill: { color: accent },
            fontSize: 12,
            margin: [6, 8, 6, 8] as [number, number, number, number],
          },
        })),
        ...slideSpec.table.rows.slice(0, 12).map((row, rIdx) =>
          row.map((cell) => ({
            text: cleanText(cell),
            options: {
              color: darkInk,
              fill: { color: rIdx % 2 === 1 ? lightSurface : 'FFFFFF' },
              fontSize: 11,
              margin: [5, 8, 5, 8] as [number, number, number, number],
            },
          }))
        ),
      ];
      slide.addTable(tableRows, {
        x: 0.65,
        y: contentTop,
        w: 12.0,
        border: { type: 'solid', pt: 0.5, color: borderHex },
        fontFace: 'Calibri',
      });
    } else {
      const bullets = slideSpec.bullets ?? [];
      if (bullets.length > 0) {
        slide.addText(
          bullets.map((b) => ({
            text: cleanText(b),
            options: { bullet: true, breakLine: true, paraSpaceAfter: 12 },
          })),
          {
            x: 0.75,
            y: contentTop + 0.1,
            w: 11.8,
            h: 5.2,
            fontSize: 17,
            color: darkInk,
            fontFace: 'Calibri',
            valign: 'top',
          }
        );
      }
    }

    if (slideSpec.speakerNotes) {
      slide.addNotes(slideSpec.speakerNotes);
    }
  });

  const output = await pptx.write({ outputType: 'uint8array' });
  if (output instanceof Uint8Array) {
    return new Blob([output.slice().buffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
  }
  return new Blob([output as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}

function parseBoldSegments(text: string): Array<{ text: string; bold: boolean }> {
  const segments: Array<{ text: string; bold: boolean }> = [];
  const regex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false });
  }
  return segments.length > 0 ? segments : [{ text, bold: false }];
}

function buildDocxRuns(text: string, size = 22, color?: string): TextRun[] {
  return parseBoldSegments(text).map(
    (seg) =>
      new TextRun({
        text: seg.text,
        bold: seg.bold,
        size,
        ...(color ? { color } : {}),
      })
  );
}

/**
 * Generates a real Microsoft Word .docx binary with styled headings, callouts,
 * inline bold runs, KPI summary strips, bullet lists, and formatted tables.
 */
export async function buildDocxBlob(spec: DocxSpec): Promise<Blob> {
  const accent = normalizeHexColor(spec.themeColor, '0B57D0');
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: spec.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 100 },
    }),
  ];

  if (spec.subtitle || spec.author || spec.dateLabel) {
    const metaParts = [spec.subtitle, spec.author, spec.dateLabel].filter(Boolean).join(' · ');
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaParts, color: '475569', italics: true, size: 22 })],
        spacing: { after: 220 },
      })
    );
  }

  if (spec.metrics && spec.metrics.length > 0) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
          left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
          right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
          insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
        },
        rows: [
          new TableRow({
            children: spec.metrics.slice(0, 4).map(
              (m) =>
                new TableCell({
                  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EFF6FF' },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: `${m.label.toUpperCase()}\n`, bold: true, color: '475569', size: 16 }),
                        new TextRun({ text: m.value, bold: true, color: accent, size: 28 }),
                        ...(m.note
                          ? [new TextRun({ text: `\n${m.note}`, color: '64748B', size: 16 })]
                          : []),
                      ],
                    }),
                  ],
                })
            ),
          }),
        ],
      })
    );
  }

  for (const sec of spec.sections) {
    children.push(
      new Paragraph({
        text: sec.heading,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      })
    );

    if (sec.callout) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: cleanText(sec.callout), bold: true, color: accent, size: 22 })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EFF6FF' },
          spacing: { before: 80, after: 140 },
        })
      );
    }

    for (const para of sec.paragraphs ?? []) {
      children.push(
        new Paragraph({
          children: buildDocxRuns(para, 22),
          spacing: { after: 120 },
        })
      );
    }

    for (const bullet of sec.bullets ?? []) {
      children.push(
        new Paragraph({
          children: buildDocxRuns(bullet, 22),
          bullet: { level: 0 },
          spacing: { after: 80 },
        })
      );
    }

    if (sec.table && sec.table.headers.length > 0) {
      const headerRow = new TableRow({
        tableHeader: true,
        children: sec.table.headers.map(
          (h) =>
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: accent },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: cleanText(h), bold: true, color: 'FFFFFF', size: 20 })],
                  alignment: AlignmentType.LEFT,
                }),
              ],
            })
        ),
      });

      const bodyRows = sec.table.rows.map(
        (row) =>
          new TableRow({
            children: sec.table!.headers.map(
              (_, colIdx) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: cleanText(row[colIdx] ?? ''), size: 20 })],
                    }),
                  ],
                })
            ),
          })
      );

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' },
          },
          rows: [headerRow, ...bodyRows],
        })
      );
    }
  }

  const doc = new Document({
    creator: spec.author || 'MCP Hub Pro Studio',
    title: spec.title,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

/**
 * Generates a multi-sheet Microsoft Excel .xlsx workbook using ExcelJS with styled headers & auto-sized widths.
 */
export async function buildXlsxBlob(spec: XlsxSpec): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.title = spec.title;
  wb.creator = 'MCP Hub Pro Studio';
  wb.created = new Date();

  spec.sheets.forEach((sheetSpec, idx) => {
    const safeName =
      sheetSpec.name.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet ${idx + 1}`;
    const ws = wb.addWorksheet(safeName);

    const headerRow = ws.addRow(sheetSpec.headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0B57D0' },
    };

    for (const row of sheetSpec.rows) {
      ws.addRow(row);
    }

    ws.columns = sheetSpec.headers.map((h, ci) => {
      const maxLen = Math.max(
        h.length,
        ...sheetSpec.rows.map((r) => String(r[ci] ?? '').length)
      );
      return { width: Math.min(48, Math.max(12, maxLen + 3)) };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function hexToRgbTuple(hex?: string): [number, number, number] {
  const norm = normalizeHexColor(hex, '0B57D0');
  const r = parseInt(norm.slice(0, 2), 16);
  const g = parseInt(norm.slice(2, 4), 16);
  const b = parseInt(norm.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * Generates an executive-grade, cleanly typeset PDF document using jsPDF + jspdf-autotable,
 * with KPI metric strips, bold lead-in rendering, callout cards, repeating table headers, and page footers.
 */
export function buildPdfBlob(spec: PdfSpec): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const maxWidth = pageWidth - marginX * 2;
  const [accentR, accentG, accentB] = hexToRgbTuple(spec.themeColor);
  let cursorY = 56;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 54) {
      doc.addPage();
      cursorY = 58;
    }
  };

  const renderStyledRichLine = (rawText: string, startX: number, availWidth: number, prefix = '') => {
    // Detect bold lead-in syntax: "**Label:** rest of text" or clean text
    const boldLeadMatch = /^\s*\*\*([^*]{1,80})\*\*\s*(.*)$/.exec(rawText.trim());
    if (boldLeadMatch && prefix === '') {
      const lead = `${cleanText(boldLeadMatch[1])} `;
      const rest = cleanText(boldLeadMatch[2]);
      doc.setFont('helvetica', 'bold');
      const leadW = doc.getTextWidth(lead);
      if (leadW < availWidth * 0.65 && rest) {
        const firstLineAvail = availWidth - leadW;
        const restWords = rest.split(/\s+/);
        let firstChunk = '';
        let consumed = 0;
        doc.setFont('helvetica', 'normal');
        for (let i = 0; i < restWords.length; i++) {
          const candidate = firstChunk ? `${firstChunk} ${restWords[i]}` : restWords[i];
          if (doc.getTextWidth(candidate) <= firstLineAvail) {
            firstChunk = candidate;
            consumed = i + 1;
          } else {
            break;
          }
        }
        const remainingText = restWords.slice(consumed).join(' ');
        const extraLines = remainingText ? (doc.splitTextToSize(remainingText, availWidth) as string[]) : [];
        ensureSpace((1 + extraLines.length) * 14 + 6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        doc.text(lead, startX, cursorY);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        if (firstChunk) {
          doc.text(firstChunk, startX + leadW, cursorY);
        }
        cursorY += 14;
        if (extraLines.length > 0) {
          doc.text(extraLines, startX, cursorY);
          cursorY += extraLines.length * 14;
        }
        cursorY += 5;
        return;
      }
    }

    const plain = prefix ? `${prefix}${cleanText(rawText)}` : cleanText(rawText);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(plain, availWidth) as string[];
    ensureSpace(lines.length * 14 + 6);
    doc.text(lines, startX, cursorY);
    cursorY += lines.length * 14 + 5;
  };

  // Top accent bar & executive title block
  doc.setFillColor(accentR, accentG, accentB);
  doc.rect(marginX, cursorY - 14, 42, 4, 'F');
  cursorY += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(21);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(cleanText(spec.title), maxWidth) as string[];
  doc.text(titleLines, marginX, cursorY);
  cursorY += titleLines.length * 25 + 2;

  if (spec.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(71, 85, 105);
    const subLines = doc.splitTextToSize(cleanText(spec.subtitle), maxWidth) as string[];
    doc.text(subLines, marginX, cursorY);
    cursorY += subLines.length * 14 + 4;
  }

  const metaLine = [spec.author || 'MCP Hub Pro Studio', spec.dateLabel || new Date().toLocaleDateString()]
    .filter(Boolean)
    .join(' · ');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text(metaLine, marginX, cursorY);
  cursorY += 14;

  // Divider rule
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.75);
  doc.line(marginX, cursorY, pageWidth - marginX, cursorY);
  cursorY += 14;

  // Optional Executive KPI Metrics Strip
  if (spec.metrics && spec.metrics.length > 0) {
    const items = spec.metrics.slice(0, 4);
    const gap = 10;
    const cardW = (maxWidth - gap * (items.length - 1)) / items.length;
    const cardH = 54;
    ensureSpace(cardH + 14);
    items.forEach((m, idx) => {
      const cx = marginX + idx * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cx, cursorY, cardW, cardH, 6, 6, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(cleanText(m.label).toUpperCase().slice(0, 24), cx + 9, cursorY + 15);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(accentR, accentG, accentB);
      doc.text(cleanText(m.value).slice(0, 18), cx + 9, cursorY + 34);

      if (m.note) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(cleanText(m.note).slice(0, 26), cx + 9, cursorY + 47);
      }
    });
    cursorY += cardH + 18;
  }

  spec.sections.forEach((sec, secIdx) => {
    ensureSpace(48);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(accentR, accentG, accentB);
    const headingLabel = `${secIdx + 1}. ${cleanText(sec.heading)}`;
    const hLines = doc.splitTextToSize(headingLabel, maxWidth) as string[];
    doc.text(hLines, marginX, cursorY);
    cursorY += hLines.length * 17 + 4;

    if (sec.callout) {
      const cLines = doc.splitTextToSize(cleanText(sec.callout), maxWidth - 22) as string[];
      const boxH = cLines.length * 14 + 14;
      ensureSpace(boxH + 10);
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(marginX, cursorY - 9, maxWidth, boxH, 5, 5, 'F');
      doc.setFillColor(accentR, accentG, accentB);
      doc.rect(marginX, cursorY - 9, 3.5, boxH, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(30, 58, 138);
      doc.text(cLines, marginX + 12, cursorY + 5);
      cursorY += boxH + 10;
    }

    doc.setFontSize(10.5);
    for (const para of sec.paragraphs ?? []) {
      renderStyledRichLine(para, marginX, maxWidth);
    }

    for (const bullet of sec.bullets ?? []) {
      renderStyledRichLine(bullet, marginX + 10, maxWidth - 10, '•  ');
    }

    if (sec.table && sec.table.headers.length > 0) {
      ensureSpace(72);
      autoTable(doc, {
        startY: cursorY,
        head: [sec.table.headers.map(cleanText)],
        body: sec.table.rows.map((r) => r.map(cleanText)),
        margin: { left: marginX, right: marginX },
        showHead: 'everyPage',
        styles: { fontSize: 9.5, cellPadding: 6, textColor: [30, 41, 59], lineColor: [226, 232, 240] },
        headStyles: { fillColor: [accentR, accentG, accentB], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
      cursorY = (lastTable?.finalY ?? cursorY + 60) + 18;
    } else {
      cursorY += 8;
    }
  });

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    if (p > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184);
      doc.text(cleanText(spec.title).slice(0, 70), marginX, 28);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`${spec.author || 'MCP Hub Pro Studio'} · Page ${p} of ${pageCount}`, marginX, pageHeight - 24);
  }

  return doc.output('blob');
}

export async function generateDocumentBlob(spec: DocumentSpec): Promise<Blob> {
  switch (spec.format) {
    case 'pptx':
      return buildPptxBlob(spec);
    case 'docx':
      return buildDocxBlob(spec);
    case 'xlsx':
      return buildXlsxBlob(spec);
    case 'pdf':
      return buildPdfBlob(spec);
  }
}

export async function downloadDocumentSpec(spec: DocumentSpec): Promise<string> {
  const filename = sanitizeFilename(spec.title, spec.format);
  const blob = await generateDocumentBlob(spec);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}
