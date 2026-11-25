import { CANVAS_RUNTIME_BRIDGE } from './appArtifact';
export interface ColumnSummary {
  name: string;
  kind: 'number' | 'string';
  nonEmptyCount: number;
  nullCount: number;
  min?: number;
  max?: number;
  sum?: number;
  mean?: number;
}

export interface DatasetArtifactSpec {
  title: string;
  fileName: string;
  columns: string[];
  rows: string[][];
  summaries: ColumnSummary[];
}

export function parseCsvLine(line: string, delimiter = ','): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function detectDelimiter(sample: string, fileName = ''): string {
  if (fileName.toLowerCase().endsWith('.tsv')) return '\t';
  const firstLine = sample.split(/\r?\n/)[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semis) return '\t';
  if (semis > commas && semis > tabs) return ';';
  return ',';
}

export function computeColumnSummaries(
  columns: string[],
  rows: string[][]
): ColumnSummary[] {
  return columns.map((name, colIdx) => {
    const values = rows.map((r) => (r[colIdx] ?? '').trim());
    const nonEmpty = values.filter((v) => v.length > 0);
    const nullCount = values.length - nonEmpty.length;
    const nums = nonEmpty
      .map((v) => Number(v.replace(/[$,%]/g, '').replace(/,/g, '')))
      .filter((n) => Number.isFinite(n));

    if (nonEmpty.length > 0 && nums.length === nonEmpty.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      return {
        name,
        kind: 'number',
        nonEmptyCount: nonEmpty.length,
        nullCount,
        min: Math.min(...nums),
        max: Math.max(...nums),
        sum: Number(sum.toFixed(2)),
        mean: Number((sum / nums.length).toFixed(2)),
      };
    }

    return {
      name,
      kind: 'string',
      nonEmptyCount: nonEmpty.length,
      nullCount,
    };
  });
}

export function parseDelimitedDataset(
  rawText: string,
  fileName: string,
  maxRows = 500
): DatasetArtifactSpec | null {
  const clean = rawText.replace(/^\uFEFF/, '').trim();
  if (!clean) return null;

  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const delimiter = detectDelimiter(clean, fileName);
  const headers = parseCsvLine(lines[0], delimiter).map((h, i) => h || `Column ${i + 1}`);
  if (headers.length === 0) return null;

  const rows: string[][] = [];
  for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
    const parsed = parseCsvLine(lines[i], delimiter);
    const normalized = headers.map((_, ci) => parsed[ci] ?? '');
    rows.push(normalized);
  }

  return {
    title: `${fileName} Data Explorer`,
    fileName,
    columns: headers,
    rows,
    summaries: computeColumnSummaries(headers, rows),
  };
}

export function filterAndSortDatasetRows(params: {
  columns: string[];
  rows: string[][];
  query: string;
  sortColIdx: number | null;
  sortAsc: boolean;
}): string[][] {
  const q = params.query.trim().toLowerCase();
  let filtered = q
    ? params.rows.filter((row) => row.some((c) => c.toLowerCase().includes(q)))
    : [...params.rows];

  if (
    params.sortColIdx !== null &&
    params.sortColIdx >= 0 &&
    params.sortColIdx < params.columns.length
  ) {
    const idx = params.sortColIdx;
    const dir = params.sortAsc ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      const av = a[idx] ?? '';
      const bv = b[idx] ?? '';
      const an = Number(av.replace(/[$,%]/g, '').replace(/,/g, ''));
      const bn = Number(bv.replace(/[$,%]/g, '').replace(/,/g, ''));
      if (av !== '' && bv !== '' && Number.isFinite(an) && Number.isFinite(bn)) {
        return (an - bn) * dir;
      }
      return av.localeCompare(bv) * dir;
    });
  }
  return filtered;
}

export function buildDatasetSandboxPreviewHtml(params: {
  spec: DatasetArtifactSpec;
  labelColIdx: number;
  valueColIdx: number;
  customExpression?: string;
}): string {
  const { spec, labelColIdx, valueColIdx, customExpression } = params;
  const safeRows = spec.rows.slice(0, 60).map((row) => ({
    label: String(row[labelColIdx] ?? ''),
    value: Number(String(row[valueColIdx] ?? '0').replace(/[$,%]/g, '').replace(/,/g, '')) || 0,
    raw: Object.fromEntries(spec.columns.map((c, ci) => [c, row[ci] ?? ''])),
  }));
  const labelName = spec.columns[labelColIdx] ?? 'Row';
  const valueName = spec.columns[valueColIdx] ?? 'Value';
  const payloadJson = JSON.stringify({
    title: spec.title,
    labelName,
    valueName,
    rows: safeRows,
    transform: customExpression?.trim() || '',
  }).replace(/<\/script>/gi, '<\\/script>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${spec.title.replace(/</g, '&lt;')}</title>
${CANVAS_RUNTIME_BRIDGE}
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: #0f172a; color: #e2e8f0; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 14px; margin-bottom: 12px; }
  h2 { margin: 0 0 8px; font-size: 14px; color: #f8fafc; }
  .bars { display: flex; flex-direction: column; gap: 6px; }
  .bar-row { display: grid; grid-template-columns: 120px 1fr 70px; align-items: center; gap: 8px; font-size: 12px; }
  .track { background: #0f172a; border-radius: 999px; height: 10px; overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #38bdf8, #3b82f6); }
  .muted { color: #94a3b8; font-size: 11px; }
  pre { margin: 6px 0 0; padding: 10px; background: #0f172a; border-radius: 10px; font-size: 11px; overflow: auto; }
</style>
</head>
<body>
  <div class="card">
    <h2 id="chart-title">Sandboxed Chart</h2>
    <div id="chart-bars" class="bars"></div>
  </div>
  <div id="transform-card" class="card" style="display:none;">
    <h2>JS Transform Output</h2>
    <pre id="transform-out"></pre>
  </div>
<script>
(function(){
  var data = ${payloadJson};
  document.getElementById('chart-title').textContent = data.valueName + ' by ' + data.labelName;
  var rows = data.rows.slice(0, 20);
  var maxVal = Math.max(1, Math.max.apply(null, rows.map(function(r){ return Math.abs(r.value) || 0; })));
  var barsEl = document.getElementById('chart-bars');
  rows.forEach(function(r) {
    var rowEl = document.createElement('div');
    rowEl.className = 'bar-row';
    var lbl = document.createElement('span');
    lbl.textContent = r.label || '-';
    lbl.style.overflow = 'hidden';
    lbl.style.textOverflow = 'ellipsis';
    lbl.style.whiteSpace = 'nowrap';
    var track = document.createElement('div');
    track.className = 'track';
    var fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = Math.max(3, Math.round((Math.abs(r.value) / maxVal) * 100)) + '%';
    track.appendChild(fill);
    var num = document.createElement('span');
    num.textContent = String(r.value);
    num.style.textAlign = 'right';
    rowEl.appendChild(lbl);
    rowEl.appendChild(track);
    rowEl.appendChild(num);
    barsEl.appendChild(rowEl);
  });

  if (data.transform) {
    document.getElementById('transform-card').style.display = 'block';
    try {
      var rawRows = data.rows.map(function(r){ return r.raw; });
      var fn = new Function('rows', '"use strict"; return (' + data.transform + ');');
      var res = fn(rawRows);
      document.getElementById('transform-out').textContent = JSON.stringify(res, null, 2);
    } catch (err) {
      document.getElementById('transform-out').textContent = 'Transform error: ' + (err && err.message ? err.message : String(err));
    }
  }
})();
</script>
</body>
</html>`;
}
