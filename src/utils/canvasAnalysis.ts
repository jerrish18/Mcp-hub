import { unzipSync } from 'fflate';

export const CANVAS_ANALYSIS_PATH = '/__canvas-analysis';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 40;
export type AnalysisCell = string | number | boolean | null;
export interface AnalysisTable {
  columns: string[];
  rows: AnalysisCell[][];
  truncated?: boolean;
}
export interface AnalysisResult {
  table?: AnalysisTable;
  chart?: { title: string; points: Array<{ label: string; value: number }> };
}

function csvCell(value: string): AnalysisCell {
  const trimmed = value.trim();
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return value.slice(0, 4000);
}

export function parseCanvasCsv(source: string): AnalysisTable {
  const text = source.replace(/^\uFEFF/, '');
  const parsed: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let tooWide = false;
  const addRow = () => {
    row.push(cell);
    tooWide ||= row.length > MAX_COLUMNS;
    if (row.some((value) => value.length > 0)) parsed.push(row.slice(0, MAX_COLUMNS));
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"' && (quoted || !cell)) quoted = !quoted;
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (char === '\n' || char === '\r')) {
      addRow();
      if (parsed.length > MAX_ROWS + 1) break;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else cell += char;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  if (cell || row.length) addRow();
  const [header, ...rows] = parsed;
  if (!header?.length) throw new Error('The CSV is empty.');
  const columns = header.map((name, index) => name.trim().slice(0, 150) || `Column ${index + 1}`);
  return {
    columns,
    ...(tooWide || rows.length > MAX_ROWS ? { truncated: true } : {}),
    rows: rows.slice(0, MAX_ROWS).map((values) => columns.map((_, index) => index < values.length ? csvCell(values[index]) : null)),
  };
}

export function checkCanvasXlsx(bytes: Uint8Array): void {
  let entries = 0;
  let expanded = 0;
  unzipSync(bytes, {
    filter: (file) => {
      expanded += file.originalSize;
      if (++entries > 1000 || expanded > 24 * 1024 * 1024) throw new Error('The expanded XLSX exceeds the analysis limit.');
      return false;
    },
  });
}

export async function readCanvasAnalysisFile(file: File): Promise<AnalysisTable> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file under 5 MB.');
  if (/\.csv$/i.test(file.name)) return parseCanvasCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose a CSV or XLSX file.');
  const bytes = await file.arrayBuffer();
  checkCanvasXlsx(new Uint8Array(bytes));
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.worksheets.find((item) => item.state === 'visible') ?? book.worksheets[0];
  if (!sheet || !sheet.rowCount || !sheet.columnCount) throw new Error('The workbook does not contain data.');
  const columns = Array.from({ length: Math.min(sheet.columnCount, MAX_COLUMNS) }, (_, index) =>
    sheet.getCell(1, index + 1).text.trim().slice(0, 150) || `Column ${index + 1}`);
  const rows = Array.from({ length: Math.min(sheet.rowCount - 1, MAX_ROWS) }, (_, index) =>
    columns.map((_, column) => {
      const cell = sheet.getCell(index + 2, column + 1);
      const value = cell.type === ExcelJS.ValueType.Formula ? cell.result : cell.value;
      return value == null ? null : typeof value === 'number' || typeof value === 'boolean'
        ? value : cell.text.slice(0, 4000);
    }));
  return { columns, rows, ...(sheet.rowCount > MAX_ROWS + 1 || sheet.columnCount > MAX_COLUMNS ? { truncated: true } : {}) };
}

export function parseCanvasAnalysisResult(value: unknown): AnalysisResult {
  if (!value || typeof value !== 'object') throw new Error('Return a table or chart from your script.');
  const result = value as Partial<AnalysisResult>;
  const output: AnalysisResult = {};
  if (Array.isArray(result.table?.columns) && Array.isArray(result.table?.rows)) {
    const columns = result.table.columns.slice(0, MAX_COLUMNS).map((label) => String(label).slice(0, 150));
    output.table = {
      columns,
      rows: result.table.rows.filter(Array.isArray).slice(0, 100).map((row) =>
        columns.map((_, index) => {
          const cell = row[index];
          return typeof cell === 'string' ? cell.slice(0, 400) :
            typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell)) ? cell : null;
        })),
    };
  }
  if (Array.isArray(result.chart?.points)) {
    const points = result.chart.points.filter((point) => point && typeof point.label === 'string' && Number.isFinite(point.value))
      .slice(0, 30).map(({ label, value }) => ({ label: label.slice(0, 100), value }));
    if (points.length) output.chart = { title: String(result.chart.title ?? 'Analysis chart').slice(0, 150), points };
  }
  if (!output.chart && !output.table?.columns.length) throw new Error('Return a table or chart from your script.');
  return output;
}
