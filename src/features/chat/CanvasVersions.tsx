import { useMemo, useState } from 'react';
import { canvasDiff, type CanvasArtifact, type CanvasRevision } from '../../utils/canvasArtifacts';

const BUTTON = 'min-h-[44px] rounded-lg border border-slate-300 px-3 text-xs dark:border-slate-700';

export function CanvasVersions({ artifact, revisions, onSave, onRestore }: {
  artifact: CanvasArtifact;
  revisions: CanvasRevision[];
  onSave: () => void;
  onRestore: (revision: CanvasRevision) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const baseline = revisions.find((revision) => revision.id === selected) ?? revisions.at(-2) ?? revisions.at(-1);
  const diff = useMemo(() => baseline ? canvasDiff(baseline.artifact, artifact) : [], [artifact, baseline]);
  return (
    <div className="shrink-0 max-h-[40vh] overflow-auto border-b border-slate-200 px-3 py-2 dark:border-slate-700"
      aria-label="Canvas version history">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex flex-wrap items-center gap-2 text-xs">
          Compare with
          <select className={BUTTON + ' max-w-64 bg-white dark:bg-slate-900'} value={baseline?.id ?? ''}
            onChange={(event) => setSelected(event.target.value)}>
            {[...revisions].reverse().map((version) => (
              <option key={version.id} value={version.id}>
                {version.label} · {new Date(version.createdAt).toLocaleTimeString()}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={BUTTON} onClick={onSave}>Save version</button>
        {baseline && <button type="button" className={BUTTON} onClick={() => onRestore(baseline)}>Restore version</button>}
      </div>
      {!diff.length && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">No file changes.</p>}
      {diff.map(({ path, parts, status }) => (
        <details key={path} className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700">
          <summary className="min-h-[44px] cursor-pointer p-3 text-xs">{path} · {status}</summary>
          {parts ? <pre className="overflow-auto p-2 text-xs">
            {parts.filter((part) => part.added || part.removed).map((part, index) => (
              <code key={index} className={`block ${part.added ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>
                {part.value.slice(0, 5000).replace(/\n$/, '').split('\n').map((line) => (part.added ? '+ ' : '− ') + line).join('\n')}
                {part.value.length > 5000 ? '\n…' : ''}
              </code>
            ))}
          </pre> : <p className="p-3 text-xs">This file has too many changes for an inline diff.</p>}
        </details>
      ))}
    </div>
  );
}
