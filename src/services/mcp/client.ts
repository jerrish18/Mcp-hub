import type {
  McpPrompt,
  McpResource,
  McpServerConfig,
  McpTool,
  ServerSecretPayload,
  ToolMediaBlock,
} from '../../types';
import { assertSecureServerUrl, redactSecrets } from '../../utils/redact';
import { type FetchLike, resolveServerAuthHeaders } from '../auth/oauth';
import { handleGithubVirtualMcp, handleYoutubeVirtualMcp } from './virtualConnectors';
import { handleVirtualMcpRequest } from './virtualSandbox';

export const SUPPORTED_MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
export type SupportedMcpProtocolVersion = (typeof SUPPORTED_MCP_PROTOCOL_VERSIONS)[number];

export interface JsonRpcMessage<T = unknown> {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpProgressUpdate {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export type McpListChangedKind = 'tools' | 'resources' | 'prompts';

export interface McpSessionState {
  sessionId?: string;
  protocolVersion?: string;
  transport: 'streamable_http' | 'sse';
  sseEndpoint?: string;
  sseAbort?: AbortController;
  serverUrl?: string;
  authHeaders?: Record<string, string>;
}

const activeSessions = new Map<string, McpSessionState>();
const listChangedListeners = new Set<(serverId: string, kind: McpListChangedKind) => void>();
let rpcSeq = 1;

export function onMcpListChanged(
  listener: (serverId: string, kind: McpListChangedKind) => void
): () => void {
  listChangedListeners.add(listener);
  return () => {
    listChangedListeners.delete(listener);
  };
}

function emitListChanged(serverId: string, kind: McpListChangedKind): void {
  for (const listener of listChangedListeners) {
    try {
      listener(serverId, kind);
    } catch {
      // ignore listener errors
    }
  }
}

export function getActiveMcpSession(serverId: string): McpSessionState | undefined {
  return activeSessions.get(serverId);
}

export function parseSseJsonRpcMessages(sseText: string): JsonRpcMessage[] {
  const blocks = sseText.split(/\r?\n\r?\n/);
  const messages: JsonRpcMessage[] = [];
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
      const parsed = JSON.parse(raw) as JsonRpcMessage;
      messages.push(parsed);
    } catch {
      // ignore non-JSON SSE frames
    }
  }
  return messages;
}

export function parseSseJsonRpcMessage(
  sseText: string,
  expectedId?: string | number
): JsonRpcMessage | null {
  const msgs = parseSseJsonRpcMessages(sseText);
  if (expectedId !== undefined) {
    const exact = msgs.find((m) => m.id === expectedId);
    if (exact) return exact;
  }
  return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}

function dispatchNotificationFrame(
  msg: JsonRpcMessage,
  serverId: string,
  onProgress?: (update: McpProgressUpdate) => void,
  onListChanged?: (kind: McpListChangedKind) => void
): void {
  if (!msg.method) return;
  if (msg.method === 'notifications/progress' && msg.params) {
    const progress = Number(msg.params.progress);
    const total = msg.params.total !== undefined ? Number(msg.params.total) : undefined;
    const token = msg.params.progressToken as string | number | undefined;
    const message = typeof msg.params.message === 'string' ? msg.params.message : undefined;
    if (token !== undefined && Number.isFinite(progress)) {
      onProgress?.({
        progressToken: token,
        progress,
        total: total !== undefined && Number.isFinite(total) ? total : undefined,
        message,
      });
    }
  } else if (msg.method === 'notifications/tools/list_changed') {
    onListChanged?.('tools');
    emitListChanged(serverId, 'tools');
  } else if (msg.method === 'notifications/resources/list_changed') {
    onListChanged?.('resources');
    emitListChanged(serverId, 'resources');
  } else if (msg.method === 'notifications/prompts/list_changed') {
    onListChanged?.('prompts');
    emitListChanged(serverId, 'prompts');
  }
}

async function readSseRpcResponse<T>(
  res: Response,
  expectedId: number,
  serverId: string,
  onProgress?: (update: McpProgressUpdate) => void,
  onListChanged?: (kind: McpListChangedKind) => void
): Promise<T> {
  if (!res.body) {
    const text = await res.text();
    const msgs = parseSseJsonRpcMessages(text);
    for (const m of msgs) {
      if (m.method && m.id === undefined) {
        dispatchNotificationFrame(m, serverId, onProgress, onListChanged);
      }
    }
    const target = parseSseJsonRpcMessage(text, expectedId);
    if (!target) throw new Error('Empty SSE response from MCP server.');
    if (target.error) throw new Error(target.error.message);
    return target.result as T;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastFallback: JsonRpcMessage | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const block of parts) {
        const msgs = parseSseJsonRpcMessages(block);
        for (const msg of msgs) {
          if (msg.method && msg.id === undefined) {
            dispatchNotificationFrame(msg, serverId, onProgress, onListChanged);
            continue;
          }
          lastFallback = msg;
          if (msg.id === expectedId) {
            void reader.cancel().catch(() => {});
            if (msg.error) throw new Error(msg.error.message);
            return msg.result as T;
          }
        }
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const tailMsgs = parseSseJsonRpcMessages(buffer);
    for (const msg of tailMsgs) {
      if (msg.method && msg.id === undefined) {
        dispatchNotificationFrame(msg, serverId, onProgress, onListChanged);
        continue;
      }
      lastFallback = msg;
      if (msg.id === expectedId) {
        if (msg.error) throw new Error(msg.error.message);
        return msg.result as T;
      }
    }
  }

  if (!lastFallback) {
    throw new Error('Empty SSE response from MCP server.');
  }
  if (lastFallback.error) throw new Error(lastFallback.error.message);
  return lastFallback.result as T;
}

export class McpUnauthorizedError extends Error {
  constructor(message = 'MCP server returned 401 Unauthorized') {
    super(message);
    this.name = 'McpUnauthorizedError';
  }
}

export class McpSessionExpiredError extends Error {
  constructor() {
    super('MCP session expired');
    this.name = 'McpSessionExpiredError';
  }
}

async function sendCancellationBestEffort(params: {
  server: McpServerConfig;
  session: McpSessionState;
  authHeaders: Record<string, string>;
  requestId: number;
  reason: string;
  fetchFn: FetchLike;
}): Promise<void> {
  const { server, session, authHeaders, requestId, reason, fetchFn } = params;
  if (server.url.startsWith('virtual://')) return;
  const targetUrl = session.transport === 'sse' && session.sseEndpoint ? session.sseEndpoint : server.url;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  if (session.protocolVersion) headers['MCP-Protocol-Version'] = session.protocolVersion;
  try {
    await fetchFn(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId, reason },
      }),
    });
  } catch {
    // best-effort notification
  }
}

export async function sendMcpRpc<T = unknown>(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  method: string;
  rpcParams?: Record<string, unknown>;
  isNotification?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (update: McpProgressUpdate) => void;
  onListChanged?: (kind: McpListChangedKind) => void;
  fetchFn?: FetchLike;
}): Promise<{ result: T; updatedSecrets?: ServerSecretPayload; requestId: number }> {
  const {
    server,
    secrets,
    saveUpdatedSecrets,
    method,
    rpcParams,
    isNotification = false,
    timeoutMs = 20_000,
    signal,
    onProgress,
    onListChanged,
    fetchFn = fetch,
  } = params;

  assertSecureServerUrl(server.url);
  const reqId = rpcSeq++;

  if (server.url === 'virtual://youtube-data-api') {
    const res = (await handleYoutubeVirtualMcp({
      id: reqId,
      method,
      rpcParams,
      secrets,
      fetchFn,
    })) as unknown as JsonRpcMessage<T>;
    if (res.error) throw new Error(res.error.message);
    return { result: res.result as T, requestId: reqId };
  }

  if (server.url === 'virtual://github-api') {
    const res = (await handleGithubVirtualMcp({
      id: reqId,
      method,
      rpcParams,
      secrets,
      fetchFn,
    })) as unknown as JsonRpcMessage<T>;
    if (res.error) throw new Error(res.error.message);
    return { result: res.result as T, requestId: reqId };
  }

  if (server.url.startsWith('virtual://')) {
    const res = (await handleVirtualMcpRequest({
      jsonrpc: '2.0',
      id: reqId,
      method,
      params: rpcParams,
    })) as unknown as JsonRpcMessage<T>;
    if (res.error) {
      throw new Error(res.error.message);
    }
    return { result: res.result as T, requestId: reqId };
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

    const session: McpSessionState = activeSessions.get(server.id) ?? {
      transport: server.transportPreference === 'sse' ? 'sse' : 'streamable_http',
      protocolVersion: server.protocolVersion,
      serverUrl: server.url,
    };
    session.serverUrl = server.url;
    session.authHeaders = auth.headers;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => {
      controller.abort();
      if (!isNotification) {
        void sendCancellationBestEffort({
          server,
          session,
          authHeaders: auth.headers,
          requestId: reqId,
          reason: 'Aborted by client',
          fetchFn,
        });
      }
    };
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    const rpcBody: Record<string, unknown> = isNotification
      ? { jsonrpc: '2.0', method, params: rpcParams ?? {} }
      : { jsonrpc: '2.0', id: reqId, method, params: rpcParams ?? {} };

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
        if (method !== 'initialize' && session.protocolVersion) {
          headers['MCP-Protocol-Version'] = session.protocolVersion;
        }

        const res = await fetchFn(server.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(rpcBody),
          signal: controller.signal,
        });

        if (res.status === 401) {
          throw new McpUnauthorizedError();
        }

        // Stale session recovery: clear cached Mcp-Session-Id on 404/410 and retry cleanly once
        if ((res.status === 404 || res.status === 410) && session.sessionId) {
          activeSessions.delete(server.id);
          throw new McpSessionExpiredError();
        }

        // Fallback to legacy SSE if Streamable HTTP POST is rejected with 404/405/406
        if (
          (res.status === 404 || res.status === 405 || res.status === 406) &&
          server.transportPreference !== 'streamable_http'
        ) {
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

          if (res.status === 202 || res.status === 204) {
            return {} as T;
          }

          const contentType = res.headers.get('content-type') ?? '';
          if (contentType.includes('text/event-stream')) {
            return await readSseRpcResponse<T>(res, reqId, server.id, onProgress, onListChanged);
          }

          const text = await res.text();
          if (!text.trim()) return {} as T;
          const json = JSON.parse(text) as JsonRpcMessage<T>;
          if (json.error) {
            throw new Error(json.error.message);
          }
          return json.result as T;
        }
      }

      // Legacy HTTP+SSE transport fallback:
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

      const ssePostHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...auth.headers,
      };
      if (method !== 'initialize' && session.protocolVersion) {
        ssePostHeaders['MCP-Protocol-Version'] = session.protocolVersion;
      }

      const postRes = await fetchFn(postEndpoint, {
        method: 'POST',
        headers: ssePostHeaders,
        body: JSON.stringify(rpcBody),
        signal: controller.signal,
      });

      if (postRes.status === 401) {
        throw new McpUnauthorizedError();
      }
      if (!postRes.ok) {
        const errBody = await postRes.text();
        throw new Error(`MCP SSE POST ${postRes.status}: ${redactSecrets(errBody)}`);
      }
      if (postRes.status === 202 || postRes.status === 204) {
        return {} as T;
      }
      const ct = postRes.headers.get('content-type') ?? '';
      if (ct.includes('text/event-stream')) {
        return await readSseRpcResponse<T>(postRes, reqId, server.id, onProgress, onListChanged);
      }
      const text = await postRes.text();
      if (!text.trim()) return {} as T;
      const json = JSON.parse(text) as JsonRpcMessage<T>;
      if (json.error) throw new Error(json.error.message);
      return json.result as T;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  };

  try {
    const result = await executeAttempt(false);
    return { result, updatedSecrets: latestUpdatedSecrets, requestId: reqId };
  } catch (err) {
    if (err instanceof McpSessionExpiredError) {
      const result = await executeAttempt(false);
      return { result, updatedSecrets: latestUpdatedSecrets, requestId: reqId };
    }
    const canRefresh =
      err instanceof McpUnauthorizedError &&
      (server.authType === 'oauth_pkce' || server.authType === 'oauth_client_credentials');
    if (canRefresh) {
      const result = await executeAttempt(true);
      return { result, updatedSecrets: latestUpdatedSecrets, requestId: reqId };
    }
    if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
      throw new Error(
        `Network or browser CORS block reaching ${server.url}. Verify HTTPS availability or use Direct API mode / Expo mobile client.`,
        { cause: err }
      );
    }
    throw err;
  }
}

export async function connectAndInspectServer(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  onListChanged?: (kind: McpListChangedKind) => void;
  fetchFn?: FetchLike;
}): Promise<{
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  protocolVersion: string;
  latencyMs: number;
  updatedSecrets?: ServerSecretPayload;
}> {
  const started = Date.now();
  let latestSecrets: ServerSecretPayload | undefined;
  const track = (u?: ServerSecretPayload) => {
    if (u) latestSecrets = u;
  };

  // Negotiate latest MCP protocol version (2025-06-18), falling back to 2025-03-26 cleanly
  let initResult: { protocolVersion?: string } | undefined;
  let negotiatedVersion: string = SUPPORTED_MCP_PROTOCOL_VERSIONS[0];

  try {
    const init = await sendMcpRpc<{ protocolVersion?: string }>({
      ...params,
      method: 'initialize',
      rpcParams: {
        protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: {}, resources: {}, prompts: {} },
        clientInfo: { name: 'MCP Hub', version: '1.1.0' },
      },
    });
    track(init.updatedSecrets);
    initResult = init.result;
    if (initResult?.protocolVersion) {
      negotiatedVersion = initResult.protocolVersion;
    }
  } catch (err) {
    // Retry initialize with 2025-03-26 only if server rejected 2025-06-18 (not auth/network failures)
    if (err instanceof McpUnauthorizedError) throw err;
    const fallbackInit = await sendMcpRpc<{ protocolVersion?: string }>({
      ...params,
      secrets: latestSecrets ?? params.secrets,
      method: 'initialize',
      rpcParams: {
        protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSIONS[1],
        capabilities: {},
        clientInfo: { name: 'MCP Hub', version: '1.1.0' },
      },
    });
    track(fallbackInit.updatedSecrets);
    negotiatedVersion = fallbackInit.result?.protocolVersion || SUPPORTED_MCP_PROTOCOL_VERSIONS[1];
  }

  const existingSession = activeSessions.get(params.server.id);
  if (existingSession) {
    existingSession.protocolVersion = negotiatedVersion;
    activeSessions.set(params.server.id, existingSession);
  } else {
    activeSessions.set(params.server.id, {
      transport: params.server.transportPreference === 'sse' ? 'sse' : 'streamable_http',
      protocolVersion: negotiatedVersion,
      serverUrl: params.server.url,
    });
  }

  const secretsToUse = latestSecrets ?? params.secrets;

  // Send MCP initialized notification (best-effort)
  try {
    const notifyRes = await sendMcpRpc({
      ...params,
      secrets: secretsToUse,
      method: 'notifications/initialized',
      isNotification: true,
    });
    track(notifyRes.updatedSecrets);
  } catch {
    // Some stateless MCP proxies do not return JSON for notifications/initialized
  }

  const toolsRes = await sendMcpRpc<{ tools?: McpTool[] }>({
    ...params,
    secrets: secretsToUse,
    method: 'tools/list',
  });
  track(toolsRes.updatedSecrets);

  let resources: McpResource[];
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

  let prompts: McpPrompt[];
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
    protocolVersion: negotiatedVersion,
    latencyMs: Math.max(1, Date.now() - started),
    updatedSecrets: latestSecrets,
  };
}

export async function readMcpResource(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  uri: string;
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<{
  contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  textSummary: string;
  updatedSecrets?: ServerSecretPayload;
}> {
  const { result, updatedSecrets } = await sendMcpRpc<{
    contents?: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }>;
  }>({
    server: params.server,
    secrets: params.secrets,
    saveUpdatedSecrets: params.saveUpdatedSecrets,
    method: 'resources/read',
    rpcParams: { uri: params.uri },
    signal: params.signal,
    fetchFn: params.fetchFn,
  });

  const contents = result?.contents ?? [];
  const textSummary =
    contents
      .map((c) => {
        if (c.text) return c.text;
        if (c.blob) return `[Binary resource ${c.mimeType ?? 'application/octet-stream'}, ${c.blob.length} base64 chars]`;
        return `[Resource ${c.uri}]`;
      })
      .join('\n\n') || '[Empty resource]';

  return { contents, textSummary, updatedSecrets };
}

export async function getMcpPrompt(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  name: string;
  arguments?: Record<string, string>;
  signal?: AbortSignal;
  fetchFn?: FetchLike;
}): Promise<{
  description?: string;
  messages: Array<{
    role: string;
    content: { type: string; text?: string } | Array<{ type: string; text?: string }>;
  }>;
  composedText: string;
  updatedSecrets?: ServerSecretPayload;
}> {
  const { result, updatedSecrets } = await sendMcpRpc<{
    description?: string;
    messages?: Array<{
      role: string;
      content: { type: string; text?: string } | Array<{ type: string; text?: string }>;
    }>;
  }>({
    server: params.server,
    secrets: params.secrets,
    saveUpdatedSecrets: params.saveUpdatedSecrets,
    method: 'prompts/get',
    rpcParams: {
      name: params.name,
      arguments: params.arguments ?? {},
    },
    signal: params.signal,
    fetchFn: params.fetchFn,
  });

  const messages = result?.messages ?? [];
  const composedText = messages
    .map((m) => {
      const blocks = Array.isArray(m.content) ? m.content : [m.content];
      return blocks
        .map((b) => (b?.type === 'text' ? b.text ?? '' : ''))
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  return {
    description: result?.description,
    messages,
    composedText,
    updatedSecrets,
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
  onProgress?: (update: McpProgressUpdate) => void;
  onListChanged?: (kind: McpListChangedKind) => void;
  fetchFn?: FetchLike;
}): Promise<{
  text: string;
  mediaBlocks: ToolMediaBlock[];
  structuredContent?: unknown;
  isError: boolean;
  updatedSecrets?: ServerSecretPayload;
}> {
  const progressToken = `prog_${Date.now()}_${rpcSeq}`;
  const { result, updatedSecrets } = await sendMcpRpc<{
    content?: Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
      uri?: string;
    }>;
    structuredContent?: unknown;
    isError?: boolean;
  }>({
    server: params.server,
    secrets: params.secrets,
    saveUpdatedSecrets: params.saveUpdatedSecrets,
    method: 'tools/call',
    rpcParams: {
      name: params.toolName,
      arguments: params.args,
      _meta: { progressToken },
    },
    timeoutMs: params.timeoutMs ?? 25_000,
    signal: params.signal,
    onProgress: params.onProgress,
    onListChanged: params.onListChanged,
    fetchFn: params.fetchFn,
  });

  const blocks = result?.content ?? [];
  const mediaBlocks: ToolMediaBlock[] = [];
  for (const b of blocks) {
    if ((b.type === 'image' || b.type === 'audio') && (b.data || b.uri)) {
      mediaBlocks.push({
        type: b.type,
        data: b.data,
        uri: b.uri,
        mimeType: b.mimeType ?? (b.type === 'image' ? 'image/png' : 'audio/mpeg'),
      });
    }
  }

  const textParts = blocks
    .map((b) => (b.type === 'text' ? b.text ?? '' : `[${b.type}: ${b.mimeType ?? 'binary'}]`))
    .filter(Boolean);

  if (result?.structuredContent !== undefined && textParts.length === 0) {
    textParts.push(JSON.stringify(result.structuredContent, null, 2));
  }

  const text = textParts.join('\n') || JSON.stringify(result ?? {});

  return {
    text,
    mediaBlocks,
    structuredContent: result?.structuredContent,
    isError: Boolean(result?.isError),
    updatedSecrets,
  };
}

export async function pingMcpServer(params: {
  server: McpServerConfig;
  secrets: ServerSecretPayload;
  saveUpdatedSecrets?: (updated: ServerSecretPayload) => Promise<void>;
  timeoutMs?: number;
  fetchFn?: FetchLike;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await sendMcpRpc({
      server: params.server,
      secrets: params.secrets,
      saveUpdatedSecrets: params.saveUpdatedSecrets,
      method: 'ping',
      timeoutMs: params.timeoutMs ?? 8_000,
      fetchFn: params.fetchFn,
    });
    return { ok: true, latencyMs: Math.max(1, Date.now() - started) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - started),
      error: err instanceof Error ? err.message : 'Ping failed',
    };
  }
}

export async function reconnectWithBackoff<T>(
  attemptFn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 400);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await attemptFn();
    } catch (err) {
      lastError = err;
      if (err instanceof McpUnauthorizedError) throw err;
      if (attempt === maxAttempts - 1 || options.signal?.aborted) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        options.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true }
        );
      });
    }
  }
  throw lastError;
}

export async function disconnectMcpServer(
  serverId: string,
  fetchFn: FetchLike = fetch
): Promise<void> {
  const session = activeSessions.get(serverId);
  if (!session) return;
  activeSessions.delete(serverId);
  session.sseAbort?.abort();

  if (session.sessionId && session.serverUrl && !session.serverUrl.startsWith('virtual://')) {
    const headers: Record<string, string> = {
      'Mcp-Session-Id': session.sessionId,
      ...(session.authHeaders ?? {}),
    };
    if (session.protocolVersion) {
      headers['MCP-Protocol-Version'] = session.protocolVersion;
    }
    try {
      await fetchFn(session.serverUrl, { method: 'DELETE', headers });
    } catch {
      // best-effort session teardown
    }
  }
}

/**
 * Battery-friendly lifecycle helper: sends HTTP DELETE for active Mcp-Session-Id
 * sessions, closes active SSE streams, and clears transient sessions.
 */
export function closeAllMcpConnections(fetchFn: FetchLike = fetch): void {
  const entries = Array.from(activeSessions.entries());
  activeSessions.clear();
  for (const [, session] of entries) {
    session.sseAbort?.abort();
    if (session.sessionId && session.serverUrl && !session.serverUrl.startsWith('virtual://')) {
      const headers: Record<string, string> = {
        'Mcp-Session-Id': session.sessionId,
        ...(session.authHeaders ?? {}),
      };
      if (session.protocolVersion) {
        headers['MCP-Protocol-Version'] = session.protocolVersion;
      }
      void fetchFn(session.serverUrl, { method: 'DELETE', headers }).catch(() => {});
    }
  }
}
