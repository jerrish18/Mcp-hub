import { useLayoutEffect, useRef, useState } from 'react';
import {
  CANVAS_ANALYSIS_PATH, parseCanvasAnalysisResult, readCanvasAnalysisFile,
  type AnalysisResult, type AnalysisTable,
} from '../../utils/canvasAnalysis';

const DEFAULT_SCRIPT = `const summaries = columns.map((label, index) => {
  const numbers = rows.map(row => row[index]).filter(value => typeof value === 'number');
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return { label, total, count: numbers.length };
}).filter(item => item.count > 0);

return {
  table: {
    columns: ['Column', 'Numeric values', 'Sum'],
    rows: summaries.length ? summaries.map(item => [item.label, item.count, item.total]) : [['Rows', rows.length, null]]
  },
  chart: { title: 'Column sums', points: summaries.map(item => ({ label: item.label, value: item.total })) }
};`;

const BUTTON = 'min-h-[44px] rounded-lg px-3 text-sm font-semibold';

export function CanvasDataAnalysis({ initialScript }: { initialScript?: string }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const runId = useRef(0);
  const fileId = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<AnalysisTable>();
  const [fileName, setFileName] = useState('');
  const [script, setScript] = useState(initialScript || DEFAULT_SCRIPT);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalysisResult>();
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    const frame = iframe.current;
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      if (event.data?.type === 'mcphub-analysis-ready') {
        setReady(true);
      } else if (event.data?.type === 'mcphub-analysis-result' && event.data.id === runId.current) {
        window.clearTimeout(timer.current);
        setRunning(false);
        try {
          if (typeof event.data.error === 'string') throw new Error(event.data.error);
          setResult(parseCanvasAnalysisResult(event.data.value));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Analysis failed.');
        }
      }
    };
    const initial = window.setTimeout(() => setError((value) => value || 'Analysis sandbox did not start.'), 5000);
    const readyListener = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && event.origin === 'null' && event.data?.type === 'mcphub-analysis-ready') {
        window.clearTimeout(initial);
      }
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('message', readyListener);
    frame.src = CANVAS_ANALYSIS_PATH;
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(timer.current);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('message', readyListener);
    };
  }, []);

  const cancel = () => {
    runId.current++;
    window.clearTimeout(timer.current);
    iframe.current?.contentWindow?.postMessage({ type: 'mcphub-analysis-cancel' }, '*');
    setRunning(false);
  };

  const run = () => {
    if (!ready || !data || !script.trim() || running) return;
    const id = ++runId.current;
    setError('');
    setResult(undefined);
    setRunning(true);
    iframe.current?.contentWindow?.postMessage({ type: 'mcphub-analysis-run', id, code: script, data }, '*');
    timer.current = window.setTimeout(() => {
      cancel();
      setError('Analysis did not return a result.');
    }, 5000);
  };

  const upload = async (file: File) => {
    const id = ++fileId.current;
    cancel();
    setData(undefined);
    setResult(undefined);
    setError('');
    setFileName(file.name);
    try {
      const table = await readCanvasAnalysisFile(file);
      if (fileId.current === id) setData(table);
    } catch (cause) {
      if (fileId.current === id) setError(cause instanceof Error ? cause.message : 'Could not read the dataset.');
    }
  };

  return (
    <section aria-label="Canvas data analysis" className="space-y-3 text-slate-900 dark:text-slate-100">
      <iframe ref={iframe} sandbox="allow-scripts" title="Offline analysis sandbox" hidden />
      <label className="block text-sm font-medium">
        Dataset (CSV or XLSX)
        <input type="file" accept=".csv,.xlsx" className="mt-1 block min-h-[44px] w-full text-sm file:mr-3 file:min-h-[44px]"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
      </label>
      {data?.truncated && <p role="status" className="text-xs">Using the first 2,000 rows and 40 columns.</p>}
      {fileName && <p role="status" className="text-xs">{fileName}{data ? ` · ${data.rows.length} rows · ${data.columns.length} columns` : ''}</p>}
      <label className="block text-sm font-medium">
        Analysis JavaScript
        <textarea value={script} maxLength={24000} spellCheck={false} rows={12}
          onChange={(event) => setScript(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-white dark:border-slate-700" />
      </label>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        Use <code>columns</code> and <code>rows</code>. Return a <code>table</code> or bar <code>chart</code>. Analysis runs offline.
      </p>
      <div className="flex gap-2">
        <button type="button" className={BUTTON + ' bg-blue-700 text-white disabled:opacity-50'} onClick={run} disabled={!ready || !data || !script.trim() || running}>
          {running ? 'Running analysis…' : 'Run analysis'}
        </button>
        {running && <button type="button" className={BUTTON + ' border'} onClick={cancel}>Cancel analysis</button>}
      </div>
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
      {result?.table && (
        <div className="overflow-auto rounded-xl border border-slate-300 dark:border-slate-700">
          <table className="w-full text-left text-xs" aria-label="Analysis results">
            <thead><tr>{result.table.columns.map((column, index) => <th key={index} scope="col" className="p-2">{column}</th>)}</tr></thead>
            <tbody>{result.table.rows.map((row, index) => (
              <tr className="border-t border-slate-200 dark:border-slate-700" key={index}>
                {row.map((value, cellIndex) => <td key={cellIndex} className="p-2">{value === null ? '' : String(value)}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {result?.chart && (
        <figure aria-label={result.chart.title} className="space-y-2 rounded-xl border border-slate-300 p-3 dark:border-slate-700">
          <figcaption className="text-sm font-semibold">{result.chart.title}</figcaption>
          {result.chart.points.map(({ label, value }, index, points) => (
            <div key={index} className="space-y-1 text-xs">
              <div className="flex justify-between gap-2"><span>{label}</span><span>{value.toLocaleString()}</span></div>
              <div className="h-2 rounded bg-slate-200 dark:bg-slate-800" aria-hidden="true">
                <div className={`h-2 rounded ${value < 0 ? 'bg-rose-600' : 'bg-blue-600'}`}
                  style={{ width: `${Math.abs(value) / Math.max(1, ...points.map((point) => Math.abs(point.value))) * 100}%` }} />
              </div>
            </div>
          ))}
        </figure>
      )}
    </section>
  );
}
