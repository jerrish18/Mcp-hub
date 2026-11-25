import type { IncomingMessage, ServerResponse } from 'node:http';
import { CANVAS_IFRAME_SANDBOX, CANVAS_PREVIEW_PATH, CANVAS_SCRIPT_ORIGINS } from '../utils/canvasPreview.ts';

export function buildCanvasPreviewCsp(standalone = false): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${CANVAS_SCRIPT_ORIGINS.join(' ')}`,
    "script-src-attr 'unsafe-inline'",
    "style-src 'unsafe-inline' https:",
    'img-src data: blob: https:',
    'media-src data: blob: https:',
    'font-src https: data:',
    'connect-src https:',
    ...(standalone ? ["frame-src 'self'"] : [`sandbox ${CANVAS_IFRAME_SANDBOX}`]),
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self' https: http://localhost:* http://127.0.0.1:*",
  ].join('; ');
}

export function renderCanvasPreviewLoaderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>MCP Hub Canvas Preview</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #ffffff; color: #475569; font-family: system-ui, -apple-system, sans-serif; }
  .boot { display: flex; align-items: center; justify-content: center; min-height: 100vh; font-size: 13px; }
</style>
<script>
(function(){
  var readySent = false;
  function notifyReady() {
    if (readySent) return;
    readySent = true;
    try {
      window.parent.postMessage({ type: 'mcphub-canvas-ready' }, '*');
    } catch (e) {}
  }
  window.addEventListener('message', function receive(ev) {
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (data && data.type === 'mcphub-canvas-render' && typeof data.html === 'string') {
      window.removeEventListener('message', receive);
      try {
        document.open();
        document.write(data.html);
        document.close();
      } catch (error) {
        window.parent.postMessage({ source: 'mcphub-canvas-runtime', type: 'failed' }, '*');
      }
    }
  });
  window.addEventListener('DOMContentLoaded', notifyReady, { once: true });
})();
</script>
</head>
<body>
  <div class="boot">Initializing interactive preview...</div>
</body>
</html>`;
}

function renderStandalonePreviewHtml(): string {
  return `<!doctype html>
<html lang="en">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP Hub · Canvas Preview</title>
<style>
  body { margin: 0; background: #f6f7fa; font: 15px system-ui, sans-serif; }
  iframe { display: block; width: 100%; height: 100dvh; border: 0; background: white; }
  p { margin: 0; padding: 16px; color: #18253c; }
</style>
<p id="status" role="status">Opening Canvas preview…</p>
<script>
(function(){
  var status = document.getElementById('status');
  var id = location.hash.slice(1);
  if (!/^[0-9a-f]{36}$/.test(id) || !('BroadcastChannel' in window)) {
    status.textContent = 'This preview link has expired. Open a new preview from Canvas.';
    return;
  }
  history.replaceState(null, '', location.pathname + location.search);
  var channel = new BroadcastChannel('mcphub-preview:' + id);
  var iframe = document.createElement('iframe');
  iframe.title = 'Canvas website preview';
  iframe.setAttribute('sandbox', '${CANVAS_IFRAME_SANDBOX}');
  var html;
  var ready = false;
  var sent = false;
  var runtimeError = false;
  var timer = setTimeout(fail, 25000);
  function fail() {
    clearTimeout(timer);
    channel.close();
    if (sent) iframe.title = 'Canvas preview with loading errors';
    status.hidden = false;
    status.setAttribute('role', 'alert');
    status.textContent = 'Preview could not finish loading. Return to Canvas to inspect the source or download the project.';
  }
  function render() {
    if (!ready || html === undefined || sent) return;
    sent = true;
    iframe.contentWindow.postMessage({ type: 'mcphub-canvas-render', html: html }, '*');
    html = undefined;
  }
  channel.onmessage = function(event) {
    if (event.data?.type !== 'render' || typeof event.data.html !== 'string') return;
    html = event.data.html;
    channel.close();
    render();
  };
  window.addEventListener('message', function(event) {
    if (event.source !== iframe.contentWindow || event.origin !== 'null') return;
    if (event.data?.type === 'mcphub-canvas-ready') {
      ready = true;
      render();
    } else if (sent && event.data?.source === 'mcphub-canvas-runtime') {
      if (event.data.type === 'loaded') {
        clearTimeout(timer);
        status.hidden = !runtimeError;
      } else if (event.data.type === 'failed') {
        fail();
      } else if (!runtimeError && event.data.blocking && typeof event.data.message === 'string') {
        runtimeError = true;
        status.hidden = false;
        status.setAttribute('role', 'alert');
        status.textContent = event.data.message.slice(0, 1000);
      }
    }
  });
  iframe.src = '${CANVAS_PREVIEW_PATH}';
  document.body.appendChild(iframe);
  channel.postMessage({ type: 'ready' });
})();
</script>
</html>`;
}

export function handleCanvasPreviewRequest(req: IncomingMessage, res: ServerResponse): void {
  const standalone = new URL(req.url ?? '/', 'http://localhost').searchParams.get('standalone') === '1';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', buildCanvasPreviewCsp(standalone));
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.statusCode = 200;
  res.end(standalone ? renderStandalonePreviewHtml() : renderCanvasPreviewLoaderHtml());
}
