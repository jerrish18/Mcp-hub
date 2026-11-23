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
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';
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
  sections: DocxSectionSpec[];
}

export interface PdfSpec {
  format: 'pdf';
  title: string;
  subtitle?: string;
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

  return format === 'docx'
    ? { format: 'docx', title, subtitle, sections }
    : { format: 'pdf', title, subtitle, sections };
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

/**
 * Generates a real Microsoft Word .docx binary with styled headings, callouts,
 * bullet lists, and formatted tables.
 */
export async function buildDocxBlob(spec: DocxSpec): Promise<Blob> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: spec.title,
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
    }),
  ];

  if (spec.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: spec.subtitle, color: '475569', italics: true, size: 22 })],
        spacing: { after: 240 },
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
          children: [new TextRun({ text: sec.callout, bold: true, color: '0B57D0', size: 22 })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EFF6FF' },
          spacing: { before: 80, after: 140 },
        })
      );
    }

    for (const para of sec.paragraphs ?? []) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 22 })],
          spacing: { after: 120 },
        })
      );
    }

    for (const bullet of sec.bullets ?? []) {
      children.push(
        new Paragraph({
          text: bullet,
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
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: '0B57D0' },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20 })],
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
                      children: [new TextRun({ text: row[colIdx] ?? '', size: 20 })],
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
    creator: 'MCP Hub Pro Studio',
    title: spec.title,
    sections: [{ children }],
  });

  return Packer.toBlob(doc);
}

/**
 * Generates a multi-sheet Microsoft Excel .xlsx workbook with auto-sized column widths.
 */
export function buildXlsxBlob(spec: XlsxSpec): Blob {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: spec.title,
    Author: 'MCP Hub Pro Studio',
    CreatedDate: new Date(),
  };

  spec.sheets.forEach((sheetSpec, idx) => {
    const aoa: Array<Array<string | number | boolean>> = [
      sheetSpec.headers,
      ...sheetSpec.rows,
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = sheetSpec.headers.map((h, ci) => {
      const maxLen = Math.max(
        h.length,
        ...sheetSpec.rows.map((r) => String(r[ci] ?? '').length)
      );
      return { wch: Math.min(48, Math.max(12, maxLen + 3)) };
    });

    const safeName =
      sheetSpec.name.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || `Sheet ${idx + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Generates a cleanly typeset PDF document using jsPDF + jspdf-autotable.
 */
export function buildPdfBlob(spec: PdfSpec): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const maxWidth = pageWidth - marginX * 2;
  let cursorY = 56;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - 54) {
      doc.addPage();
      cursorY = 52;
    }
  };

  // Title banner
  doc.setFillColor(11, 87, 208);
  doc.rect(marginX, cursorY - 14, 36, 4, 'F');
  cursorY += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  const titleLines = doc.splitTextToSize(spec.title, maxWidth) as string[];
  doc.text(titleLines, marginX, cursorY);
  cursorY += titleLines.length * 24 + 4;

  if (spec.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(100, 116, 139);
    const subLines = doc.splitTextToSize(spec.subtitle, maxWidth) as string[];
    doc.text(subLines, marginX, cursorY);
    cursorY += subLines.length * 14 + 12;
  } else {
    cursorY += 8;
  }

  for (const sec of spec.sections) {
    ensureSpace(44);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(11, 87, 208);
    const hLines = doc.splitTextToSize(sec.heading, maxWidth) as string[];
    doc.text(hLines, marginX, cursorY);
    cursorY += hLines.length * 17 + 4;

    if (sec.callout) {
      const cLines = doc.splitTextToSize(sec.callout, maxWidth - 20) as string[];
      const boxH = cLines.length * 14 + 14;
      ensureSpace(boxH + 8);
      doc.setFillColor(239, 246, 255);
      doc.roundedRect(marginX, cursorY - 10, maxWidth, boxH, 4, 4, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(30, 58, 138);
      doc.text(cLines, marginX + 10, cursorY + 4);
      cursorY += boxH + 8;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(30, 41, 59);

    for (const para of sec.paragraphs ?? []) {
      const pLines = doc.splitTextToSize(para, maxWidth) as string[];
      ensureSpace(pLines.length * 14 + 6);
      doc.text(pLines, marginX, cursorY);
      cursorY += pLines.length * 14 + 7;
    }

    for (const bullet of sec.bullets ?? []) {
      const bLines = doc.splitTextToSize(`•  ${bullet}`, maxWidth - 10) as string[];
      ensureSpace(bLines.length * 14 + 4);
      doc.text(bLines, marginX + 8, cursorY);
      cursorY += bLines.length * 14 + 4;
    }

    if (sec.table && sec.table.headers.length > 0) {
      ensureSpace(64);
      autoTable(doc, {
        startY: cursorY,
        head: [sec.table.headers],
        body: sec.table.rows,
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 9.5, cellPadding: 5, textColor: [30, 41, 59] },
        headStyles: { fillColor: [11, 87, 208], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });
      const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
      cursorY = (lastTable?.finalY ?? cursorY + 60) + 16;
    } else {
      cursorY += 6;
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`MCP Hub Pro Studio · Page ${p} of ${pageCount}`, marginX, pageHeight - 24);
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
