import { sanitizeFilename } from './docExport';

export interface AppFileEntry {
  path: string;
  language: string;
  content: string;
}

export interface AppArtifactSpec {
  title: string;
  description?: string;
  framework?: string;
  entryFile?: string;
  files: AppFileEntry[];
}

export function inferFileLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'typescript';
  if (lower.endsWith('.jsx')) return 'jsx';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.sql')) return 'sql';
  return 'text';
}

function normalizePath(rawPath: string): string {
  return rawPath.trim().replace(/^\.\/+/, '').replace(/^\/+/, '');
}

export function parseAppArtifactBlock(language: string, rawCode: string): AppArtifactSpec | null {
  const lang = language.toLowerCase().trim();
  if (lang !== 'artifact-app' && lang !== 'app-project') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCode);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.files) || obj.files.length === 0) {
    return null;
  }

  const files: AppFileEntry[] = [];
  for (const item of obj.files) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const path = normalizePath(String(f.path ?? ''));
    if (!path || typeof f.content !== 'string') continue;
    const languageName =
      typeof f.language === 'string' && f.language.trim()
        ? f.language.trim().toLowerCase()
        : inferFileLanguage(path);
    files.push({
      path,
      language: languageName,
      content: f.content,
    });
  }

  if (files.length === 0) return null;

  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : 'Pro Web Application';

  return {
    title,
    description: typeof obj.description === 'string' ? obj.description.trim() : undefined,
    framework: typeof obj.framework === 'string' ? obj.framework.trim() : undefined,
    entryFile:
      typeof obj.entryFile === 'string' && obj.entryFile.trim()
        ? normalizePath(obj.entryFile)
        : undefined,
    files,
  };
}

const STORAGE_SHIM_SCRIPT = `<script>
(function installCanvasStorage() {
  function storage() {
    var values = new Map();
    return {
      get length() { return values.size; },
      key: function(index) {
        return Array.from(values.keys())[Number(index) >>> 0] ?? null;
      },
      getItem: function(key) { return values.get(String(key)) ?? null; },
      setItem: function(key, value) { values.set(String(key), String(value)); },
      removeItem: function(key) { values.delete(String(key)); },
      clear: function() { values.clear(); }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function(name) {
    try { void window[name].length; }
    catch {
      Object.defineProperty(window, name, { configurable: true, value: storage() });
    }
  });
  try { void document.cookie; }
  catch {
    var cookies = new Map();
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: function() {
        return Array.from(cookies, function(entry) { return entry.join('='); }).join('; ');
      },
      set: function(value) {
        var parts = String(value).split(';');
        var separator = parts[0].indexOf('=');
        if (separator < 1) return;
        var key = parts[0].slice(0, separator).trim();
        var attributes = parts.slice(1).map(function(part) { return part.trim(); });
        var maxAge = attributes.find(function(part) { return /^max-age=/i.test(part); });
        var expires = attributes.find(function(part) { return /^expires=/i.test(part); });
        if ((maxAge && Number(maxAge.slice(8)) <= 0) ||
            (!maxAge && expires && Date.parse(expires.slice(8)) <= Date.now())) cookies.delete(key);
        else cookies.set(key, parts[0].slice(separator + 1).trim());
      }
    });
  }
})();
</script>`;

const RUNTIME_BRIDGE_SCRIPT = `<script>
(function(){
  if (window.__mcpCanvasRuntimeHooked) return;
  window.__mcpCanvasRuntimeHooked = true;
  function send(level, msg, blocking) {
    window.parent.postMessage({
      source: 'mcphub-canvas-runtime',
      level: level,
      message: String(msg || '').slice(0, 1000),
      timestamp: Date.now(),
      blocking: Boolean(blocking)
    }, '*');
  }
  window.addEventListener('load', function() {
    window.parent.postMessage({ source: 'mcphub-canvas-runtime', type: 'loaded' }, '*');
  }, { once: true });
  window.addEventListener('error', function(ev) {
    var target = ev.target;
    if (target && target !== window && target.tagName) {
      var url = target.currentSrc || target.src || target.href;
      var blocking = target.tagName === 'SCRIPT' || (target.tagName === 'LINK' && target.rel === 'stylesheet');
      send(blocking ? 'error' : 'warn', 'Failed to load ' + target.tagName.toLowerCase() + (url ? ': ' + url : ''), blocking);
      return;
    }
    send('error', (ev.message || 'Runtime error') + (ev.lineno ? ' (line ' + ev.lineno + ')' : ''), true);
  }, true);
  window.addEventListener('unhandledrejection', function(ev) {
    var reason = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason || 'Unhandled promise rejection');
    send('error', reason, true);
  });
  document.addEventListener('securitypolicyviolation', function(ev) {
    var blocking = ev.disposition === 'enforce' &&
      (ev.effectiveDirective === 'script-src-elem' || ev.effectiveDirective === 'script-src-attr' ||
       ev.effectiveDirective === 'form-action');
    send(blocking ? 'error' : 'warn', ev.effectiveDirective + ' blocked ' + (ev.blockedURI || 'a request'), blocking);
  });
  ['error', 'warn'].forEach(function(level) {
    var original = console[level];
    console[level] = function() {
      var message = Array.from(arguments, function(value) {
        try { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
        catch { return String(value); }
      }).join(' ');
      send(level, message, false);
      return original.apply(console, arguments);
    };
  });
})();
</script>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findMatchingProjectFile(
  files: AppFileEntry[],
  refPath: string
): AppFileEntry | undefined {
  const cleanRef = normalizePath(refPath.split('?')[0].split('#')[0]);
  return (
    files.find((f) => f.path.toLowerCase() === cleanRef.toLowerCase()) ??
    files.find((f) => f.path.toLowerCase().endsWith(`/${cleanRef.toLowerCase()}`))
  );
}

/**
 * Bundles a multi-file AppArtifactSpec into a standalone executable HTML document
 * for live sandboxed iframe preview (and optionally embeds runtime error bridging).
 */
export function buildAppPreviewSrcDoc(
  spec: AppArtifactSpec,
  options?: { includeRuntimeBridge?: boolean }
): string {
  const includeBridge = options?.includeRuntimeBridge !== false;
  const previewScripts = includeBridge ? STORAGE_SHIM_SCRIPT + '\n' + RUNTIME_BRIDGE_SCRIPT : '';
  const entryTarget = spec.entryFile?.toLowerCase();
  const htmlEntry =
    (entryTarget
      ? spec.files.find((f) => f.path.toLowerCase() === entryTarget)
      : undefined) ??
    spec.files.find((f) => f.path.toLowerCase() === 'index.html') ??
    spec.files.find((f) => f.path.toLowerCase().endsWith('.html'));

  if (!htmlEntry) {
    const fileCards = spec.files
      .map(
        (f) =>
          `<div class="file"><strong>${escapeHtml(f.path)}</strong><span>${escapeHtml(f.language)} · ${f.content.split('\n').length} lines</span></div>`
      )
      .join('');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(spec.title)}</title>
${previewScripts}
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; padding: 24px; }
  .shell { max-width: 680px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 22px; }
  h1 { margin: 0 0 6px; font-size: 18px; }
  p { margin: 0 0 16px; font-size: 13px; color: #475569; line-height: 1.5; }
  .meta { display: inline-block; font-size: 11px; font-weight: 600; color: #1d4ed8; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 4px 10px; margin-bottom: 14px; }
  .file { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 8px; font-size: 12px; }
  .file span { color: #64748b; font-family: ui-monospace, monospace; font-size: 11px; }
</style>
</head>
<body>
  <div class="shell">
    <div class="meta">${escapeHtml(spec.framework || 'Project')} · ${spec.files.length} files</div>
    <h1>${escapeHtml(spec.title)}</h1>
    <p>${escapeHtml(spec.description || 'Multi-file source project ready for code inspection and GitHub sync.')}</p>
    ${fileCards}
  </div>
</body>
</html>`;
  }

  let html = htmlEntry.content;
  const inlinedPaths = new Set<string>([htmlEntry.path]);

  // Inline local <link rel="stylesheet" href="..."> references
  html = html.replace(
    /<link\b[^>]*rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (fullTag, href: string) => {
      if (/^https?:\/\//i.test(href) || href.startsWith('//')) return fullTag;
      const match = findMatchingProjectFile(spec.files, href);
      if (!match) return fullTag;
      inlinedPaths.add(match.path);
      return `<style data-file="${escapeHtml(match.path)}">\n${match.content}\n</style>`;
    }
  );
  html = html.replace(
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']?stylesheet["']?[^>]*\/?>/gi,
    (fullTag, href: string) => {
      if (/^https?:\/\//i.test(href) || href.startsWith('//')) return fullTag;
      const match = findMatchingProjectFile(spec.files, href);
      if (!match) return fullTag;
      inlinedPaths.add(match.path);
      return `<style data-file="${escapeHtml(match.path)}">\n${match.content}\n</style>`;
    }
  );

  // Inline local <script src="..."></script> references
  html = html.replace(
    /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (fullTag, beforeSrc: string, src: string, afterSrc: string) => {
      if (/^https?:\/\//i.test(src) || src.startsWith('//')) return fullTag;
      const match = findMatchingProjectFile(spec.files, src);
      if (!match) return fullTag;
      inlinedPaths.add(match.path);
      const attrs = `${beforeSrc} ${afterSrc}`.trim();
      const safeJs = match.content.replace(/<\/script>/gi, '<\\/script>');
      return `<script ${attrs} data-file="${escapeHtml(match.path)}">\n${safeJs}\n</script>`;
    }
  );

  // Auto-inject unreferenced CSS/JS project files if index.html had no explicit tag for them
  const unreferencedCss = spec.files.filter(
    (f) => !inlinedPaths.has(f.path) && f.language === 'css'
  );
  if (unreferencedCss.length > 0) {
    const styleTags = unreferencedCss
      .map((f) => `<style data-file="${escapeHtml(f.path)}">\n${f.content}\n</style>`)
      .join('\n');
    html = /<\/head>/i.test(html)
      ? html.replace(/<\/head>/i, `${styleTags}\n</head>`)
      : `${styleTags}\n${html}`;
  }

  const unreferencedJs = spec.files.filter(
    (f) =>
      !inlinedPaths.has(f.path) &&
      (f.language === 'javascript' || f.language === 'js') &&
      !f.path.toLowerCase().includes('.test.')
  );
  if (unreferencedJs.length > 0) {
    const scriptTags = unreferencedJs
      .map(
        (f) =>
          `<script data-file="${escapeHtml(f.path)}">\n${f.content.replace(/<\/script>/gi, '<\\/script>')}\n</script>`
      )
      .join('\n');
    html = /<\/body>/i.test(html)
      ? html.replace(/<\/body>/i, `${scriptTags}\n</body>`)
      : `${html}\n${scriptTags}`;
  }

  if (includeBridge) {
    // A malformed fragment may put code ahead of its head. Keep only the doctype ahead of the shim.
    html = html.replace(/^(\s*(?:<!doctype[^>]*>\s*)?(?:<html\b[^>]*>\s*)?(?:<head\b[^>]*>\s*)?)/i,
      (prefix) => `${prefix}${previewScripts}\n`);
  }

  return html;
}

/** Checks that the exported files can recreate the browser entry point on a case-sensitive host. */
export function validateAppExport(spec: AppArtifactSpec): string[] {
  const problems: string[] = [];
  const paths = new Set<string>();
  for (const file of spec.files) {
    const path = file.path;
    if (/[\\:]/.test(path) || [...path].some((char) => char < ' ' || char.charCodeAt(0) === 127) ||
        path.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
      problems.push(`Invalid project file path: ${path}`);
    }
    const key = path.toLowerCase();
    if (paths.has(key)) problems.push(`Duplicate project file path: ${path}`);
    paths.add(key);
  }

  const entry = spec.entryFile
    ? spec.files.find((file) => file.path === spec.entryFile)
    : spec.files.find((file) => file.path === 'index.html') ??
      spec.files.find((file) => inferFileLanguage(file.path) === 'html');
  if (!entry && spec.entryFile) return [...problems, `Entry file is missing: ${spec.entryFile}`];
  if (!entry || inferFileLanguage(entry.path) !== 'html') return problems;
  if (!entry.content.trim()) return [...problems, `Entry file is empty: ${entry.path}`];

  const base = new URL(entry.path, 'https://canvas.invalid/');
  const markup = entry.content.replace(/<!--[\s\S]*?-->|(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi,
    (_match, script?: string) => script ?? '');
  for (const [, name, attrs] of markup.matchAll(/<(script|link|img|source|audio|video)\b([^>]*)>/gi)) {
    if (name.toLowerCase() === 'link' && !/\brel\s*=\s*(?:"stylesheet"|'stylesheet'|stylesheet\b)/i.test(attrs)) continue;
    const match = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs);
    const ref = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
    try {
      const linked = decodeURIComponent(new URL(ref, base).pathname.slice(1));
      if (!spec.files.some((file) => file.path === linked)) {
        problems.push(`Missing local resource: ${ref} (from ${entry.path})`);
      }
    } catch {
      problems.push(`Invalid local reference: ${ref}`);
    }
  }
  return [...new Set(problems)];
}

export function suggestRepoSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
  return slug || 'mcp-hub-pro-app';
}

export function buildGitHubSyncPrompt(params: {
  title: string;
  description?: string;
  repoName: string;
  owner?: string;
  branch: string;
  commitMessage: string;
  isNewRepo: boolean;
  isPrivate: boolean;
  files: AppFileEntry[];
}): string {
  const cleanRepo = params.repoName.trim() || suggestRepoSlug(params.title);
  const cleanBranch = params.branch.trim() || 'main';
  const cleanOwner = params.owner?.trim();
  const filesPayload = JSON.stringify(
    params.files.map((f) => ({ path: f.path, content: f.content })),
    null,
    2
  );

  if (params.isNewRepo) {
    return (
      `Use the connected GitHub MCP tools to create a new ${params.isPrivate ? 'private' : 'public'} repository named "${cleanRepo}" ` +
      `(with description "${params.description || params.title}" and autoInit: true), and then push all ${params.files.length} project file(s) below using \`github_push_files_batch\` ` +
      `onto branch "${cleanBranch}" with commit message "${params.commitMessage}". Return the repository URL and commit SHA.\n\n` +
      `Files to commit:\n\`\`\`json\n${filesPayload}\n\`\`\``
    );
  }

  const target = cleanOwner ? `${cleanOwner}/${cleanRepo}` : cleanRepo;
  return (
    `Use the connected GitHub MCP tools to push all ${params.files.length} project file(s) below into repository "${target}" ` +
    `(use \`github_list_repos\` first if owner/repo needs verification) onto branch "${cleanBranch}" ` +
    `with commit message "${params.commitMessage}" via \`github_push_files_batch\`. Return the repository URL and commit SHA.\n\n` +
    `Files to commit:\n\`\`\`json\n${filesPayload}\n\`\`\``
  );
}

export function downloadAppBundle(spec: AppArtifactSpec): string {
  const html = buildAppPreviewSrcDoc(spec, { includeRuntimeBridge: false });
  const baseName = sanitizeFilename(spec.title, 'pdf').replace(/\.pdf$/, '');
  const filename = `${baseName || 'pro-app'}.html`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return filename;
}
