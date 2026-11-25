import test from 'node:test';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import {
  buildAppPreviewSrcDoc,
  buildGitHubSyncPrompt,
  CANVAS_IFRAME_SANDBOX,
  inferFileLanguage,
  parseAppArtifactBlock,
  STORAGE_SHIM_SCRIPT,
  suggestRepoSlug,
  validateAppExport,
  type AppArtifactSpec,
} from './appArtifact';

test('CANVAS_IFRAME_SANDBOX never includes allow-same-origin', () => {
  assert.equal(CANVAS_IFRAME_SANDBOX.includes('allow-same-origin'), false);
  assert.ok(CANVAS_IFRAME_SANDBOX.includes('allow-scripts'));
  assert.ok(CANVAS_IFRAME_SANDBOX.includes('allow-forms'));
  assert.ok(CANVAS_IFRAME_SANDBOX.includes('allow-modals'));
  assert.ok(CANVAS_IFRAME_SANDBOX.includes('allow-popups'));
  assert.ok(CANVAS_IFRAME_SANDBOX.includes('allow-downloads'));
});

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

test('buildAppPreviewSrcDoc inlines local CSS/JS, injects storage shim before app scripts, and attaches extended runtime bridge', () => {
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
  assert.ok(docWithBridge.includes('securitypolicyviolation'));
  assert.ok(docWithBridge.includes('data-mcphub-shim="storage"'));
  assert.ok(STORAGE_SHIM_SCRIPT.includes('localStorage'));
  assert.ok(STORAGE_SHIM_SCRIPT.includes('sessionStorage'));
  assert.ok(STORAGE_SHIM_SCRIPT.includes('cookie'));
  assert.ok(
    docWithBridge.indexOf('data-mcphub-shim="storage"') <
      docWithBridge.indexOf('window.appLoaded = true;')
  );
  assert.ok(docWithBridge.includes('<style data-file="styles.css">\nh1 { color: red; }\n</style>'));
  assert.ok(docWithBridge.includes('<style data-file="extra.css">\nbody { margin: 0; }\n</style>'));
  assert.ok(docWithBridge.includes('<script  data-file="app.js">\nwindow.appLoaded = true;\n</script>'));
  assert.ok(docWithBridge.includes('<script data-file="helpers.js">\nwindow.helperLoaded = true;\n</script>'));

  const exportDoc = buildAppPreviewSrcDoc(spec, { includeRuntimeBridge: false });
  assert.equal(exportDoc.includes('mcphub-canvas-runtime'), false);
  assert.ok(exportDoc.includes('data-mcphub-shim="storage"'));
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

test('preview shim runs first and provides isolated storage and cookies when access throws', () => {
  const spec: AppArtifactSpec = {
    title: 'Storage',
    files: [{ path: 'index.html', language: 'html', content: '<!doctype html><script>boot()</script>' }],
  };
  const html = buildAppPreviewSrcDoc(spec);
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.match(scripts[0], /installCanvasStorage/);
  assert.match(scripts[1], /mcphub-canvas-runtime/);
  assert.match(scripts[1], /securitypolicyviolation/);
  assert.equal(scripts[2], 'boot()');
  const blocked = { configurable: true, get: () => { throw new Error('SecurityError'); } };
  const window = Object.defineProperties({}, { localStorage: blocked, sessionStorage: blocked }) as Window;
  const document = Object.defineProperty({}, 'cookie', blocked) as Document;
  runInNewContext(scripts[0], { window, document });
  window.localStorage.setItem('count', '2');
  assert.equal(window.localStorage.length, 1);
  assert.equal(window.localStorage.key(0), 'count');
  assert.equal(window.localStorage.getItem('count'), '2');
  assert.equal(window.sessionStorage.getItem('count'), null);
  window.localStorage.removeItem('count');
  assert.equal(window.localStorage.length, 0);
  document.cookie = 'theme=dark; path=/';
  assert.equal(document.cookie, 'theme=dark');
  document.cookie = 'theme=; max-age=0';
  assert.equal(document.cookie, '');
});

test('export checks honor nested relative paths, case, and traversal', () => {
  const spec: AppArtifactSpec = {
    title: 'Export',
    entryFile: 'site/index.html',
    files: [
      { path: 'site/index.html', language: 'html', content: '<link href="./style.css" rel="stylesheet"><script src="../app.js"></script>' },
      { path: 'site/style.css', language: 'css', content: 'body {}' },
      { path: 'app.js', language: 'javascript', content: '' },
    ],
  };
  assert.deepEqual(validateAppExport(spec), []);
  spec.files[1].path = 'site/Style.css';
  spec.files.push({ path: '../out.js', language: 'javascript', content: '' });
  assert.deepEqual(validateAppExport(spec), [
    'Invalid project file path: ../out.js',
    'Missing local resource: ./style.css (from site/index.html)',
  ]);
});
