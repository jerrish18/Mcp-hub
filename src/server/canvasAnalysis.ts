export const CANVAS_ANALYSIS_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", 'worker-src blob:',
  "connect-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ');

export const CANVAS_ANALYSIS_PAGE = `<!doctype html><meta charset="utf-8"><title>Canvas data sandbox</title>
<script>
(() => {
  if (window.parent === window) return;
  let worker;
  let timer;
  function stop() {
    if (worker) worker.terminate();
    worker = undefined;
    clearTimeout(timer);
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !event.data) return;
    if (event.data.type === 'mcphub-analysis-cancel') { stop(); return; }
    const { type, id, code, data } = event.data;
    if (type !== 'mcphub-analysis-run' || typeof code !== 'string' || code.length > 24000 || !data) return;
    stop();
    const send = (value, error) => {
      stop();
      window.parent.postMessage({ type: 'mcphub-analysis-result', id, value, error }, '*');
    };
    const source = [
      'self.onmessage = async ({ data: { columns, rows } }) => {',
      '  try {',
      '    const result = await (async (columns, rows) => {',
      code,
      '    })(columns, rows);',
      '    const json = JSON.stringify(result);',
      '    if (!json || json.length > 250000) throw new Error("Return a table or chart under 250 KB.");',
      '    self.postMessage({ json });',
      '  } catch (error) { self.postMessage({ error: String(error.message).slice(0, 400) }); }',
      '};'
    ].join('\\n');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      worker = new Worker(url);
      worker.onmessage = ({ data }) => {
        try {
          if (data.error) send(null, String(data.error).slice(0, 400));
          else if (typeof data.json === 'string' && data.json.length <= 250000) send(JSON.parse(data.json));
          else send(null, 'Invalid analysis result.');
        } catch { send(null, 'Invalid analysis result.'); }
      };
      worker.onerror = event => send(null, String(event.message || 'Invalid JavaScript.').slice(0, 400));
      timer = setTimeout(() => send(null, 'The analysis exceeded the time limit.'), 4000);
      worker.postMessage(data);
    } catch {
      send(null, 'The analysis worker could not start.');
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  window.parent.postMessage({ type: 'mcphub-analysis-ready' }, '*');
})();
</script>`;
