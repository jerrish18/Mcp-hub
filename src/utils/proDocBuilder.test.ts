import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentFaithfulDocumentSpec,
  buildContentFaithfulPptxSpec,
  buildContentFaithfulXlsxSpec,
  extractPromptDocumentIntent,
} from './proDocBuilder';

test('extractPromptDocumentIntent extracts explicit title, subtopics, bullets, and uploaded attachment text', () => {
  const intent = extractPromptDocumentIntent(
    `Generate a detailed PDF titled "Solar Energy Report 2026" about solar energy covering photovoltaic cells, grid storage, and efficiency comparison table\n- Focus on LFP 4-hour dispatch\n- Include TOPCon module benchmarks`,
    [
      {
        id: 'att_1',
        name: 'solar-notes.txt',
        kind: 'file',
        mimeType: 'text/plain',
        size: 64,
        textContent: 'Site irradiance averages 5.6 kWh/m2/day with 120 MWh BESS reserve.',
      },
    ]
  );

  assert.equal(intent.explicitTitle, 'Solar Energy Report 2026');
  assert.equal(intent.topic, 'solar energy');
  assert.deepEqual(intent.subtopics, ['photovoltaic cells', 'grid storage', 'efficiency comparison table']);
  assert.equal(intent.bulletLines.length, 2);
  assert.ok(intent.attachmentExcerpt?.includes('5.6 kWh/m2/day'));
});

test('buildContentFaithfulDocumentSpec produces topic-faithful sections, metrics, and comparison table for solar energy and giraffe', () => {
  const solarPdf = buildContentFaithfulDocumentSpec({
    format: 'pdf',
    userText: 'Generate a detailed PDF about solar energy covering photovoltaic cells, grid storage, and efficiency comparison table',
  });

  assert.equal(solarPdf.format, 'pdf');
  assert.match(solarPdf.title, /solar energy/i);
  assert.ok(solarPdf.metrics && solarPdf.metrics.length >= 2);
  const headings = solarPdf.sections.map((s) => s.heading.toLowerCase());
  assert.ok(headings.some((h) => h.includes('photovoltaic')));
  assert.ok(headings.some((h) => h.includes('grid storage')));
  const tableSection = solarPdf.sections.find((s) => s.table);
  assert.ok(tableSection?.table?.rows.some((r) => r.join(' ').toLowerCase().includes('topcon')));

  const giraffeDoc = buildContentFaithfulDocumentSpec({
    format: 'pdf',
    userText: 'Generate me a pdf about giraffe',
  });
  assert.equal(giraffeDoc.title, 'Giraffe Briefing');
  assert.ok(giraffeDoc.sections.some((s) => (s.paragraphs ?? []).join(' ').includes('Giraffa camelopardalis')));
});

test('buildContentFaithfulPptxSpec and buildContentFaithfulXlsxSpec adapt to prompt topics', () => {
  const pptx = buildContentFaithfulPptxSpec(
    'Create a PowerPoint presentation about solar energy covering photovoltaic cells and grid storage'
  );
  assert.equal(pptx.format, 'pptx');
  assert.ok(pptx.title.toLowerCase().includes('solar energy'));
  assert.ok(pptx.slides.some((s) => s.layout === 'table'));

  const xlsx = buildContentFaithfulXlsxSpec(
    'Generate an Excel workbook comparing solar photovoltaic cells and grid storage'
  );
  assert.equal(xlsx.format, 'xlsx');
  assert.equal(xlsx.sheets.length, 2);
  assert.ok(xlsx.sheets[0].rows.some((r) => r.join(' ').toLowerCase().includes('perc')));
});
