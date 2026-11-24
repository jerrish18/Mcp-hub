import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import {
  appendCanvasRevision, canvasArtifactId, canvasDiff, canvasProjectFiles, canvasProjectZip,
  canvasSelectionRequest, mergeCanvasHistories, type CanvasArtifact, type CanvasHistory,
} from './canvasArtifacts';

const base: CanvasArtifact = {
  id: canvasArtifactId('conv', 'message', 1), kind: 'code', title: 'Test App', language: 'html', code: 'first\nold\nlast\n',
};
const changed = { ...base, code: 'first\nnew\nlast\n' };

test('Canvas lineage survives reopen, AI edits, restore, and concurrent saves', () => {
  let history: CanvasHistory = { artifactId: base.id, revisions: [] };
  history = appendCanvasRevision(history, base, 'Original', 'origin', 'initial', 1);
  const original = history;
  history = appendCanvasRevision(history, changed, 'AI revision', 'reply', 'edited', 2);
  assert.equal(appendCanvasRevision(history, base, 'Original', 'origin'), history);
  assert.equal(appendCanvasRevision(history, changed, 'AI revision', 'reply'), history);
  const restored = appendCanvasRevision(history, base, 'Restored version', undefined, 'restored', 4);
  assert.equal(restored.revisions.at(-1)?.artifact, base);
  const otherTab = appendCanvasRevision(original, { ...base, code: 'parallel' }, 'Local edit', undefined, 'parallel', 3);
  assert.deepEqual(mergeCanvasHistories(restored, otherTab).revisions.map((entry) => entry.id), ['initial', 'edited', 'parallel', 'restored']);
  assert.notEqual(canvasArtifactId('conv', 'message', 0), base.id);
});

test('Canvas shows changed lines and exports the original UTF-8 project files', () => {
  const [diff] = canvasDiff(base, changed);
  assert.equal(diff.path, 'index.html');
  assert.deepEqual(diff.parts?.filter((part) => part.added || part.removed).map((part) => part.value), ['old\n', 'new\n']);
  const files = [...canvasProjectFiles(base), { path: 'assets/notes.txt', content: 'Résumé 🌿\r\n', language: 'txt' }];
  const zip = unzipSync(canvasProjectZip(files));
  for (const file of files) assert.equal(strFromU8(zip[file.path]), file.content);
  assert.throws(() => canvasProjectZip([{ ...files[0], path: '../index.html' }]), /Invalid project file path/);
  assert.throws(() => canvasProjectZip([...files, files[0]]), /Duplicate project file path/);
});

test('selection request includes the exact selected text and asks for a full replacement artifact', () => {
  const prompt = canvasSelectionRequest(base, 'index.html', 'old\n"quoted"', 'Change just the label');
  assert.match(prompt, /complete updated artifact in a fenced html block/);
  assert.match(prompt, /index.html/);
  assert.ok(prompt.includes(JSON.stringify('old\n"quoted"')));
  assert.ok(prompt.endsWith(base.code));
});
