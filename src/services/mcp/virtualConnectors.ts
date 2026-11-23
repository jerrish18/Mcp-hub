import type { McpTool, ServerSecretPayload } from '../../types';
import { redactSecrets } from '../../utils/redact';
import type { FetchLike } from '../auth/oauth';

export const YOUTUBE_TOOLS: McpTool[] = [
  {
    name: 'youtube_search_videos',
    description: 'Search public YouTube videos, channels, or playlists by query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g. Pixel 8 camera tips)' },
        maxResults: { type: 'number', description: 'Maximum results (1-15, default 5)' },
      },
      required: ['query'],
    },
    annotations: { title: 'Search YouTube Videos', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'youtube_get_video_details',
    description: 'Fetch title, channel, duration, view count, like count, and description for a video ID.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: 'YouTube video ID (e.g. dQw4w9WgXcQ)' },
      },
      required: ['videoId'],
    },
    annotations: { title: 'Get Video Details', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'youtube_get_channel_stats',
    description: 'Get subscriber count, total views, and video count for a channel ID or @handle.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'YouTube Channel ID (UC...)' },
        handle: { type: 'string', description: 'YouTube @handle (e.g. @Google)' },
      },
    },
    annotations: { title: 'Get Channel Statistics', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'youtube_get_video_comments',
    description: 'Fetch top comments on a public YouTube video.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: { type: 'string', description: 'YouTube video ID' },
        maxResults: { type: 'number', description: 'Maximum comments (1-20, default 5)' },
      },
      required: ['videoId'],
    },
    annotations: { title: 'Get Video Comments', readOnlyHint: true, idempotentHint: true },
  },
];

export const GITHUB_TOOLS: McpTool[] = [
  {
    name: 'github_list_repos',
    description: 'List repositories owned by or accessible to the authenticated GitHub account.',
    inputSchema: {
      type: 'object',
      properties: {
        perPage: { type: 'number', description: 'Number of repos (1-30, default 10)' },
        sort: { type: 'string', description: 'Sort order: updated, created, pushed, full_name' },
      },
    },
    annotations: { title: 'List GitHub Repositories', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'github_search_repos',
    description: 'Search public GitHub repositories by topic, language, or keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'GitHub search query (e.g. modelcontextprotocol language:typescript)' },
        perPage: { type: 'number', description: 'Max results (1-15, default 5)' },
      },
      required: ['query'],
    },
    annotations: { title: 'Search GitHub Repositories', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'github_create_repo',
    description: 'Create a new GitHub repository under the authenticated account.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository slug (e.g. my-pro-app)' },
        description: { type: 'string', description: 'Short repository description' },
        private: { type: 'boolean', description: 'Create as private repository (default false)' },
        autoInit: { type: 'boolean', description: 'Initialize repository with an empty README commit (default true)' },
      },
      required: ['name'],
    },
    annotations: { title: 'Create GitHub Repository', readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'github_list_repo_files',
    description: 'List files and folders inside a GitHub repository directory.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Directory path (empty for root)' },
        branch: { type: 'string', description: 'Optional branch or ref name' },
      },
      required: ['owner', 'repo'],
    },
    annotations: { title: 'List Repository Files', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'github_read_file',
    description: 'Read UTF-8 text content and SHA of a file from a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path (e.g. src/App.tsx)' },
        branch: { type: 'string', description: 'Optional branch or ref name' },
      },
      required: ['owner', 'repo', 'path'],
    },
    annotations: { title: 'Read GitHub File', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'github_create_branch',
    description: 'Create a new branch in a GitHub repository from an existing base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: 'New branch name (e.g. feat/canvas-ui)' },
        fromBranch: { type: 'string', description: 'Source branch (defaults to repo default branch)' },
      },
      required: ['owner', 'repo', 'branch'],
    },
    annotations: { title: 'Create GitHub Branch', readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'github_push_file',
    description: 'Create or update a single file in a GitHub repository with a commit message.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'Target file path' },
        content: { type: 'string', description: 'Full UTF-8 file contents' },
        message: { type: 'string', description: 'Git commit message' },
        branch: { type: 'string', description: 'Target branch (optional, defaults to repo default branch)' },
      },
      required: ['owner', 'repo', 'path', 'content', 'message'],
    },
    annotations: { title: 'Push File to GitHub', readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'github_push_files_batch',
    description: 'Commit multiple application files atomically to a GitHub repository branch in one commit.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner (optional; defaults to authenticated user)' },
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: 'Target branch (default main)' },
        message: { type: 'string', description: 'Commit message' },
        files: {
          type: 'array',
          description: 'Array of { path, content } files to commit together',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['repo', 'message', 'files'],
    },
    annotations: { title: 'Batch Commit Files to GitHub', readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'github_list_issues',
    description: 'List open or closed issues in a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'open, closed, or all (default open)' },
        perPage: { type: 'number', description: 'Max results (1-20, default 10)' },
      },
      required: ['owner', 'repo'],
    },
    annotations: { title: 'List Repository Issues', readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'github_create_issue',
    description: 'Create a new issue in a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue Markdown body' },
      },
      required: ['owner', 'repo', 'title'],
    },
    annotations: { title: 'Create GitHub Issue', readOnlyHint: false, destructiveHint: false },
  },
];

function extractYoutubeKey(secrets: ServerSecretPayload): string {
  const token = (secrets.bearerToken ?? secrets.customHeaders?.['X-Goog-Api-Key'] ?? '').trim();
  return token.replace(/^Bearer\s+/i, '');
}

function extractGithubToken(secrets: ServerSecretPayload): string {
  const raw = (secrets.oauthTokens?.accessToken ?? secrets.bearerToken ?? '').trim();
  return raw.replace(/^Bearer\s+/i, '');
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function encodeRepoPath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function okText(id: string | number, text: string) {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }], isError: false },
  };
}

function errText(id: string | number, text: string) {
  return {
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text }], isError: true },
  };
}

export async function handleYoutubeVirtualMcp(params: {
  id?: string | number;
  method: string;
  rpcParams?: Record<string, unknown>;
  secrets: ServerSecretPayload;
  fetchFn?: FetchLike;
}): Promise<Record<string, unknown>> {
  const { id = 1, method, rpcParams = {}, secrets, fetchFn = fetch } = params;
  const apiKey = extractYoutubeKey(secrets);

  if (method === 'initialize') {
    if (!apiKey) {
      throw new Error('YouTube Data API v3 key is required. Tap Connect to paste your free Google API key.');
    }
    const verifyRes = await fetchFn(
      `https://www.googleapis.com/youtube/v3/videos?part=id&chart=mostPopular&maxResults=1&key=${encodeURIComponent(apiKey)}`
    );
    if (!verifyRes.ok) {
      const msg = redactSecrets(await verifyRes.text(), [apiKey]);
      throw new Error(`YouTube API rejected key (${verifyRes.status}): ${msg.slice(0, 180)}`);
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'YouTube Data API MCP', version: '1.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: YOUTUBE_TOOLS } };
  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };

  if (method === 'tools/call') {
    if (!apiKey) return errText(id, 'Missing YouTube Data API v3 key.');
    const name = String(rpcParams.name ?? '');
    const args = (rpcParams.arguments ?? {}) as Record<string, unknown>;

    if (name === 'youtube_search_videos') {
      const q = String(args.query ?? '').trim();
      const maxResults = Math.max(1, Math.min(15, Number(args.maxResults) || 5));
      const res = await fetchFn(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(q)}&maxResults=${maxResults}&key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) return errText(id, `YouTube API ${res.status}: ${redactSecrets(await res.text(), [apiKey])}`);
      const json = (await res.json()) as {
        items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string; description?: string } }>;
      };
      const items = (json.items ?? []).map((item) => ({
        videoId: item.id?.videoId,
        url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : undefined,
        title: item.snippet?.title,
        channel: item.snippet?.channelTitle,
        publishedAt: item.snippet?.publishedAt,
        description: item.snippet?.description,
      }));
      return okText(id, JSON.stringify(items, null, 2));
    }

    if (name === 'youtube_get_video_details') {
      const videoId = String(args.videoId ?? '').trim();
      const res = await fetchFn(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) return errText(id, `YouTube API ${res.status}: ${redactSecrets(await res.text(), [apiKey])}`);
      return okText(id, JSON.stringify(await res.json(), null, 2));
    }

    if (name === 'youtube_get_channel_stats') {
      const channelId = String(args.channelId ?? '').trim();
      const handle = String(args.handle ?? '').trim();
      const qs = channelId
        ? `id=${encodeURIComponent(channelId)}`
        : `forHandle=${encodeURIComponent(handle.startsWith('@') ? handle : `@${handle}`)}`;
      const res = await fetchFn(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&${qs}&key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) return errText(id, `YouTube API ${res.status}: ${redactSecrets(await res.text(), [apiKey])}`);
      return okText(id, JSON.stringify(await res.json(), null, 2));
    }

    if (name === 'youtube_get_video_comments') {
      const videoId = String(args.videoId ?? '').trim();
      const maxResults = Math.max(1, Math.min(20, Number(args.maxResults) || 5));
      const res = await fetchFn(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&maxResults=${maxResults}&key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) return errText(id, `YouTube API ${res.status}: ${redactSecrets(await res.text(), [apiKey])}`);
      return okText(id, JSON.stringify(await res.json(), null, 2));
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown YouTube tool: ${name}` } };
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

export async function handleGithubVirtualMcp(params: {
  id?: string | number;
  method: string;
  rpcParams?: Record<string, unknown>;
  secrets: ServerSecretPayload;
  fetchFn?: FetchLike;
}): Promise<Record<string, unknown>> {
  const { id = 1, method, rpcParams = {}, secrets, fetchFn = fetch } = params;
  const token = extractGithubToken(secrets);
  const authHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (method === 'initialize') {
    if (!token) {
      throw new Error('GitHub Personal Access Token or OAuth token is required. Tap Connect to authenticate.');
    }
    const verifyRes = await fetchFn('https://api.github.com/user', { headers: authHeaders });
    if (verifyRes.status === 401) {
      throw new Error('401 Unauthorized: GitHub token is invalid or expired.');
    }
    if (!verifyRes.ok) {
      const msg = redactSecrets(await verifyRes.text(), [token]);
      throw new Error(`GitHub API error (${verifyRes.status}): ${msg.slice(0, 180)}`);
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'GitHub Direct MCP', version: '2.0.0' },
      },
    };
  }

  if (method === 'notifications/initialized') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: GITHUB_TOOLS } };
  if (method === 'resources/list') return { jsonrpc: '2.0', id, result: { resources: [] } };
  if (method === 'prompts/list') return { jsonrpc: '2.0', id, result: { prompts: [] } };

  if (method === 'tools/call') {
    if (!token) return errText(id, 'Missing GitHub token.');
    const name = String(rpcParams.name ?? '');
    const args = (rpcParams.arguments ?? {}) as Record<string, unknown>;

    if (name === 'github_list_repos') {
      const perPage = Math.max(1, Math.min(30, Number(args.perPage) || 10));
      const sort = encodeURIComponent(String(args.sort ?? 'updated'));
      const res = await fetchFn(`https://api.github.com/user/repos?per_page=${perPage}&sort=${sort}`, {
        headers: authHeaders,
      });
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const repos = (await res.json()) as Array<{
        full_name: string;
        default_branch?: string;
        description: string | null;
        private: boolean;
        stargazers_count: number;
        open_issues_count: number;
        html_url: string;
        updated_at: string;
      }>;
      return okText(
        id,
        JSON.stringify(
          repos.map((r) => ({
            repo: r.full_name,
            defaultBranch: r.default_branch ?? 'main',
            description: r.description,
            private: r.private,
            stars: r.stargazers_count,
            openIssues: r.open_issues_count,
            url: r.html_url,
            updatedAt: r.updated_at,
          })),
          null,
          2
        )
      );
    }

    if (name === 'github_search_repos') {
      const q = encodeURIComponent(String(args.query ?? '').trim());
      const perPage = Math.max(1, Math.min(15, Number(args.perPage) || 5));
      const res = await fetchFn(`https://api.github.com/search/repositories?q=${q}&per_page=${perPage}`, {
        headers: authHeaders,
      });
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const json = (await res.json()) as {
        items?: Array<{ full_name: string; description: string | null; stargazers_count: number; html_url: string }>;
      };
      return okText(
        id,
        JSON.stringify(
          (json.items ?? []).map((r) => ({
            repo: r.full_name,
            description: r.description,
            stars: r.stargazers_count,
            url: r.html_url,
          })),
          null,
          2
        )
      );
    }

    if (name === 'github_create_repo') {
      const repoName = String(args.name ?? '').trim();
      if (!repoName) return errText(id, 'Repository "name" is required.');
      const res = await fetchFn('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repoName,
          description: typeof args.description === 'string' ? args.description : undefined,
          private: Boolean(args.private),
          auto_init: args.autoInit !== false,
        }),
      });
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const created = (await res.json()) as {
        full_name: string;
        name: string;
        default_branch?: string;
        private: boolean;
        html_url: string;
        owner?: { login?: string };
      };
      return okText(
        id,
        JSON.stringify(
          {
            repo: created.full_name,
            owner: created.owner?.login,
            name: created.name,
            defaultBranch: created.default_branch ?? 'main',
            private: created.private,
            url: created.html_url,
          },
          null,
          2
        )
      );
    }

    if (name === 'github_list_repo_files') {
      const owner = encodeURIComponent(String(args.owner ?? '').trim());
      const repo = encodeURIComponent(String(args.repo ?? '').trim());
      const encodedPath = encodeRepoPath(String(args.path ?? ''));
      const branch = String(args.branch ?? '').trim();
      const qs = branch ? `?ref=${encodeURIComponent(branch)}` : '';
      const suffix = encodedPath ? `/${encodedPath}` : '';
      const res = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/contents${suffix}${qs}`,
        { headers: authHeaders }
      );
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const rawJson = (await res.json()) as
        | Array<{ name: string; path: string; type: string; size?: number }>
        | { name: string; path: string; type: string; size?: number };
      const entries = Array.isArray(rawJson) ? rawJson : [rawJson];
      return okText(
        id,
        JSON.stringify(
          entries.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size })),
          null,
          2
        )
      );
    }

    if (name === 'github_read_file') {
      const owner = encodeURIComponent(String(args.owner ?? '').trim());
      const repo = encodeURIComponent(String(args.repo ?? '').trim());
      const encodedPath = encodeRepoPath(String(args.path ?? ''));
      const branch = String(args.branch ?? '').trim();
      const qs = branch ? `?ref=${encodeURIComponent(branch)}` : '';
      const res = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${qs}`,
        { headers: authHeaders }
      );
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const fileObj = (await res.json()) as {
        path: string;
        sha: string;
        size?: number;
        encoding?: string;
        content?: string;
        html_url?: string;
      };
      const decoded =
        fileObj.content && fileObj.encoding === 'base64'
          ? base64ToUtf8(fileObj.content)
          : fileObj.content ?? '';
      return okText(
        id,
        JSON.stringify(
          {
            path: fileObj.path,
            sha: fileObj.sha,
            size: fileObj.size,
            url: fileObj.html_url,
            content: decoded,
          },
          null,
          2
        )
      );
    }

    if (name === 'github_create_branch') {
      const owner = encodeURIComponent(String(args.owner ?? '').trim());
      const repo = encodeURIComponent(String(args.repo ?? '').trim());
      const newBranch = String(args.branch ?? '').trim();
      if (!newBranch) return errText(id, 'Target "branch" name is required.');
      let fromBranch = String(args.fromBranch ?? '').trim();
      if (!fromBranch) {
        const repoRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: authHeaders,
        });
        if (!repoRes.ok) {
          return errText(id, `GitHub API ${repoRes.status}: ${redactSecrets(await repoRes.text(), [token])}`);
        }
        const repoMeta = (await repoRes.json()) as { default_branch?: string };
        fromBranch = repoMeta.default_branch || 'main';
      }

      const refRes = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
        { headers: authHeaders }
      );
      if (!refRes.ok) {
        return errText(id, `GitHub API ${refRes.status}: ${redactSecrets(await refRes.text(), [token])}`);
      }
      const refData = (await refRes.json()) as { object?: { sha?: string } };
      const baseSha = refData.object?.sha;
      if (!baseSha) return errText(id, `Could not resolve base branch "${fromBranch}" SHA.`);

      const createRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
      });
      if (!createRes.ok) {
        return errText(id, `GitHub API ${createRes.status}: ${redactSecrets(await createRes.text(), [token])}`);
      }
      return okText(
        id,
        JSON.stringify({ branch: newBranch, fromBranch, sha: baseSha }, null, 2)
      );
    }

    if (name === 'github_push_file') {
      const owner = encodeURIComponent(String(args.owner ?? '').trim());
      const repo = encodeURIComponent(String(args.repo ?? '').trim());
      const encodedPath = encodeRepoPath(String(args.path ?? ''));
      const content = String(args.content ?? '');
      const message = String(args.message ?? 'Update file via MCP Hub').trim();
      const branch = String(args.branch ?? '').trim();
      const qs = branch ? `?ref=${encodeURIComponent(branch)}` : '';

      let existingSha: string | undefined;
      const lookupRes = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}${qs}`,
        { headers: authHeaders }
      );
      if (lookupRes.ok) {
        const existing = (await lookupRes.json()) as { sha?: string };
        existingSha = existing.sha;
      }

      const putRes = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`,
        {
          method: 'PUT',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            content: utf8ToBase64(content),
            ...(branch ? { branch } : {}),
            ...(existingSha ? { sha: existingSha } : {}),
          }),
        }
      );
      if (!putRes.ok) {
        return errText(id, `GitHub API ${putRes.status}: ${redactSecrets(await putRes.text(), [token])}`);
      }
      const pushed = (await putRes.json()) as {
        content?: { path?: string; html_url?: string };
        commit?: { sha?: string; html_url?: string };
      };
      return okText(
        id,
        JSON.stringify(
          {
            path: pushed.content?.path ?? String(args.path),
            commitSha: pushed.commit?.sha,
            commitUrl: pushed.commit?.html_url,
            fileUrl: pushed.content?.html_url,
          },
          null,
          2
        )
      );
    }

    if (name === 'github_push_files_batch') {
      const rawRepo = String(args.repo ?? '').trim();
      let ownerRaw = String(args.owner ?? '').trim();
      let repoRaw = rawRepo;
      if (rawRepo.includes('/') && !ownerRaw) {
        const [o, r] = rawRepo.split('/', 2);
        ownerRaw = o.trim();
        repoRaw = r.trim();
      }
      if (!ownerRaw) {
        const userRes = await fetchFn('https://api.github.com/user', { headers: authHeaders });
        if (!userRes.ok) {
          return errText(id, `GitHub API ${userRes.status}: ${redactSecrets(await userRes.text(), [token])}`);
        }
        const userJson = (await userRes.json()) as { login?: string };
        ownerRaw = userJson.login ?? '';
      }
      if (!ownerRaw || !repoRaw) {
        return errText(id, 'Both repository "owner" and "repo" are required.');
      }

      const rawFiles = Array.isArray(args.files) ? args.files : [];
      const files = rawFiles
        .filter((f): f is { path: string; content: string } => {
          if (!f || typeof f !== 'object') return false;
          const obj = f as Record<string, unknown>;
          return typeof obj.path === 'string' && obj.path.trim().length > 0 && typeof obj.content === 'string';
        })
        .map((f) => ({
          path: f.path.trim().replace(/^\.\/+/, '').replace(/^\/+/, ''),
          content: f.content,
        }));

      if (files.length === 0) {
        return errText(id, 'At least one { path, content } file entry is required.');
      }

      const owner = encodeURIComponent(ownerRaw);
      const repo = encodeURIComponent(repoRaw);
      const message = String(args.message ?? 'Sync Pro Canvas application via MCP Hub').trim();
      let branch = String(args.branch ?? '').trim();

      const repoRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: authHeaders,
      });
      if (!repoRes.ok) {
        return errText(id, `GitHub API ${repoRes.status}: ${redactSecrets(await repoRes.text(), [token])}`);
      }
      const repoMeta = (await repoRes.json()) as { default_branch?: string; html_url?: string };
      const defaultBranch = repoMeta.default_branch || 'main';
      if (!branch) branch = defaultBranch;

      // Resolve head SHA for target branch (or create branch / bootstrap empty repo)
      let refRes = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        { headers: authHeaders }
      );

      let remainingFiles = files;
      if (refRes.status === 404 || refRes.status === 409) {
        // Check if default branch exists when pushing to a new feature branch
        const defaultRefRes =
          branch !== defaultBranch
            ? await fetchFn(
                `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
                { headers: authHeaders }
              )
            : null;

        if (defaultRefRes?.ok) {
          const baseRef = (await defaultRefRes.json()) as { object?: { sha?: string } };
          if (baseRef.object?.sha) {
            const branchCreate = await fetchFn(
              `https://api.github.com/repos/${owner}/${repo}/git/refs`,
              {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ref: `refs/heads/${branch}`,
                  sha: baseRef.object.sha,
                }),
              }
            );
            if (!branchCreate.ok) {
              return errText(id, `GitHub API ${branchCreate.status}: ${redactSecrets(await branchCreate.text(), [token])}`);
            }
            refRes = await fetchFn(
              `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
              { headers: authHeaders }
            );
          }
        } else {
          // Brand new empty repository -> bootstrap first file via Contents API
          const first = files[0];
          const bootRes = await fetchFn(
            `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(first.path)}`,
            {
              method: 'PUT',
              headers: { ...authHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message,
                content: utf8ToBase64(first.content),
                branch,
              }),
            }
          );
          if (!bootRes.ok) {
            return errText(id, `GitHub API ${bootRes.status}: ${redactSecrets(await bootRes.text(), [token])}`);
          }
          const bootJson = (await bootRes.json()) as {
            commit?: { sha?: string; html_url?: string };
          };
          if (files.length === 1) {
            return okText(
              id,
              JSON.stringify(
                {
                  repo: `${ownerRaw}/${repoRaw}`,
                  branch,
                  commitSha: bootJson.commit?.sha,
                  commitUrl: bootJson.commit?.html_url,
                  repoUrl: repoMeta.html_url ?? `https://github.com/${ownerRaw}/${repoRaw}`,
                  filesCommitted: 1,
                },
                null,
                2
              )
            );
          }
          remainingFiles = files.slice(1);
          refRes = await fetchFn(
            `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
            { headers: authHeaders }
          );
        }
      }

      if (!refRes.ok) {
        return errText(id, `GitHub API ${refRes.status}: ${redactSecrets(await refRes.text(), [token])}`);
      }
      const refData = (await refRes.json()) as { object?: { sha?: string } };
      const headSha = refData.object?.sha;
      if (!headSha) return errText(id, 'Unable to read repository branch HEAD commit.');

      const commitRes = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/git/commits/${headSha}`,
        { headers: authHeaders }
      );
      if (!commitRes.ok) {
        return errText(id, `GitHub API ${commitRes.status}: ${redactSecrets(await commitRes.text(), [token])}`);
      }
      const commitData = (await commitRes.json()) as { tree?: { sha?: string } };
      const baseTreeSha = commitData.tree?.sha;

      const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      for (const f of remainingFiles) {
        const blobRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
        });
        if (!blobRes.ok) {
          return errText(id, `GitHub blob error ${blobRes.status}: ${redactSecrets(await blobRes.text(), [token])}`);
        }
        const blobData = (await blobRes.json()) as { sha: string };
        treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: blobData.sha });
      }

      const treeRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
          tree: treeItems,
        }),
      });
      if (!treeRes.ok) {
        return errText(id, `GitHub tree error ${treeRes.status}: ${redactSecrets(await treeRes.text(), [token])}`);
      }
      const newTree = (await treeRes.json()) as { sha: string };

      const newCommitRes = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          tree: newTree.sha,
          parents: [headSha],
        }),
      });
      if (!newCommitRes.ok) {
        return errText(id, `GitHub commit error ${newCommitRes.status}: ${redactSecrets(await newCommitRes.text(), [token])}`);
      }
      const newCommit = (await newCommitRes.json()) as { sha: string; html_url?: string };

      const patchRefRes = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha: newCommit.sha }),
        }
      );
      if (!patchRefRes.ok) {
        return errText(id, `GitHub ref update error ${patchRefRes.status}: ${redactSecrets(await patchRefRes.text(), [token])}`);
      }

      return okText(
        id,
        JSON.stringify(
          {
            repo: `${ownerRaw}/${repoRaw}`,
            branch,
            commitSha: newCommit.sha,
            commitUrl: newCommit.html_url ?? `https://github.com/${ownerRaw}/${repoRaw}/commit/${newCommit.sha}`,
            repoUrl: repoMeta.html_url ?? `https://github.com/${ownerRaw}/${repoRaw}`,
            filesCommitted: files.length,
          },
          null,
          2
        )
      );
    }

    if (name === 'github_list_issues') {
      const owner = encodeURIComponent(String(args.owner ?? '').trim());
      const repo = encodeURIComponent(String(args.repo ?? '').trim());
      const state = encodeURIComponent(String(args.state ?? 'open'));
      const perPage = Math.max(1, Math.min(20, Number(args.perPage) || 10));
      const res = await fetchFn(
        `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}`,
        { headers: authHeaders }
      );
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const issues = (await res.json()) as Array<{
        number: number;
        title: string;
        state: string;
        html_url: string;
        user?: { login?: string };
      }>;
      return okText(
        id,
        JSON.stringify(
          issues.map((i) => ({
            number: i.number,
            title: i.title,
            state: i.state,
            author: i.user?.login,
            url: i.html_url,
          })),
          null,
          2
        )
      );
    }

    if (name === 'github_create_issue') {
      const owner = encodeURIComponent(String(args.owner ?? '').trim());
      const repo = encodeURIComponent(String(args.repo ?? '').trim());
      const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: String(args.title ?? ''),
          body: typeof args.body === 'string' ? args.body : undefined,
        }),
      });
      if (!res.ok) return errText(id, `GitHub API ${res.status}: ${redactSecrets(await res.text(), [token])}`);
      const created = (await res.json()) as { number: number; title: string; html_url: string };
      return okText(id, `Created issue #${created.number}: ${created.title}\n${created.html_url}`);
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown GitHub tool: ${name}` } };
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}
