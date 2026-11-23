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

const RUNTIME_BRIDGE_SCRIPT = `<script>
(function(){
  if (window.__mcpCanvasRuntimeHooked) return;
  window.__mcpCanvasRuntimeHooked = true;
  function send(level, msg) {
    try {
      window.parent.postMessage({
        source: 'mcphub-canvas-runtime',
        level: level,
        message: String(msg || ''),
        timestamp: Date.now()
      }, '*');
    } catch (e) {}
  }
  window.addEventListener('error', function(ev) {
    send('error', (ev.message || 'Runtime error') + (ev.lineno ? ' (line ' + ev.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function(ev) {
    var reason = ev.reason && ev.reason.message ? ev.reason.message : String(ev.reason || 'Unhandled promise rejection');
    send('error', reason);
  });
  var origErr = console.error;
  console.error = function() {
    send('error', Array.prototype.slice.call(arguments).map(function(a){
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' '));
    return origErr.apply(console, arguments);
  };
  var origWarn = console.warn;
  console.warn = function() {
    send('warn', Array.prototype.slice.call(arguments).map(function(a){
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' '));
    return origWarn.apply(console, arguments);
  };
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
${includeBridge ? RUNTIME_BRIDGE_SCRIPT : ''}
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
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${RUNTIME_BRIDGE_SCRIPT}`);
    } else {
      html = `${RUNTIME_BRIDGE_SCRIPT}\n${html}`;
    }
  }

  return html;
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
