import { CANVAS_IFRAME_SANDBOX, CANVAS_SCRIPT_ORIGINS } from '../utils/canvasPreview.ts';

export function buildCanvasPreviewCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' " + CANVAS_SCRIPT_ORIGINS.join(' '),
    "script-src-attr 'unsafe-inline'",
    "style-src 'unsafe-inline' https:",
    'img-src data: blob: https:',
    'media-src data: blob: https:',
    'font-src https: data:',
    'connect-src https:',
    "form-action 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

export function buildCanvasPreviewPage(standalone = false): string {
  const loader = standalone
    ? `if (window !== window.top) return;
  window.addEventListener('load', () => {
    try {
      const html = decodeURIComponent(location.hash.slice(1));
      history.replaceState(null, '', location.pathname + location.search);
      if (html) render(html);
    } catch {
      document.body.textContent = 'Preview blocked or failed to load. Try Download HTML in Canvas.';
    }
  }, { once: true });`
    : `if (window.parent === window) return;
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'mcphub-canvas-render' ||
        typeof event.data.html !== 'string') return;
    render(event.data.html);
  });
  window.addEventListener('load', () => {
    window.parent.postMessage({ type: 'mcphub-canvas-ready' }, '*');
  }, { once: true });`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Canvas preview</title>
<script>
(() => {
  function render(html) {
    document.open();
    document.write(html);
    document.close();
  }
  ${loader}
})();
</script></head><body></body></html>`;
}

export function standaloneCanvasPreviewCsp(): string {
  return `${buildCanvasPreviewCsp()}; sandbox ${CANVAS_IFRAME_SANDBOX}`;
}
