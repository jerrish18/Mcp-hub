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
        serverInfo: { name: 'GitHub Direct MCP', version: '1.0.0' },
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
