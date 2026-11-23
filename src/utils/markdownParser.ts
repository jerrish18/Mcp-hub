export type TableAlignment = 'left' | 'center' | 'right';

export type CalloutKind =
  | 'note'
  | 'tip'
  | 'important'
  | 'warning'
  | 'definition'
  | 'formula'
  | 'hint';

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | {
      type: 'blockquote';
      lines: string[];
      calloutKind?: CalloutKind;
      calloutTitle?: string;
      isCollapsible?: boolean;
    }
  | { type: 'code'; language: string; code: string; isUnclosed?: boolean }
  | { type: 'math_block'; latex: string; isUnclosed?: boolean }
  | { type: 'image'; alt: string; url: string; caption?: string }
  | { type: 'table'; headers: string[]; alignments: TableAlignment[]; rows: string[][] }
  | { type: 'ul'; items: Array<{ text: string; checked?: boolean }> }
  | { type: 'ol'; items: string[] }
  | { type: 'hr' };

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'strike'; text: string }
  | { type: 'math'; text: string }
  | { type: 'image'; alt: string; url: string }
  | { type: 'link'; label: string; url: string };

export function slugifyHeading(text: string, index: number): string {
  const clean = text.replace(/\*\*/g, '').replace(/`/g, '').trim();
  const base = clean
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `study-sec-${base || 'part'}-${index}`;
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      current += '|';
      i++;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  if (!trimmed.includes('|')) return false;
  const cells = splitTableCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function parseTableAlignments(line: string, count: number): TableAlignment[] {
  const cells = splitTableCells(line);
  const alignments: TableAlignment[] = [];
  for (let i = 0; i < count; i++) {
    const cell = (cells[i] ?? '').trim();
    if (cell.startsWith(':') && cell.endsWith(':')) {
      alignments.push('center');
    } else if (cell.endsWith(':')) {
      alignments.push('right');
    } else {
      alignments.push('left');
    }
  }
  return alignments;
}

function isHorizontalRule(line: string): boolean {
  const t = line.trim();
  return /^([-*_])(\s*\1){2,}$/.test(t);
}

function normalizeRowToColumnCount(cells: string[], colCount: number): string[] {
  if (cells.length === colCount) return cells;
  if (cells.length > colCount) return cells.slice(0, colCount);
  return [...cells, ...Array.from({ length: colCount - cells.length }, () => '')];
}

const CALLOUT_MAP: Record<string, CalloutKind> = {
  NOTE: 'note',
  INFO: 'note',
  SUMMARY: 'note',
  TIP: 'tip',
  EXAMPLE: 'tip',
  IMPORTANT: 'important',
  KEY: 'important',
  WARNING: 'warning',
  CAUTION: 'warning',
  TRAP: 'warning',
  DEFINITION: 'definition',
  FORMULA: 'formula',
  EQUATION: 'formula',
  HINT: 'hint',
  ANSWER: 'hint',
  SOLUTION: 'hint',
};

function parseCalloutHeader(firstLine: string): {
  kind: CalloutKind;
  title: string;
  isCollapsible: boolean;
} | null {
  const match = /^\[!([A-Za-z]+)\]([+-])?(?:\s+(.*))?$/.exec(firstLine.trim());
  if (!match) return null;
  const rawKind = match[1].toUpperCase();
  const kind = CALLOUT_MAP[rawKind] ?? 'note';
  const defaultTitle = rawKind.charAt(0) + rawKind.slice(1).toLowerCase();
  const title = match[3]?.trim() || defaultTitle;
  const isCollapsible = match[2] === '-' || kind === 'hint';
  return { kind, title, isCollapsible };
}

/**
 * Splits full or streaming Markdown into structured blocks supporting GFM tables,
 * closed & streaming fenced code blocks, $$...$$ display math blocks, headings,
 * Obsidian/GitHub study admonition callouts, checklists, ordered/unordered lists, and horizontal dividers.
 */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  if (!content) return [];

  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  let headingCounter = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Fenced code block (``` or ~~~), including unclosed streaming fences
    const fenceOpen = /^(`{3,}|~{3,})\s*([a-zA-Z0-9_+-]*)\s*$/.exec(trimmed);
    if (fenceOpen) {
      const marker = fenceOpen[1];
      const fenceChar = marker[0];
      const fenceLen = marker.length;
      const language = fenceOpen[2] || 'text';
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const curTrimmed = lines[i].trim();
        const closeRe = new RegExp(`^${fenceChar}{${fenceLen},}\\s*$`);
        if (closeRe.test(curTrimmed)) {
          closed = true;
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
        isUnclosed: !closed,
      });
      continue;
    }

    // 1b. Block Display Math ($$ ... $$) single-line or multi-line
    if (trimmed.startsWith('$$')) {
      const singleLineMatch = /^\$\$(.+?)\$\$$/.exec(trimmed);
      if (singleLineMatch && trimmed.length > 4) {
        blocks.push({ type: 'math_block', latex: singleLineMatch[1].trim() });
        i++;
        continue;
      }
      const afterOpen = trimmed.slice(2).trim();
      const mathLines: string[] = afterOpen ? [afterOpen] : [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const curTrimmed = lines[i].trim();
        if (curTrimmed.endsWith('$$')) {
          const beforeClose = curTrimmed.slice(0, -2).trim();
          if (beforeClose) mathLines.push(beforeClose);
          closed = true;
          i++;
          break;
        }
        mathLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'math_block',
        latex: mathLines.join('\n').trim(),
        isUnclosed: !closed,
      });
      continue;
    }

    // 2. Headings (# to ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      const text = headingMatch[2].replace(/\s+#+\s*$/, '').trim();
      blocks.push({
        type: 'heading',
        level,
        text,
        id: slugifyHeading(text, headingCounter++),
      });
      i++;
      continue;
    }

    // 3. Horizontal rule (---, ***, ___)
    if (isHorizontalRule(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 3b. Standalone Markdown Image (![alt](https://... "optional caption"))
    const standaloneImgMatch = /^!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+?)(?:\s+"([^"\n]*)")?\)$/.exec(trimmed);
    if (standaloneImgMatch) {
      blocks.push({
        type: 'image',
        alt: standaloneImgMatch[1].trim() || 'Study visual',
        url: standaloneImgMatch[2],
        caption: standaloneImgMatch[3]?.trim() || undefined,
      });
      i++;
      continue;
    }

    // 4. GitHub-Flavored Markdown Table (header line with | followed by separator line)
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = splitTableCells(line);
      const alignments = parseTableAlignments(lines[i + 1], headers.length);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowLine.includes('|') || isTableSeparatorLine(rowLine)) {
          break;
        }
        rows.push(normalizeRowToColumnCount(splitTableCells(rowLine), headers.length));
        i++;
      }
      blocks.push({
        type: 'table',
        headers,
        alignments,
        rows,
      });
      continue;
    }

    // 5. Blockquote (> ...) & Study Admonitions (> [!TIP], > [!DEFINITION], > [!HINT]-)
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const callout = quoteLines.length > 0 ? parseCalloutHeader(quoteLines[0]) : null;
      if (callout) {
        blocks.push({
          type: 'blockquote',
          lines: quoteLines.slice(1),
          calloutKind: callout.kind,
          calloutTitle: callout.title,
          isCollapsible: callout.isCollapsible,
        });
      } else {
        blocks.push({ type: 'blockquote', lines: quoteLines });
      }
      continue;
    }

    // 6. Unordered / task list (- , * , + , - [ ] , - [x] )
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Array<{ text: string; checked?: boolean }> = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const rawItem = lines[i].replace(/^\s*[-*+]\s+/, '');
        const taskMatch = /^\[( |x|X)\]\s+(.*)$/.exec(rawItem);
        if (taskMatch) {
          items.push({
            checked: taskMatch[1].toLowerCase() === 'x',
            text: taskMatch[2],
          });
        } else {
          items.push({ text: rawItem });
        }
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // 7. Ordered list (1. )
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // 8. Paragraph lines until blank line or structural syntax
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curT = cur.trim();
      if (!curT) break;
      if (/^(`{3,}|~{3,})/.test(curT)) break;
      if (curT.startsWith('$$')) break;
      if (/^(#{1,4})\s+/.test(curT)) break;
      if (isHorizontalRule(curT)) break;
      if (/^!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+?)(?:\s+"([^"\n]*)")?\)$/.test(curT)) break;
      if (cur.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) break;
      if (/^\s*>/.test(cur)) break;
      if (/^\s*[-*+]\s+/.test(cur)) break;
      if (/^\s*\d+[.)]\s+/.test(cur)) break;
      paraLines.push(cur);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    } else {
      i++;
    }
  }

  return blocks;
}

export function extractOutlineHeadings(
  blocks: MarkdownBlock[]
): Array<{ id: string; level: number; text: string }> {
  return blocks
    .filter((b): b is Extract<MarkdownBlock, { type: 'heading' }> => b.type === 'heading')
    .map((h) => ({
      id: h.id,
      level: h.level,
      text: h.text.replace(/\*\*/g, '').replace(/`/g, '').trim(),
    }));
}

/**
 * Parses inline markdown tokens safely, supporting inline code, links, bold, italic,
 * strikethrough, and inline LaTeX-style math spans ($...$).
 */
export function parseInlineTokens(text: string): InlineToken[] {
  if (!text) return [];
  const pattern =
    /(`[^`\n]+`|!\[[^\]\n]*\]\(https?:\/\/[^\s)]+(?:\s+"[^"\n]*")?\)|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\$(?!\s)[^$\n]*?[^\s$\\]\$(?!\d)|\*[^*\n]+\*|_[^_\n]+_)/g;

  const tokens: InlineToken[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push({ type: 'text', text: text.slice(lastIdx, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('`') && raw.endsWith('`') && raw.length >= 3) {
      tokens.push({ type: 'code', text: raw.slice(1, -1) });
    } else if (raw.startsWith('![')) {
      const imgMatch = /^!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+?)(?:\s+"[^"\n]*")?\)$/.exec(raw);
      if (imgMatch) {
        tokens.push({ type: 'image', alt: imgMatch[1].trim() || 'Study visual', url: imgMatch[2] });
      } else {
        tokens.push({ type: 'text', text: raw });
      }
    } else if (raw.startsWith('[')) {
      const linkMatch = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(raw);
      if (linkMatch) {
        tokens.push({ type: 'link', label: linkMatch[1], url: linkMatch[2] });
      } else {
        tokens.push({ type: 'text', text: raw });
      }
    } else if (raw.startsWith('**') && raw.endsWith('**') && raw.length >= 5) {
      tokens.push({ type: 'bold', text: raw.slice(2, -2) });
    } else if (raw.startsWith('~~') && raw.endsWith('~~') && raw.length >= 5) {
      tokens.push({ type: 'strike', text: raw.slice(2, -2) });
    } else if (raw.startsWith('$') && raw.endsWith('$') && raw.length >= 3) {
      tokens.push({ type: 'math', text: raw.slice(1, -1) });
    } else if (
      ((raw.startsWith('*') && raw.endsWith('*')) || (raw.startsWith('_') && raw.endsWith('_'))) &&
      raw.length >= 3
    ) {
      tokens.push({ type: 'italic', text: raw.slice(1, -1) });
    } else {
      tokens.push({ type: 'text', text: raw });
    }
    lastIdx = match.index + raw.length;
  }

  if (lastIdx < text.length) {
    tokens.push({ type: 'text', text: text.slice(lastIdx) });
  }
  return tokens;
}

export function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' visual or code block omitted. ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, ' figure $1. ')
    .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
    .replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION|DEFINITION|FORMULA|HINT|ANSWER|SOLUTION)\][+-]?/gi, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\|?[\s:-]+\|[\s|:-]*$/gm, ' ')
    .replace(/\|/g, ', ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`~$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
