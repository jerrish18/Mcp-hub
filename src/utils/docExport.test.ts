import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocxBlob,
  buildPdfBlob,
  buildPptxBlob,
  buildXlsxBlob,
  markdownToDocSpec,
  parseArtifactBlock,
  sanitizeFilename,
} from './docExport';
import { parseMcpServersJsonConfig } from '../config/connectors';

async function readBlobHeaderHex(blob: Blob, bytes = 4): Promise<string> {
  const buf = new Uint8Array(await blob.slice(0, bytes).arrayBuffer());
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

test('parseArtifactBlock parses artifact-pptx, artifact-xlsx, artifact-docx, artifact-pdf and rejects invalid JSON', () => {
  const pptx = parseArtifactBlock(
    'artifact-pptx',
    JSON.stringify({
      title: 'Q3 Roadmap',
      themeColor: '#0B57D0',
      slides: [
        { layout: 'title', title: 'Q3 Roadmap', subtitle: 'Engineering' },
        {
          layout: 'metrics',
          title: 'Key KPIs',
          metrics: [{ label: 'ARR', value: '$4.2M', note: '+22% QoQ' }],
          speakerNotes: 'Highlight margin expansion.',
        },
      ],
    })
  );
  assert.ok(pptx && pptx.format === 'pptx');
  assert.equal(pptx.slides.length, 2);
  assert.equal(pptx.slides[1].metrics?.[0]?.value, '$4.2M');
  assert.equal(pptx.themeColor, '0B57D0');

  const xlsx = parseArtifactBlock(
    'artifact-xlsx',
    JSON.stringify({
      title: 'SaaS Model',
      sheets: [
        {
          name: 'Revenue Forecast With Extra Long Name That Should Truncate',
          headers: ['Quarter', 'ARR'],
          rows: [['Q1', 100000]],
        },
      ],
    })
  );
  assert.ok(xlsx && xlsx.format === 'xlsx');
  assert.equal(xlsx.sheets[0].name.length, 31);
  assert.equal(xlsx.sheets[0].rows[0][1], 100000);

  const docx = parseArtifactBlock(
    'doc-docx',
    JSON.stringify({
      title: 'Architecture Memo',
      sections: [{ heading: 'Overview', paragraphs: ['Edge routing reduces p99 latency.'] }],
    })
  );
  assert.ok(docx && docx.format === 'docx');
  assert.equal(docx.sections[0].heading, 'Overview');

  const pdf = parseArtifactBlock(
    'artifact-pdf',
    JSON.stringify({
      title: 'Security Audit',
      sections: [{ heading: 'Findings', bullets: ['Zero critical vulnerabilities'] }],
    })
  );
  assert.ok(pdf && pdf.format === 'pdf');
  assert.equal(pdf.sections[0].bullets?.[0], 'Zero critical vulnerabilities');

  assert.equal(parseArtifactBlock('artifact-pptx', '{not-valid-json'), null);
  assert.equal(parseArtifactBlock('typescript', '{"title":"Ignored"}'), null);
});

test('markdownToDocSpec converts Markdown headings, bullets, and tables into structured specs', () => {
  const md = [
    '# Quarterly Review',
    '',
    '## Adoption Metrics',
    '> Enterprise retention reached 98%.',
    '',
    '| Region | Users | Growth |',
    '|---|---:|---:|',
    '| NA | 12000 | +18% |',
    '| EU | 8400 | +24% |',
    '',
    '- Expand EMEA partner channel',
    '- Ship SSO audit log export',
  ].join('\n');

  const pptxSpec = markdownToDocSpec(md, 'Fallback', 'pptx');
  assert.equal(pptxSpec.format, 'pptx');
  if (pptxSpec.format === 'pptx') {
    assert.equal(pptxSpec.title, 'Quarterly Review');
    assert.ok(pptxSpec.slides.some((s) => s.layout === 'table' && s.table?.rows.length === 2));
    assert.ok(pptxSpec.slides.some((s) => s.layout === 'bullets' && s.bullets?.length === 2));
  }

  const xlsxSpec = markdownToDocSpec(md, 'Fallback', 'xlsx');
  assert.equal(xlsxSpec.format, 'xlsx');
  if (xlsxSpec.format === 'xlsx') {
    assert.equal(xlsxSpec.sheets.length, 1);
    assert.deepEqual(xlsxSpec.sheets[0].headers, ['Region', 'Users', 'Growth']);
    assert.equal(xlsxSpec.sheets[0].rows.length, 2);
  }

  const pdfSpec = markdownToDocSpec(md, 'Fallback', 'pdf');
  assert.equal(pdfSpec.format, 'pdf');
  if (pdfSpec.format === 'pdf') {
    assert.equal(pdfSpec.sections.length, 1);
    assert.equal(pdfSpec.sections[0].callout, 'Enterprise retention reached 98%.');
  }
});

test('binary document builders produce genuine PPTX, DOCX, XLSX, and PDF file signatures', async () => {
  const pptxSpec = parseArtifactBlock(
    'artifact-pptx',
    JSON.stringify({
      title: 'Test Deck',
      slides: [
        { layout: 'title', title: 'Test Deck', subtitle: 'Subtitle' },
        { layout: 'bullets', title: 'Agenda', bullets: ['First point', 'Second point'], speakerNotes: 'Notes' },
        {
          layout: 'two_col',
          title: 'Compare',
          leftTitle: 'Before',
          leftBullets: ['Manual'],
          rightTitle: 'After',
          rightBullets: ['Automated'],
        },
        {
          layout: 'table',
          title: 'Numbers',
          table: { headers: ['Metric', 'Score'], rows: [['NPS', '72']] },
        },
      ],
    })
  );
  assert.ok(pptxSpec && pptxSpec.format === 'pptx');
  const pptxBlob = await buildPptxBlob(pptxSpec);
  assert.ok(pptxBlob.size > 5000);
  // OOXML packages are ZIP archives starting with PK\x03\x04 (504b0304)
  assert.equal(await readBlobHeaderHex(pptxBlob, 4), '504b0304');

  const docxSpec = parseArtifactBlock(
    'artifact-docx',
    JSON.stringify({
      title: 'Engineering Spec',
      subtitle: 'Draft v1',
      sections: [
        {
          heading: 'Summary',
          callout: 'All services remain zero-trust.',
          paragraphs: ['Encrypted tokens stay local.'],
          bullets: ['PKCE enabled'],
          table: { headers: ['Component', 'Owner'], rows: [['Auth', 'Platform']] },
        },
      ],
    })
  );
  assert.ok(docxSpec && docxSpec.format === 'docx');
  const docxBlob = await buildDocxBlob(docxSpec);
  assert.ok(docxBlob.size > 3000);
  assert.equal(await readBlobHeaderHex(docxBlob, 4), '504b0304');

  const xlsxSpec = parseArtifactBlock(
    'artifact-xlsx',
    JSON.stringify({
      title: 'Workbook',
      sheets: [{ name: 'Model', headers: ['Month', 'MRR'], rows: [['Jan', 15000], ['Feb', 18500]] }],
    })
  );
  assert.ok(xlsxSpec && xlsxSpec.format === 'xlsx');
  const xlsxBlob = await buildXlsxBlob(xlsxSpec);
  assert.ok(xlsxBlob.size > 2000);
  assert.equal(await readBlobHeaderHex(xlsxBlob, 4), '504b0304');

  const pdfSpec = parseArtifactBlock(
    'artifact-pdf',
    JSON.stringify({
      title: 'Executive Report',
      subtitle: 'Q4 Summary',
      author: 'MCP Hub Pro Studio',
      dateLabel: '2026-11-23',
      themeColor: '0B57D0',
      metrics: [{ label: 'Revenue Growth', value: '+28%', note: 'YoY' }],
      sections: [
        {
          heading: 'KPIs',
          callout: 'Target exceeded by **14%** across priority accounts.',
          paragraphs: ['Revenue grew across **every region** in Q4.'],
          bullets: ['**North America:** +18% net new ARR'],
          table: { headers: ['KPI', 'Actual'], rows: [['Margin', '64%']] },
        },
      ],
    })
  );
  assert.ok(pdfSpec && pdfSpec.format === 'pdf');
  const pdfBlob = buildPdfBlob(pdfSpec);
  assert.ok(pdfBlob.size > 1200);
  const pdfHeader = await pdfBlob.slice(0, 5).text();
  assert.equal(pdfHeader, '%PDF-');

  assert.equal(sanitizeFilename('Q3 Board Deck!!', 'pptx'), 'q3-board-deck.pptx');
});

test('parseMcpServersJsonConfig imports Claude/Cursor mcpServers JSON and reports stdio/invalid errors', () => {
  const validJson = JSON.stringify({
    mcpServers: {
      Notion: {
        url: 'https://mcp.notion.com/mcp',
        headers: {
          Authorization: 'Bearer ntn_secret_token_123',
          'X-Workspace': 'eng',
        },
      },
      LocalStdio: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      },
    },
  });

  const result = parseMcpServersJsonConfig(validJson);
  assert.equal(result.configs.length, 1);
  assert.equal(result.configs[0].name, 'Notion');
  assert.equal(result.configs[0].url, 'https://mcp.notion.com/mcp');
  assert.equal(result.configs[0].authType, 'bearer');
  assert.equal(result.secretsById[result.configs[0].id].bearerToken, 'ntn_secret_token_123');
  assert.equal(result.secretsById[result.configs[0].id].customHeaders?.['X-Workspace'], 'eng');
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].includes('LocalStdio'));

  const badJson = parseMcpServersJsonConfig('{bad');
  assert.equal(badJson.configs.length, 0);
  assert.equal(badJson.errors[0], 'Invalid JSON syntax.');
});
