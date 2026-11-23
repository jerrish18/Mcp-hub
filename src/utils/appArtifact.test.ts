import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppPreviewSrcDoc,
  buildGitHubSyncPrompt,
  inferFileLanguage,
  parseAppArtifactBlock,
  suggestRepoSlug,
  type AppArtifactSpec,
} from './appArtifact';

test('inferFileLanguage detects common web and backend extensions', () => {
  assert.equal(inferFileLanguage('index.html'), 'html');
  assert.equal(inferFileLanguage('src/styles.css'), 'css');
  assert.equal(inferFileLanguage('src/App.tsx'), 'tsx');
  assert.equal(inferFileLanguage('api/handler.ts'), 'typescript');
  assert.equal(inferFileLanguage('app.js'), 'javascript');
  assert.equal(inferFileLanguage('README.md'), 'markdown');
  assert.equal(inferFileLanguage('unknown.xyz'), 'text');
});

test('parseAppArtifactBlock validates and normalizes multi-file artifact-app specs', () => {
  assert.equal(parseAppArtifactBlock('javascript', '{"title":"Nope"}'), null);
  assert.equal(parseAppArtifactBlock('artifact-app', '{invalid json'), null);

  const raw = JSON.stringify({
    title: 'Orbit Taskboard',
    description: 'Collaborative kanban',
    framework: 'Vanilla ES6',
    entryFile: './index.html',
    files: [
      { path: './index.html', content: '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><script src="./app.js"></script></body></html>' },
      { path: '/styles.css', content: 'body { color: #0f172a; }' },
      { path: 'app.js', content: 'console.log("ready");' },
    ],
  });

  const parsed = parseAppArtifactBlock('artifact-app', raw);
  assert.ok(parsed);
  assert.equal(parsed.title, 'Orbit Taskboard');
  assert.equal(parsed.entryFile, 'index.html');
  assert.equal(parsed.files.length, 3);
  assert.equal(parsed.files[0].language, 'html');
  assert.equal(parsed.files[1].path, 'styles.css');
  assert.equal(parsed.files[1].language, 'css');
  assert.equal(parsed.files[2].language, 'javascript');
});

test('buildAppPreviewSrcDoc inlines local CSS/JS, injects unreferenced files, and attaches runtime bridge', () => {
  const spec: AppArtifactSpec = {
    title: 'Sample App',
    entryFile: 'index.html',
    files: [
      {
        path: 'index.html',
        language: 'html',
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"></head><body><h1>Hi</h1><script src="./app.js"></script></body></html>',
      },
      { path: 'styles.css', language: 'css', content: 'h1 { color: red; }' },
      { path: 'extra.css', language: 'css', content: 'body { margin: 0; }' },
      { path: 'app.js', language: 'javascript', content: 'window.appLoaded = true;' },
      { path: 'helpers.js', language: 'javascript', content: 'window.helperLoaded = true;' },
    ],
  };

  const docWithBridge = buildAppPreviewSrcDoc(spec, { includeRuntimeBridge: true });
  assert.ok(docWithBridge.includes('mcphub-canvas-runtime'));
  assert.ok(docWithBridge.includes('<style data-file="styles.css">\nh1 { color: red; }\n</style>'));
  assert.ok(docWithBridge.includes('<style data-file="extra.css">\nbody { margin: 0; }\n</style>'));
  assert.ok(docWithBridge.includes('<script  data-file="app.js">\nwindow.appLoaded = true;\n</script>'));
  assert.ok(docWithBridge.includes('<script data-file="helpers.js">\nwindow.helperLoaded = true;\n</script>'));

  const exportDoc = buildAppPreviewSrcDoc(spec, { includeRuntimeBridge: false });
  assert.equal(exportDoc.includes('mcphub-canvas-runtime'), false);
});

test('buildAppPreviewSrcDoc synthesizes clean project overview when no HTML entry exists', () => {
  const spec: AppArtifactSpec = {
    title: 'API Service',
    framework: 'TypeScript',
    files: [
      { path: 'src/index.ts', language: 'typescript', content: 'export const ok = true;' },
      { path: 'package.json', language: 'json', content: '{"name":"api"}' },
    ],
  };

  const doc = buildAppPreviewSrcDoc(spec);
  assert.ok(doc.includes('API Service'));
  assert.ok(doc.includes('src/index.ts'));
  assert.ok(doc.includes('package.json'));
});

test('suggestRepoSlug and buildGitHubSyncPrompt generate valid repo slugs and MCP instructions', () => {
  assert.equal(suggestRepoSlug('Sprint Taskboard Pro! (v2)'), 'sprint-taskboard-pro-v2');
  assert.equal(suggestRepoSlug('   '), 'mcp-hub-pro-app');

  const files = [{ path: 'index.html', language: 'html', content: '<h1>App</h1>' }];

  const newRepoPrompt = buildGitHubSyncPrompt({
    title: 'My App',
    description: 'Demo app',
    repoName: 'my-app',
    branch: 'main',
    commitMessage: 'feat: initial commit',
    isNewRepo: true,
    isPrivate: true,
    files,
  });
  assert.ok(newRepoPrompt.includes('private repository named "my-app"'));
  assert.ok(newRepoPrompt.includes('github_push_files_batch'));

  const existingRepoPrompt = buildGitHubSyncPrompt({
    title: 'My App',
    repoName: 'my-app',
    owner: 'octocat',
    branch: 'feat/ide',
    commitMessage: 'chore: update',
    isNewRepo: false,
    isPrivate: false,
    files,
  });
  assert.ok(existingRepoPrompt.includes('octocat/my-app'));
  assert.ok(existingRepoPrompt.includes('feat/ide'));
});
