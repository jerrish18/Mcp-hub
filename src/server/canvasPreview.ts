import type { Request, Response } from 'express';

const ALLOWED_CANVAS_SCRIPT_CDNS = [
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://cdnjs.cloudflare.com',
  'https://cdn.tailwindcss.com',
  'https://esm.sh',
] as const;

export function buildCanvasPreviewCsp(): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${ALLOWED_CANVAS_SCRIPT_CDNS.join(' ')}`,
    "script-src-attr 'unsafe-inline'",
    "style-src 'unsafe-inline' https:",
    'img-src data: blob: https:',
    'media-src data: blob: https:',
    'font-src https: data:',
    'connect-src https:',
    "form-action 'none'",
    "base-uri 'self'",
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
  window.addEventListener('message', function(ev) {
    if (ev.source !== window.parent) return;
    var data = ev.data;
    if (data && data.type === 'mcphub-canvas-render' && typeof data.html === 'string') {
      document.open();
      document.write(data.html);
      document.close();
    }
  });
  window.addEventListener('load', notifyReady);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(notifyReady, 0);
  }
})();
</script>
</head>
<body>
  <div class="boot">Initializing interactive preview...</div>
</body>
</html>`;
}

export function handleCanvasPreviewRequest(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', buildCanvasPreviewCsp());
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(renderCanvasPreviewLoaderHtml());
}
