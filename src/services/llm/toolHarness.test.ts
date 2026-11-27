import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceToolDefinitions,
  executeToolBatchDeterministically,
  normalizeSafeWorkspacePath,
  validateAndNormalizeToolCall,
  WorkspaceVfs,
} from './toolHarness';

test('normalizeSafeWorkspacePath blocks traversal, OS paths, and sensitive files', () => {
  assert.equal(normalizeSafeWorkspacePath('src/app.ts').ok, true);
  assert.equal(normalizeSafeWorkspacePath('./index.html').path, 'index.html');
  assert.equal(normalizeSafeWorkspacePath('../secrets.txt').ok, false);
  assert.equal(normalizeSafeWorkspacePath('/etc/passwd').ok, false);
  assert.equal(normalizeSafeWorkspacePath('C:\\Users\\key.txt').ok, false);
  assert.equal(normalizeSafeWorkspacePath('.env.local').ok, false);
  assert.equal(normalizeSafeWorkspacePath('certs/prod.pem').ok, false);
  assert.equal(normalizeSafeWorkspacePath('keys/api_secret.json').ok, false);
  assert.equal(normalizeSafeWorkspacePath('.git/config').ok, false);
});

test('validateAndNormalizeToolCall resolves fuzzy tool names, coerces primitives, and rejects invalid args', () => {
  const tools = buildWorkspaceToolDefinitions();

  const fuzzyRead = validateAndNormalizeToolCall(
    {
      id: 'c1',
      name: 'read-file',
      rawArguments: '{"path":"index.html","startLine":"2"}',
      parsedArguments: { path: 'index.html', startLine: '2' },
    },
    tools
  );
  assert.equal(fuzzyRead.ok, true);
  assert.equal(fuzzyRead.resolvedToolName, 'srv_workspace__read_file');
  assert.equal(fuzzyRead.args.startLine, 2);
  assert.equal(fuzzyRead.validationStatus, 'repaired');

  const typoRead = validateAndNormalizeToolCall(
    {
      id: 'c2',
      name: 'raed_file',
      rawArguments: '{"path":"index.html"}',
      parsedArguments: { path: 'index.html' },
    },
    tools
  );
  assert.equal(typoRead.ok, true);
  assert.equal(typoRead.resolvedToolName, 'srv_workspace__read_file');

  const invalidJson = validateAndNormalizeToolCall(
    {
      id: 'c3',
      name: 'srv_workspace__read_file',
      rawArguments: '{"path": ',
      parseError: 'Unexpected end of JSON input',
    },
    tools
  );
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.validationStatus, 'rejected');
  assert.ok(invalidJson.structuredErrorJson?.includes('INVALID_JSON_ARGUMENTS'));

  const missingReq = validateAndNormalizeToolCall(
    {
      id: 'c4',
      name: 'srv_workspace__patch_file',
      rawArguments: '{"path":"app.js"}',
      parsedArguments: { path: 'app.js' },
    },
    tools
  );
  assert.equal(missingReq.ok, false);
  assert.ok(missingReq.structuredErrorJson?.includes('MISSING_REQUIRED_PARAMETERS'));
});

test('WorkspaceVfs enforces Read-Before-Edit, unique anchors with hints, checkpoints, and diff accept/reject', () => {
  const vfs = new WorkspaceVfs();
  vfs.seedFile(
    'app.js',
    'const count = 1;\nconst title = "Demo";\nconst countLabel = "Count";\n'
  );

  // Blocked before read_file
  const blocked = vfs.patchFile('app.js', 'const count = 1;', 'const count = 2;');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'READ_BEFORE_EDIT_REQUIRED');

  // Read file then test 0-match line hints
  const read = vfs.readFile('app.js');
  assert.equal(read.ok, true);

  const noMatch = vfs.patchFile('app.js', 'const count = 999;', 'const count = 2;');
  assert.equal(noMatch.ok, false);
  assert.equal(noMatch.code, 'PATCH_NO_MATCH');
  assert.ok(noMatch.text.includes('nearestLineHints'));

  // Ambiguous >1 match reports line numbers
  const ambiguous = vfs.patchFile('app.js', 'count', 'total');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'PATCH_AMBIGUOUS_MATCH');
  assert.ok(ambiguous.text.includes('matchingLines'));

  // Checkpoint before edit, apply exact unique patch, then revert
  const cp = vfs.createCheckpoint('Before counter update');
  const patched = vfs.patchFile('app.js', 'const count = 1;', 'const count = 2;', 'task_1');
  assert.equal(patched.ok, true);
  assert.equal(vfs.getDiffsSnapshot()['app.js'].status, 'pending');

  assert.equal(vfs.revertCheckpoint(cp.id), true);
  assert.ok(vfs.getFilesSnapshot()['app.js'].content.includes('const count = 1;'));

  // Reject and accept diff flows
  vfs.writeFile('styles.css', 'body { color: #111; }');
  assert.equal(vfs.rejectDiff('styles.css'), true);
  assert.equal(vfs.getFilesSnapshot()['styles.css'], undefined);

  vfs.writeFile('styles.css', 'body { color: #222; }');
  assert.equal(vfs.acceptDiff('styles.css'), true);
  assert.equal(vfs.getDiffsSnapshot()['styles.css'].status, 'accepted');
  assert.equal(vfs.getFilesSnapshot()['styles.css'].status, 'unmodified');
});

test('WorkspaceVfs verifyWorkspace detects HTML asset gaps, JS syntax errors, and balanced CSS', () => {
  const vfs = new WorkspaceVfs();
  vfs.writeFile(
    'index.html',
    '<!DOCTYPE html><html><body><script src="./missing.js"></script></body></html>'
  );
  vfs.writeFile('app.js', 'function broken( { return 1; }');
  vfs.writeFile('styles.css', 'body { margin: 0; ');

  const report = vfs.verifyWorkspace();
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 3);

  vfs.writeFile('index.html', '<!DOCTYPE html><html><body><script src="./app.js"></script></body></html>');
  vfs.writeFile('app.js', 'function ok() { return 1; }');
  vfs.writeFile('styles.css', 'body { margin: 0; }');

  const clean = vfs.verifyWorkspace();
  assert.equal(clean.ok, true);
  assert.equal(clean.errors.length, 0);
});

test('executeToolBatchDeterministically runs reads in parallel and serializes same-key mutations', async () => {
  const events: string[] = [];
  let activeForFileA = 0;
  let maxConcurrentFileA = 0;

  await executeToolBatchDeterministically(
    [
      { item: 'r1', isReadOnly: true },
      { item: 'r2', isReadOnly: true },
      { item: 'w1', isReadOnly: false, mutexKey: 'file:a.ts' },
      { item: 'w2', isReadOnly: false, mutexKey: 'file:a.ts' },
    ],
    async (item) => {
      events.push(`start:${item}`);
      if (item.startsWith('w')) {
        activeForFileA++;
        maxConcurrentFileA = Math.max(maxConcurrentFileA, activeForFileA);
        await new Promise((r) => setTimeout(r, 15));
        activeForFileA--;
      } else {
        await new Promise((r) => setTimeout(r, 10));
      }
      events.push(`end:${item}`);
      return item;
    }
  );

  assert.equal(maxConcurrentFileA, 1);
  assert.ok(events.indexOf('start:r2') < events.indexOf('end:r1'));
});
