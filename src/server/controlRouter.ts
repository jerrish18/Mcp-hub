import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { z } from 'zod';
import {
  CONTROL_ACTION_MAP,
  type ControlKeyScope,
  getActionsForScope,
  isActionAllowedForScope,
  toMcpToolsForScope,
} from '../services/control/actionsCatalog.ts';
import { handleVirtualMcpRequest } from '../services/mcp/virtualSandbox.ts';
import { redactSecrets } from '../utils/redact.ts';

export interface StoredApiKeyRecord {
  id: string;
  label: string;
  prefix: string;
  scope: ControlKeyScope;
  hashHex: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface PublicApiKeyInfo {
  id: string;
  label: string;
  prefix: string;
  scope: ControlKeyScope;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
  active: boolean;
}

export interface ControlActivityEntry {
  id: string;
  timestamp: number;
  keyId: string;
  keyLabel: string;
  keyPrefix: string;
  transport: 'rest' | 'mcp';
  action: string;
  status: 'ok' | 'denied' | 'error';
  durationMs: number;
  detail?: string;
}

export interface BridgeWorkspaceMirror {
  activeTab: 'dashboard' | 'chat' | 'servers' | 'agents' | 'settings';
  isRunning: boolean;
  hasPendingApproval: boolean;
  servers: Array<{
    id: string;
    name: string;
    url: string;
    authType: string;
    enabled: boolean;
    status: string;
    presetId?: string;
    toolsCount: number;
    disabledTools: string[];
    tools: Array<{ name: string; description?: string; readOnlyHint?: boolean }>;
  }>;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    defaultModelId: string;
    defaultEffort: string;
    isBuiltIn: boolean;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    agentId: string;
    modelId: string;
    effort: string;
    messageCount: number;
    updatedAt: number;
  }>;
  activeConversationId: string | null;
  settings: Record<string, unknown>;
  modelsCount: number;
  updatedAt: number;
}

export interface CreateControlRouterOptions {
  storageFilePath?: string;
  adminToken?: string;
}

const CreateKeySchema = z.object({
  label: z.string().trim().min(1, 'Key label is required').max(60),
  scope: z.enum(['full', 'chat_and_tools', 'read_only']).default('full'),
});

const ExecuteActionSchema = z.object({
  action: z.string().trim().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function toPublicKeyInfo(rec: StoredApiKeyRecord): PublicApiKeyInfo {
  return {
    id: rec.id,
    label: rec.label,
    prefix: rec.prefix,
    scope: rec.scope,
    createdAt: rec.createdAt,
    lastUsedAt: rec.lastUsedAt,
    revokedAt: rec.revokedAt,
    active: !rec.revokedAt,
  };
}

function defaultMirrorState(): BridgeWorkspaceMirror {
  return {
    activeTab: 'dashboard',
    isRunning: false,
    hasPendingApproval: false,
    servers: [
      {
        id: 'srv_sandbox',
        name: 'Workspace Sandbox',
        url: 'virtual://mcp-hub-sandbox',
        authType: 'none',
        enabled: true,
        status: 'connected',
        presetId: 'sandbox',
        toolsCount: 4,
        disabledTools: [],
        tools: [
          { name: 'workspace_search_notes', description: 'Search saved local notes', readOnlyHint: true },
          { name: 'calculate_expression', description: 'Evaluate arithmetic expression', readOnlyHint: true },
          { name: 'workspace_create_note', description: 'Create a workspace note', readOnlyHint: false },
          { name: 'workspace_delete_note', description: 'Delete a workspace note', readOnlyHint: false },
        ],
      },
    ],
    agents: [
      {
        id: 'agent_general',
        name: 'General Assistant',
        description: 'Balanced everyday assistant that uses connected MCP tools when helpful.',
        defaultModelId: 'gemini-4-hydrogen',
        defaultEffort: 'medium',
        isBuiltIn: true,
      },
      {
        id: 'agent_operator',
        name: 'MCP Operator',
        description: 'Careful tool-use specialist that validates parameters and verifies state changes.',
        defaultModelId: 'gemini-4-neon',
        defaultEffort: 'high',
        isBuiltIn: true,
      },
      {
        id: 'agent_researcher',
        name: 'Researcher',
        description: 'Deep synthesis specialist for multi-source reading, structured notes, and citations.',
        defaultModelId: 'qwen/qwen3-32b',
        defaultEffort: 'high',
        isBuiltIn: true,
      },
    ],
    conversations: [],
    activeConversationId: null,
    settings: {
      theme: 'system',
      accentTheme: 'pixel_blue',
      oledDark: false,
      confirmBeforeWrite: true,
      maxAgentSteps: 10,
    },
    modelsCount: 11,
    updatedAt: Date.now(),
  };
}

export function createControlRouter(options: CreateControlRouterOptions = {}): Router {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  const storageFilePath =
    options.storageFilePath ?? path.resolve(process.cwd(), '.data', 'control-keys.json');
  const configuredAdminToken = (options.adminToken ?? process.env.MCP_HUB_ADMIN_TOKEN ?? '').trim();

  const keyRecords: StoredApiKeyRecord[] = [];
  const activityLog: ControlActivityEntry[] = [];
  let workspaceMirror: BridgeWorkspaceMirror = defaultMirrorState();

  const bridgeClients = new Map<string, Response>();
  const pendingBridgeCommands = new Map<
    string,
    {
      resolve: (val: unknown) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  // Load hashed key metadata from disk if available (never stores plaintext secrets)
  if (storageFilePath) {
    try {
      if (fs.existsSync(storageFilePath)) {
        const raw = fs.readFileSync(storageFilePath, 'utf8');
        const parsed = JSON.parse(raw) as StoredApiKeyRecord[];
        if (Array.isArray(parsed)) {
          keyRecords.push(...parsed);
        }
      }
    } catch {
      // Ignore corrupt/unavailable cache file
    }
  }

  const persistKeys = () => {
    if (!storageFilePath) return;
    try {
      fs.mkdirSync(path.dirname(storageFilePath), { recursive: true });
      fs.writeFileSync(storageFilePath, JSON.stringify(keyRecords, null, 2), 'utf8');
    } catch {
      // Non-fatal in read-only containers
    }
  };

  const recordActivity = (entry: Omit<ControlActivityEntry, 'id' | 'timestamp'>) => {
    activityLog.unshift({
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...entry,
      detail: entry.detail ? redactSecrets(entry.detail) : undefined,
    });
    if (activityLog.length > 60) {
      activityLog.length = 60;
    }
  };

  // Strict same-origin + optional admin token guard for UI key management & bridge routes
  const requireUiOrigin = (req: Request, res: Response, next: NextFunction) => {
    const originHeader = req.get('origin');
    const hostHeader = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0].trim();

    if (originHeader && hostHeader) {
      try {
        const originHost = new URL(originHeader).host;
        if (originHost.toLowerCase() !== hostHeader.toLowerCase()) {
          res.status(403).json({ error: 'Cross-origin access to UI key management is forbidden.' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid Origin header.' });
        return;
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.get('x-mcphub-ui') !== '1') {
        res.status(403).json({ error: 'Missing required UI request header.' });
        return;
      }
    }

    if (configuredAdminToken) {
      const auth = req.get('authorization') ?? '';
      const token = auth.replace(/^Bearer\s+/i, '').trim();
      if (!token || !safeEqualStrings(token, configuredAdminToken)) {
        res.status(401).json({ error: 'Admin token required for key management.' });
        return;
      }
    }

    next();
  };

  interface AuthedRequest extends Request {
    controlKey?: StoredApiKeyRecord;
  }

  const authenticateApiKey = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.get('authorization') ?? '';
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    const altHeader = (req.get('x-api-key') ?? '').trim();
    const rawKey = bearer || altHeader;

    if (!rawKey) {
      res.status(401).json({
        error: 'Missing App API key. Send Authorization: Bearer <mcphub_live_...> or X-API-Key.',
      });
      return;
    }

    const presentedHashHex = sha256Hex(rawKey);
    const presentedBuf = Buffer.from(presentedHashHex, 'hex');

    let matched: StoredApiKeyRecord | undefined;
    for (const rec of keyRecords) {
      if (rec.revokedAt) continue;
      const storedBuf = Buffer.from(rec.hashHex, 'hex');
      if (storedBuf.length === presentedBuf.length && crypto.timingSafeEqual(storedBuf, presentedBuf)) {
        matched = rec;
        break;
      }
    }

    if (!matched) {
      res.status(401).json({ error: 'Invalid or revoked MCP Hub API key.' });
      return;
    }

    matched.lastUsedAt = Date.now();
    persistKeys();
    req.controlKey = matched;
    next();
  };

  const executeControlCommand = async (
    action: string,
    params: Record<string, unknown>,
    key: StoredApiKeyRecord,
    transport: 'rest' | 'mcp'
  ): Promise<{ ok: true; result: unknown } | { ok: false; status: number; error: string }> => {
    const started = Date.now();
    const def = CONTROL_ACTION_MAP.get(action);
    if (!def) {
      recordActivity({
        keyId: key.id,
        keyLabel: key.label,
        keyPrefix: key.prefix,
        transport,
        action,
        status: 'error',
        durationMs: Date.now() - started,
        detail: `Unknown action "${action}"`,
      });
      return { ok: false, status: 400, error: `Unknown control action "${action}".` };
    }

    if (!isActionAllowedForScope(action, key.scope)) {
      recordActivity({
        keyId: key.id,
        keyLabel: key.label,
        keyPrefix: key.prefix,
        transport,
        action,
        status: 'denied',
        durationMs: Date.now() - started,
        detail: `Key scope "${key.scope}" cannot invoke "${action}"`,
      });
      return {
        ok: false,
        status: 403,
        error: `API key scope "${key.scope}" is not permitted to execute "${action}".`,
      };
    }

    // Prioritize live connected browser hub when available
    const activeEntries = Array.from(bridgeClients.entries());
    if (activeEntries.length > 0) {
      const [clientId, sseRes] = activeEntries[activeEntries.length - 1];
      const requestId = `cmd_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const timeoutMs = action === 'send_chat_message' ? 45_000 : 15_000;

      try {
        const result = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingBridgeCommands.delete(requestId);
            reject(new Error(`Live browser hub timed out after ${timeoutMs}ms executing "${action}".`));
          }, timeoutMs);

          pendingBridgeCommands.set(requestId, { resolve, reject, timer });
          const payload = JSON.stringify({
            requestId,
            action,
            params,
            scope: key.scope,
          });
          sseRes.write(`event: command\ndata: ${payload}\n\n`);
        });

        recordActivity({
          keyId: key.id,
          keyLabel: key.label,
          keyPrefix: key.prefix,
          transport,
          action,
          status: 'ok',
          durationMs: Date.now() - started,
          detail: `Executed on live hub (${clientId.slice(-6)})`,
        });
        return { ok: true, result };
      } catch (err) {
        const msg = redactSecrets(err instanceof Error ? err.message : 'Live bridge error');
        recordActivity({
          keyId: key.id,
          keyLabel: key.label,
          keyPrefix: key.prefix,
          transport,
          action,
          status: 'error',
          durationMs: Date.now() - started,
          detail: msg,
        });
        return { ok: false, status: 500, error: msg };
      }
    }

    // Headless server fallback when no browser tab is open
    try {
      const result = await executeHeadlessFallback(action, params, workspaceMirror);
      recordActivity({
        keyId: key.id,
        keyLabel: key.label,
        keyPrefix: key.prefix,
        transport,
        action,
        status: 'ok',
        durationMs: Date.now() - started,
        detail: 'Executed via headless control mirror',
      });
      return { ok: true, result };
    } catch (err) {
      const msg = redactSecrets(err instanceof Error ? err.message : 'Control execution error');
      recordActivity({
        keyId: key.id,
        keyLabel: key.label,
        keyPrefix: key.prefix,
        transport,
        action,
        status: 'error',
        durationMs: Date.now() - started,
        detail: msg,
      });
      return { ok: false, status: 400, error: msg };
    }
  };

  // --- UI Management Routes (Same-Origin + Optional Admin Token) ---

  router.get('/control/keys', requireUiOrigin, (_req, res) => {
    res.json({
      adminTokenRequired: Boolean(configuredAdminToken),
      bridgeConnectedCount: bridgeClients.size,
      keys: keyRecords.map(toPublicKeyInfo),
      activity: activityLog.slice(0, 25),
    });
  });

  router.post('/control/keys', requireUiOrigin, (req, res) => {
    const parsed = CreateKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid key payload.' });
      return;
    }

    const rawSecret = `mcphub_live_${crypto.randomBytes(24).toString('base64url')}`;
    const record: StoredApiKeyRecord = {
      id: `key_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      label: parsed.data.label,
      prefix: `${rawSecret.slice(0, 17)}…`,
      scope: parsed.data.scope,
      hashHex: sha256Hex(rawSecret),
      createdAt: Date.now(),
    };

    keyRecords.unshift(record);
    persistKeys();

    res.status(201).json({
      key: toPublicKeyInfo(record),
      plaintextKey: rawSecret, // Shown once on creation
    });
  });

  router.delete('/control/keys/:id', requireUiOrigin, (req, res) => {
    const target = keyRecords.find((k) => k.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    target.revokedAt = Date.now();
    persistKeys();
    res.json({ key: toPublicKeyInfo(target) });
  });

  router.get('/control/bridge/status', (_req, res) => {
    res.json({
      adminTokenRequired: Boolean(configuredAdminToken),
    });
  });

  router.get('/control/bridge/stream', requireUiOrigin, (req, res) => {
    const clientId = `ui_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);
    bridgeClients.set(clientId, res);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      bridgeClients.delete(clientId);
    });
  });

  router.post('/control/bridge/state', requireUiOrigin, (req, res) => {
    const body = req.body as Partial<BridgeWorkspaceMirror>;
    if (body && typeof body === 'object') {
      workspaceMirror = {
        ...workspaceMirror,
        ...body,
        updatedAt: Date.now(),
      };
    }
    res.json({ ok: true, bridgeConnectedCount: bridgeClients.size });
  });

  router.post('/control/bridge/result', requireUiOrigin, (req, res) => {
    const { requestId, ok, result, error } = (req.body ?? {}) as {
      requestId?: string;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (!requestId) {
      res.status(400).json({ error: 'Missing requestId.' });
      return;
    }
    const pending = pendingBridgeCommands.get(requestId);
    if (!pending) {
      res.status(404).json({ error: 'Pending request expired or not found.' });
      return;
    }
    clearTimeout(pending.timer);
    pendingBridgeCommands.delete(requestId);

    if (ok) {
      pending.resolve(result);
    } else {
      pending.reject(new Error(error ?? 'Browser control action failed.'));
    }
    res.json({ ok: true });
  });

  // --- Authenticated External Agent REST API ---

  router.get('/control/actions', authenticateApiKey, (req: AuthedRequest, res) => {
    const key = req.controlKey!;
    res.json({
      key: toPublicKeyInfo(key),
      liveBrowserConnected: bridgeClients.size > 0,
      actions: getActionsForScope(key.scope),
    });
  });

  router.get('/control/state', authenticateApiKey, async (req: AuthedRequest, res) => {
    const outcome = await executeControlCommand('get_workspace_overview', {}, req.controlKey!, 'rest');
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.json(outcome.result);
  });

  router.post('/control/execute', authenticateApiKey, async (req: AuthedRequest, res) => {
    const parsed = ExecuteActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid control payload.' });
      return;
    }
    const outcome = await executeControlCommand(
      parsed.data.action,
      parsed.data.params,
      req.controlKey!,
      'rest'
    );
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.json({ ok: true, action: parsed.data.action, result: outcome.result });
  });

  // --- Authenticated External Agent Remote MCP Server (JSON-RPC 2.0 Streamable HTTP) ---

  const handleMcpRpc = async (req: AuthedRequest, res: Response) => {
    const key = req.controlKey!;
    const body = (req.body ?? {}) as {
      jsonrpc?: string;
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };

    const id = body.id ?? 1;
    const method = body.method ?? '';
    const params = body.params ?? {};

    if (method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'MCP Hub Remote Control Server',
            version: '1.0.0',
          },
        },
      });
      return;
    }

    if (method === 'notifications/initialized' || method === 'ping') {
      res.json({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (method === 'tools/list') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: toMcpToolsForScope(key.scope),
        },
      });
      return;
    }

    if (method === 'resources/list') {
      res.json({ jsonrpc: '2.0', id, result: { resources: [] } });
      return;
    }

    if (method === 'prompts/list') {
      res.json({ jsonrpc: '2.0', id, result: { prompts: [] } });
      return;
    }

    if (method === 'tools/call') {
      const toolName = String(params.name ?? '');
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const outcome = await executeControlCommand(toolName, toolArgs, key, 'mcp');
      if (!outcome.ok) {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: outcome.error }],
            isError: true,
          },
        });
        return;
      }
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(outcome.result, null, 2) }],
          isError: false,
        },
      });
      return;
    }

    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  };

  router.post('/control/mcp', authenticateApiKey, handleMcpRpc);
  router.post('/mcp-endpoint', authenticateApiKey, handleMcpRpc);

  return router;
}

async function executeHeadlessFallback(
  action: string,
  params: Record<string, unknown>,
  mirror: BridgeWorkspaceMirror
): Promise<unknown> {
  switch (action) {
    case 'get_workspace_overview':
      return {
        mode: 'headless_server_mirror',
        activeTab: mirror.activeTab,
        connectedServers: mirror.servers.filter((s) => s.status === 'connected').length,
        totalServers: mirror.servers.length,
        agentsCount: mirror.agents.length,
        conversationsCount: mirror.conversations.length,
        settings: mirror.settings,
      };

    case 'navigate_tab': {
      const tab = String(params.tab ?? '');
      if (!['dashboard', 'chat', 'servers', 'agents', 'settings'].includes(tab)) {
        throw new Error(`Invalid tab "${tab}".`);
      }
      mirror.activeTab = tab as BridgeWorkspaceMirror['activeTab'];
      return { activeTab: mirror.activeTab };
    }

    case 'list_servers':
      return { servers: mirror.servers };

    case 'list_agents':
      return { agents: mirror.agents };

    case 'list_conversations':
      return { conversations: mirror.conversations };

    case 'update_app_settings':
      mirror.settings = { ...mirror.settings, ...params };
      return { settings: mirror.settings };

    case 'call_mcp_tool': {
      const serverId = String(params.serverId ?? '');
      const toolName = String(params.toolName ?? '');
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      if (!serverId || serverId === 'srv_sandbox' || serverId === 'srv_virtual_sandbox') {
        const rpc = await handleVirtualMcpRequest({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: toolArgs },
        });
        if (rpc.error) {
          throw new Error((rpc.error as { message?: string }).message ?? 'Virtual sandbox call failed.');
        }
        return rpc.result;
      }
      throw new Error(
        `Server "${serverId}" requires an open MCP Hub browser/device session with unlocked local credentials.`
      );
    }

    default:
      throw new Error(
        `Action "${action}" requires an active MCP Hub app session open in a browser or device.`
      );
  }
}
