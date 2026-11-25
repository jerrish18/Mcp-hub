import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {
  buildCanvasPreviewCsp,
  handleCanvasPreviewRequest,
  renderCanvasPreviewLoaderHtml,
} from './canvasPreview';

test('buildCanvasPreviewCsp includes unsafe-inline, frame-ancestors self, and allowed CDNs', () => {
  const csp = buildCanvasPreviewCsp();
  const sandbox = csp.split('; ').find((part) => part.startsWith('sandbox '));
  assert.ok(sandbox?.includes('allow-scripts'));
  assert.ok(sandbox);
  assert.ok(!sandbox.includes('allow-same-origin'));
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("'unsafe-inline'"));
  assert.ok(csp.includes("'unsafe-eval'"));
  assert.ok(csp.includes("script-src-attr 'unsafe-inline'"));
  assert.ok(csp.includes("frame-ancestors 'self'"));
  assert.ok(csp.includes('https:'));
  assert.ok(csp.includes('https://cdn.jsdelivr.net'));
  assert.ok(csp.includes('https://cdn.tailwindcss.com'));
  assert.ok(csp.includes('https://esm.sh'));
});

test('handleCanvasPreviewRequest serves loader HTML with isolated CSP, Referrer-Policy, and nosniff headers', async () => {
  const app = express();
  app.get('/__canvas-preview', handleCanvasPreviewRequest);

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as { port: number };

  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/__canvas-preview`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-security-policy'), buildCanvasPreviewCsp());
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const html = await res.text();
    assert.ok(html.includes('mcphub-canvas-ready'));
    assert.ok(html.includes('mcphub-canvas-render'));
    assert.equal(html, renderCanvasPreviewLoaderHtml());

    const standalone = await fetch(`http://127.0.0.1:${addr.port}/__canvas-preview?standalone=1`);
    assert.equal(standalone.headers.get('content-security-policy'), buildCanvasPreviewCsp(true));
    assert.match(await standalone.text(), /BroadcastChannel/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
