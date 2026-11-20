import type {
  McpPrompt,
  McpResource,
  McpServerConfig,
  McpTool,
  ServerSecretPayload,
} from '../../types';
import { assertSecureServerUrl, redactSecrets } from '../../utils/redact';
import { type FetchLike, resolveServerAuthHeaders } from '../auth/oauth';
import { handleVirtualMcpRequest } from './virtualSandbox';

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id?: string | number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpSessionState {
  sessionId?: string;
  transport: 'streamable_http' | 'sse';
  sseEndpoint?: string;
  sseAbort?: AbortController;
}

const activeSessions = new Map<string, McpSessionState>();
let rpcSeq = 1;

export function parseSseJsonRpcMessage(sseText: string, expectedId?: string | number): JsonRpcResponse | null {
  const blocks = sseText.split(/\r?\n\r?\n/);
  let lastParsed: JsonRpcResponse | null = null;
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n').trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const parsed = JSON.parse(raw) as JsonRpcResponse;
      lastParsed = parsed;
      if (expectedId !== undefined && parsed.id === expectedId) {
        return parsed;
      }
    } catch {
      // ignore non-JSON SSE frames
    }
  }
  return lastParsed;
}

export class McpUnauthorizedError extends Error {
  constructor(message = 'MCP server returned 401 Unauthorized') {
    super(message);
    this.name = 'McpUnauthorizedError';
  }
}

export async function sendMcpRpc<T = unknown>(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  method: string;
  rpcParams?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<{ result: T; updatedSecrets?: ServerSecretPayload }> {
  const {
    server,
    secrets,
    saveUpdatedSecrets,
    method,
    rpcParams,
    timeoutMs = 20_000,
    signal,
    fetchFn = fetch,
  } = params;

  assertSecureServerUrl(server.url);
  const reqId = rpcSeq++;

  if (server.url.startsWith('virtual://')) {
    const res = (await handleVirtualMcpRequest({
      jsonrpc: '2.0',
      id: reqId,
      method,
      params: rpcParams,
    })) as unknown as JsonRpcResponse<T>;
    if (res.error) {
      throw new Error(res.error.message);
    }
    return { result: res.result as T };
  }

  let latestUpdatedSecrets: ServerSecretPayload | undefined;

  const executeAttempt = async (forceRefresh: boolean): Promise<T> => {
    const auth = await resolveServerAuthHeaders({
      server,
      secrets: latestUpdatedSecrets ?? secrets,
      saveUpdatedSecrets,
      forceRefresh,
      fetchFn,
    });
    if (auth.updatedSecrets) {
      latestUpdatedSecrets = auth.updatedSecrets;
    }

    const session = activeSessions.get(server.id) ?? {
      transport: server.transportPreference === 'sse' ? 'sse' : 'streamable_http',
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      if (session.transport === 'streamable_http') {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...auth.headers,
        };
        if (session.sessionId) {
          headers['Mcp-Session-Id'] = session.sessionId;
        }

        const res = await fetchFn(server.url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: reqId,
            method,
            params: rpcParams ?? {},
          }),
          signal: controller.signal,
        });

        if (res.status === 401) {
          throw new McpUnauthorizedError();
        }

        // Fallback to legacy SSE if Streamable HTTP POST is rejected with 404/405/406
        if ((res.status === 404 || res.status === 405 || res.status === 406) && server.transportPreference !== 'streamable_http') {
          session.transport = 'sse';
          activeSessions.set(server.id, session);
        } else {
          if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`MCP HTTP ${res.status}: ${redactSecrets(errBody)}`);
          }

          const newSid = res.headers.get('mcp-session-id') ?? res.headers.get('Mcp-Session-Id');
          if (newSid) {
            session.sessionId = newSid;
            activeSessions.set(server.id, session);
          }

          const contentType = res.headers.get('content-type') ?? '';
          if (contentType.includes('text/event-stream')) {
            const ssePayload = await res.text();
            const parsed = parseSseJsonRpcMessage(ssePayload, reqId);
            if (!parsed) throw new Error('Empty SSE response from MCP server.');
            if (parsed.error) throw new Error(parsed.error.message);
            return parsed.result as T;
          }

          const json = (await res.json()) as JsonRpcResponse<T>;
          if (json.error) {
            throw new Error(json.error.message);
          }
          return json.result as T;
        }
      }

      // Legacy HTTP+SSE transport fallback:
      // 1) Discover message endpoint via GET SSE stream if not known yet
      let postEndpoint = session.sseEndpoint;
      if (!postEndpoint) {
        const sseController = new AbortController();
        const sseRes = await fetchFn(server.url, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...auth.headers,
          },
          signal: sseController.signal,
        });
        if (sseRes.status === 401) {
          sseController.abort();
          throw new McpUnauthorizedError();
        }
        if (!sseRes.ok || !sseRes.body) {
          sseController.abort();
          throw new Error(`SSE fallback connection failed (${sseRes.status}).`);
        }

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!postEndpoint) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const endpointMatch = buffer.match(/event:\s*endpoint\s*\r?\ndata:\s*([^\r\n]+)/i);
          if (endpointMatch) {
            const rawEp = endpointMatch[1].trim();
            postEndpoint = new URL(rawEp, server.url).toString();
            assertSecureServerUrl(postEndpoint);
            session.sseEndpoint = postEndpoint;
            session.sseAbort = sseController;
            activeSessions.set(server.id, session);
            void reader.cancel().catch(() => {});
            break;
          }
        }
        if (!postEndpoint) {
          sseController.abort();
          throw new Error('SSE stream did not emit an MCP endpoint event.');
        }
      }

      const postRes = await fetchFn(postEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...auth.headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: reqId,
          method,
          params: rpcParams ?? {},
        }),
        signal: controller.signal,
      });

      if (postRes.status === 401) {
        throw new McpUnauthorizedError();
      }
      if (!postRes.ok) {
        const errBody = await postRes.text();
        throw new Error(`MCP SSE POST ${postRes.status}: ${redactSecrets(errBody)}`);
      }
      const ct = postRes.headers.get('content-type') ?? '';
      if (ct.includes('text/event-stream')) {
        const parsed = parseSseJsonRpcMessage(await postRes.text(), reqId);
        if (!parsed) throw new Error('Empty SSE response from MCP endpoint.');
        if (parsed.error) throw new Error(parsed.error.message);
        return parsed.result as T;
      }
      const json = (await postRes.json()) as JsonRpcResponse<T>;
      if (json.error) throw new Error(json.error.message);
      return json.result as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  };

  try {
    const result = await executeAttempt(false);
    return { result, updatedSecrets: latestUpdatedSecrets };
  } catch (err) {
    // Requirement: Refresh expired OAuth token and retry once on 401
    const canRefresh =
      err instanceof McpUnauthorizedError &&
      (server.authType === 'oauth_pkce' || server.authType === 'oauth_client_credentials');
    if (canRefresh) {
      const result = await executeAttempt(true);
      return { result, updatedSecrets: latestUpdatedSecrets };
    }
    throw err;
  }
}

export async function connectAndInspectServer(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  fetchFn?: FetchLike;
}): Promise<{
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  updatedSecrets?: ServerSecretPayload;
}> {
  let latestSecrets: ServerSecretPayload | undefined;
  const track = (u?: ServerSecretPayload) => {
    if (u) latestSecrets = u;
  };

  const init = await sendMcpRpc({
    ...params,
    method: 'initialize',
    rpcParams: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'MCP Hub', version: '1.0.0' },
    },
  });
  track(init.updatedSecrets);

  const secretsToUse = latestSecrets ?? params.secrets;

  const toolsRes = await sendMcpRpc<{ tools?: McpTool[] }>({
    ...params,
    secrets: secretsToUse,
    method: 'tools/list',
  });
  track(toolsRes.updatedSecrets);

  let resources: McpResource[] = [];
  try {
    const resRes = await sendMcpRpc<{ resources?: McpResource[] }>({
      ...params,
      secrets: latestSecrets ?? secretsToUse,
      method: 'resources/list',
    });
    track(resRes.updatedSecrets);
    resources = resRes.result?.resources ?? [];
  } catch {
    resources = [];
  }

  let prompts: McpPrompt[] = [];
  try {
    const promptRes = await sendMcpRpc<{ prompts?: McpPrompt[] }>({
      ...params,
      secrets: latestSecrets ?? secretsToUse,
      method: 'prompts/list',
    });
    track(promptRes.updatedSecrets);
    prompts = promptRes.result?.prompts ?? [];
  } catch {
    prompts = [];
  }

  return {
    tools: toolsRes.result?.tools ?? [],
    resources,
    prompts,
    updatedSecrets: latestSecrets,
  };
}

export async function callMcpTool(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<{ text: string; isError: boolean; updatedSecrets?: ServerSecretPayload }> {
  const { result, updatedSecrets } = await sendMcpRpc<{
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    isError?: boolean;
  }>({
    server: params.server,
    secrets: params.secrets,
    saveUpdatedSecrets: params.saveUpdatedSecrets,
    method: 'tools/call',
    rpcParams: {
      name: params.toolName,
      arguments: params.args,
    },
    timeoutMs: params.timeoutMs ?? 25_000,
    signal: params.signal,
    fetchFn: params.fetchFn,
  });

  const blocks = result?.content ?? [];
  const text =
    blocks
      .map((b) => (b.type === 'text' ? b.text ?? '' : `[${b.type}: ${b.mimeType ?? 'binary'}]`))
      .filter(Boolean)
      .join('\n') || JSON.stringify(result ?? {});

  return {
    text,
    isError: Boolean(result?.isError),
    updatedSecrets,
  };
}

/**
 * Battery-friendly lifecycle helper: closes active SSE streams & clears transient sessions
 * when the mobile app goes to the background or unmounts.
 */
export function closeAllMcpConnections(): void {
  for (const [, session] of activeSessions.entries()) {
    session.sseAbort?.abort();
  }
  activeSessions.clear();
}
