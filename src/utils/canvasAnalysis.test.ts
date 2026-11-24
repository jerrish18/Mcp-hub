import assert from 'node:assert/strict';
import { test } from 'node:test';
import ExcelJS from 'exceljs';
import { CANVAS_ANALYSIS_CSP } from '../server/canvasAnalysis';
import { parseCanvasAnalysisResult, parseCanvasCsv, readCanvasAnalysisFile } from './canvasAnalysis';

test('CSV analysis parses quoted line breaks, escaped quotes, typed numbers and missing cells', () => {
  assert.deepEqual(parseCanvasCsv('\uFEFFName,Count,Code\r\n"Alpha, Beta",4,001\r\n"A ""quote""\ninside",2\r\n'), {
    columns: ['Name', 'Count', 'Code'], rows: [['Alpha, Beta', 4, '001'], ['A "quote"\ninside', 2, null]],
  });
  assert.throws(() => parseCanvasCsv('Header\n"unclosed'), /unclosed/);
});

test('XLSX analysis reads cells without calculating formulas', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['Name', 'Count']);
  sheet.addRow(['A', 2]);
  sheet.addRow(['B', { formula: 'B2*2', result: 4 }]);
  const data = await workbook.xlsx.writeBuffer();
  const table = await readCanvasAnalysisFile(new File([new Uint8Array(data)], 'sample.xlsx'));
  assert.deepEqual(table, { columns: ['Name', 'Count'], rows: [['A', 2], ['B', 4]] });
});

test('analysis result caps tables, rejects invalid points and uses an offline worker policy', () => {
  const value = parseCanvasAnalysisResult({
    table: { columns: ['Values'], rows: Array.from({ length: 150 }, () => [2]) },
    chart: { title: 'Data', points: [{ label: 'Good', value: 3 }, { label: 'Invalid', value: Infinity }] },
  });
  assert.equal(value.table?.rows.length, 100);
  assert.deepEqual(value.chart?.points, [{ label: 'Good', value: 3 }]);
  assert.throws(() => parseCanvasAnalysisResult({ html: '<script></script>' }), /Return a table or chart/);
  assert.ok(CANVAS_ANALYSIS_CSP.includes("connect-src 'none'"));
  assert.ok(CANVAS_ANALYSIS_CSP.includes('worker-src blob:'));
  assert.doesNotMatch(CANVAS_ANALYSIS_CSP, /allow-same-origin/);
});
