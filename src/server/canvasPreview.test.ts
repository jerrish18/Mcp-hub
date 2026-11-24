import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanvasPreviewCsp, buildCanvasPreviewPage, standaloneCanvasPreviewCsp } from './canvasPreview';
import { CANVAS_IFRAME_SANDBOX, CANVAS_SCRIPT_ORIGINS, canvasPushBlockReason } from '../utils/canvasPreview';

test('Canvas preview permits inline and approved CDN scripts while retaining iframe isolation', () => {
  const csp = buildCanvasPreviewCsp();
  assert.match(csp, /script-src 'unsafe-inline' 'unsafe-eval'/);
  assert.match(csp, /script-src-attr 'unsafe-inline'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /form-action 'none'/);
  for (const origin of CANVAS_SCRIPT_ORIGINS) assert.ok(csp.includes(origin));
  assert.equal(CANVAS_IFRAME_SANDBOX, 'allow-scripts allow-forms allow-modals allow-popups allow-downloads');
  assert.doesNotMatch(standaloneCanvasPreviewCsp(), /allow-same-origin/);
  assert.match(buildCanvasPreviewPage(), /event.source !== window.parent/);
  assert.match(buildCanvasPreviewPage(true), /history.replaceState/);
});

test('Canvas requires a successful run and review of the current export before push', () => {
  const valid = { exportIssues: [], requiresPreview: true, status: 'loaded' as const, reviewed: true };
  assert.equal(canvasPushBlockReason(valid), undefined);
  assert.equal(canvasPushBlockReason({ ...valid, exportIssues: ['Missing CSS'] }), 'Missing CSS');
  assert.equal(canvasPushBlockReason({ ...valid, runtimeError: 'Uncaught error' }), 'Uncaught error');
  assert.ok(canvasPushBlockReason({ ...valid, status: 'failed' }));
  assert.ok(canvasPushBlockReason({ ...valid, reviewed: false }));
  assert.equal(canvasPushBlockReason({ ...valid, requiresPreview: false, status: 'loading', reviewed: false }), undefined);
});
