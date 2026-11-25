import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZipArchive, crc32 } from './zipBuilder';
import {
  buildDatasetSandboxPreviewHtml,
  computeColumnSummaries,
  filterAndSortDatasetRows,
  parseDelimitedDataset,
} from './dataAnalysis';
import {
  FREE_TIER_QUOTA_LIMITS,
  getProviderQuotaStatus,
  recordProvider429,
  recordProviderRequest,
  resetQuotaTrackerForTests,
} from './quotaTracker';
import {
  buildApprovalBeforeAfterDiff,
  buildExecutionPlanDraft,
  buildPlanGuidedPrompt,
  computeLineDiff,
  shouldOfferProPlan,
} from './proFeatures';

test('crc32 matches standard IEEE 802.3 test vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
});

test('buildZipArchive generates valid PKZIP headers and central directory', () => {
  const zip = buildZipArchive([
    { path: '/index.html', content: '<h1>Hello</h1>' },
    { path: 'src/app.js', content: 'console.log(1);' },
  ]);
  // Local file header magic PK\x03\x04
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03);
  assert.equal(zip[3], 0x04);
  // End of central directory magic PK\x05\x06 at tail - 22
  const eocdOffset = zip.length - 22;
  assert.equal(zip[eocdOffset], 0x50);
  assert.equal(zip[eocdOffset + 1], 0x4b);
  assert.equal(zip[eocdOffset + 2], 0x05);
  assert.equal(zip[eocdOffset + 3], 0x06);
  // Entry count = 2
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(view.getUint16(eocdOffset + 8, true), 2);
});

test('parseDelimitedDataset parses quoted CSV and computes numeric summaries', () => {
  const csv = [
    'Region,Revenue,Units',
    '"North, US","$1,200",10',
    'Europe,"$800",5',
    'APAC,"$2,000",15',
  ].join('\n');

  const spec = parseDelimitedDataset(csv, 'q3_sales.csv');
  assert.ok(spec);
  assert.deepEqual(spec.columns, ['Region', 'Revenue', 'Units']);
  assert.equal(spec.rows.length, 3);
  assert.equal(spec.rows[0][0], 'North, US');

  const revSummary = spec.summaries[1];
  assert.equal(revSummary.kind, 'number');
  assert.equal(revSummary.min, 800);
  assert.equal(revSummary.max, 2000);
  assert.equal(revSummary.sum, 4000);
});

test('computeColumnSummaries handles string columns and filterAndSortDatasetRows sorts numerically', () => {
  const columns = ['Name', 'Score'];
  const rows = [
    ['Alice', '9'],
    ['Bob', '42'],
    ['Charlie', '100'],
  ];
  const summaries = computeColumnSummaries(columns, rows);
  assert.equal(summaries[0].kind, 'string');
  assert.equal(summaries[1].kind, 'number');

  const sortedDesc = filterAndSortDatasetRows({
    columns,
    rows,
    query: '',
    sortColIdx: 1,
    sortAsc: false,
  });
  assert.deepEqual(sortedDesc.map((r) => r[0]), ['Charlie', 'Bob', 'Alice']);

  const filtered = filterAndSortDatasetRows({
    columns,
    rows,
    query: 'bob',
    sortColIdx: null,
    sortAsc: true,
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0][0], 'Bob');
});

test('buildDatasetSandboxPreviewHtml escapes closing script tags safely', () => {
  const html = buildDatasetSandboxPreviewHtml({
    spec: {
      title: 'Test',
      fileName: 'test.csv',
      columns: ['Label', 'Val'],
      rows: [['</script><img src=x>', '12']],
      summaries: [],
    },
    labelColIdx: 0,
    valueColIdx: 1,
    customExpression: 'rows.slice(0, 1)',
  });
  assert.equal(html.includes('</script><img'), false);
  assert.equal(html.includes('<\\/script>'), true);
});

test('quotaTracker tracks RPM, RPD, near-limit warnings, and 429 alerts', () => {
  resetQuotaTrackerForTests();
  const baseNow = 1_750_000_000_000;
  for (let i = 0; i < Math.floor(FREE_TIER_QUOTA_LIMITS.gemini.rpmLimit * 0.8); i++) {
    recordProviderRequest('gemini', baseNow + i * 100);
  }
  const near = getProviderQuotaStatus('gemini', baseNow + 2000);
  assert.ok(near);
  assert.equal(near.nearLimit, true);
  assert.ok(near.warningText);

  recordProvider429('groq', baseNow + 3000);
  const limited = getProviderQuotaStatus('groq', baseNow + 5000);
  assert.ok(limited);
  assert.equal(limited.rateLimitedRecently, true);
  assert.match(limited.warningText ?? '', /429/);
});

test('proFeatures computes line diffs, approval diffs, and Pro plan drafts', () => {
  const diff = computeLineDiff('a\nb\nc', 'a\nd\nc');
  assert.ok(diff.some((l) => l.kind === 'removed' && l.text === 'b'));
  assert.ok(diff.some((l) => l.kind === 'added' && l.text === 'd'));

  const batchDiff = buildApprovalBeforeAfterDiff('github_push_files_batch', {
    files: [{ path: 'index.html', content: '<h1>Hi</h1>' }],
  });
  assert.equal(batchDiff.length, 1);
  assert.equal(batchDiff[0].field, 'file:index.html');

  assert.equal(
    shouldOfferProPlan('Build a multi-file dashboard and push it to GitHub', 'professional'),
    true
  );
  assert.equal(shouldOfferProPlan('Hello', 'professional'), false);
  assert.equal(shouldOfferProPlan('Build a dashboard and push to GitHub', 'general'), false);

  const steps = buildExecutionPlanDraft('Build a dashboard and push to GitHub repo', 4);
  assert.ok(steps.length >= 3);
  const guided = buildPlanGuidedPrompt('Build a dashboard', steps);
  assert.match(guided, /\[APPROVED EXECUTION PLAN/);
});
