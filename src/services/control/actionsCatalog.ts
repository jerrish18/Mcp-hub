import type { McpTool } from '../../types/index.ts';

export type ControlKeyScope = 'full' | 'chat_and_tools' | 'read_only';
export type ActionPrivilegeTier = 'read' | 'chat_and_tools' | 'admin';

export interface ControlActionDefinition {
  name: string;
  title: string;
  description: string;
  tier: ActionPrivilegeTier;
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  inputSchema: Record<string, unknown>;
}

export const CONTROL_ACTIONS: ControlActionDefinition[] = [
  {
    name: 'get_workspace_overview',
    title: 'Get Workspace Overview',
    description:
      'Returns live workspace telemetry: active tab, connected servers, active MCP tool count, agents, saved chats, and model settings.',
    tier: 'read',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'navigate_tab',
    title: 'Navigate App Tab',
    description: 'Switch the active screen in MCP Hub (dashboard, chat, servers, agents, or settings).',
    tier: 'chat_and_tools',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          enum: ['dashboard', 'chat', 'servers', 'agents', 'settings'],
          description: 'Destination screen tab ID',
        },
      },
      required: ['tab'],
    },
  },
  {
    name: 'list_servers',
    title: 'List MCP Servers',
    description: 'List all configured MCP servers, connection statuses, endpoints, and tools (with enabled/disabled state).',
    tier: 'read',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_or_update_server',
    title: 'Add or Update MCP Server',
    description: 'Create or update an MCP server connection configuration and optionally connect to inspect its tools.',
    tier: 'admin',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional existing server ID to update' },
        name: { type: 'string', description: 'Display name of the MCP server' },
        url: { type: 'string', description: 'HTTPS, localhost, or virtual:// server URL' },
        authType: {
          type: 'string',
          enum: ['none', 'bearer', 'custom_headers', 'basic', 'oauth_pkce', 'oauth_client_credentials'],
        },
        bearerToken: { type: 'string', description: 'Optional API key or Bearer token for bearer auth' },
        enabled: { type: 'boolean', description: 'Whether the server is enabled for agent use' },
        connectNow: { type: 'boolean', description: 'Immediately connect and inspect tools after saving' },
      },
      required: ['name', 'url'],
    },
  },
  {
    name: 'connect_server',
    title: 'Connect / Test MCP Server',
    description: 'Connect or reconnect an MCP server by serverId or presetId (sandbox, youtube, github, canva) and refresh its tool list.',
    tier: 'chat_and_tools',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Server ID (e.g. srv_virtual_sandbox, srv_youtube, srv_github, srv_canva)' },
      },
      required: ['serverId'],
    },
  },
  {
    name: 'delete_server',
    title: 'Delete MCP Server',
    description: 'Remove a configured MCP server and purge its encrypted credentials.',
    tier: 'admin',
    readOnlyHint: false,
    destructiveHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Server ID to delete' },
      },
      required: ['serverId'],
    },
  },
  {
    name: 'toggle_server_tool',
    title: 'Toggle Server Tool',
    description: 'Enable or disable a specific tool on an MCP server.',
    tier: 'admin',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Server ID' },
        toolName: { type: 'string', description: 'Exact tool name to toggle' },
      },
      required: ['serverId', 'toolName'],
    },
  },
  {
    name: 'call_mcp_tool',
    title: 'Call MCP Tool',
    description: 'Execute any tool on a connected MCP server inside MCP Hub and return the raw tool output.',
    tier: 'chat_and_tools',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Target server ID (e.g. srv_virtual_sandbox, srv_youtube, srv_github)' },
        toolName: { type: 'string', description: 'Tool name to execute' },
        arguments: { type: 'object', description: 'Tool arguments JSON object' },
      },
      required: ['serverId', 'toolName'],
    },
  },
  {
    name: 'list_agents',
    title: 'List Agents',
    description: 'List all built-in and custom agent profiles configured in MCP Hub.',
    tier: 'read',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_or_update_agent',
    title: 'Create or Update Agent',
    description: 'Create or modify an agent profile including its system prompt, default model, effort, and server/tool allowlists.',
    tier: 'admin',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional existing agent ID to update' },
        name: { type: 'string', description: 'Agent display name' },
        description: { type: 'string', description: 'Short role summary' },
        systemPrompt: { type: 'string', description: 'System instructions for the agent' },
        defaultModelId: { type: 'string', description: 'Default model ID' },
        defaultEffort: { type: 'string', enum: ['low', 'medium', 'high'] },
        allowedServerIds: { type: ['array', 'null'], items: { type: 'string' } },
        allowedToolNames: { type: ['array', 'null'], items: { type: 'string' } },
      },
      required: ['name', 'systemPrompt'],
    },
  },
  {
    name: 'delete_agent',
    title: 'Delete Custom Agent',
    description: 'Delete a user-created custom agent profile (built-in agents are protected).',
    tier: 'admin',
    readOnlyHint: false,
    destructiveHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Custom agent ID to delete' },
      },
      required: ['agentId'],
    },
  },
  {
    name: 'list_conversations',
    title: 'List Conversations',
    description: 'List saved local conversations with titles, active model, message count, and timestamps.',
    tier: 'read',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max conversations to return (default 20)' },
      },
    },
  },
  {
    name: 'get_conversation',
    title: 'Get Conversation Messages',
    description: 'Fetch messages and tool calls for a specific conversation ID (defaults to active conversation).',
    tier: 'read',
    readOnlyHint: true,
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: 'Conversation ID (omit for active conversation)' },
      },
    },
  },
  {
    name: 'start_new_conversation',
    title: 'Start New Conversation',
    description: 'Create and select a fresh chat conversation with an optional agent and model override.',
    tier: 'chat_and_tools',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Optional agent ID' },
        modelId: { type: 'string', description: 'Optional model ID' },
      },
    },
  },
  {
    name: 'send_chat_message',
    title: 'Send Chat Message & Run Agent Loop',
    description:
      'Send a prompt to an MCP Hub agent, execute connected MCP tools in a loop, and return the completed assistant response and tool calls.',
    tier: 'chat_and_tools',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Prompt text to send' },
        conversationId: { type: 'string', description: 'Optional existing conversation ID' },
        agentId: { type: 'string', description: 'Optional agent ID override' },
        modelId: { type: 'string', description: 'Optional model ID override' },
        effort: { type: 'string', enum: ['low', 'medium', 'high'] },
        autoApproveWrites: {
          type: 'boolean',
          description: 'Only honored for Full Control keys when bypassing write confirmation prompts',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'stop_active_run',
    title: 'Stop Active Agent Run',
    description: 'Immediately cancel any active streaming generation or agent tool loop.',
    tier: 'chat_and_tools',
    readOnlyHint: false,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'resolve_pending_approval',
    title: 'Resolve Write Approval',
    description: 'Approve, always-allow, or deny a pending write-action confirmation prompt in chat.',
    tier: 'admin',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['approve', 'always_allow', 'deny'] },
      },
      required: ['decision'],
    },
  },
  {
    name: 'list_models',
    title: 'List Available Models',
    description: 'List built-in free-tier models plus any synced or custom model slugs.',
    tier: 'read',
    readOnlyHint: true,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_app_settings',
    title: 'Update App Settings',
    description: 'Update theme, Pixel Material You accent palette, OLED dark mode, write confirmation, maxSteps, or haptics.',
    tier: 'admin',
    readOnlyHint: false,
    inputSchema: {
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['system', 'light', 'dark'] },
        accentTheme: { type: 'string', enum: ['pixel_blue', 'sage', 'clay', 'lavender', 'monochrome'] },
        oledDark: { type: 'boolean' },
        confirmBeforeWrite: { type: 'boolean' },
        maxAgentSteps: { type: 'number' },
        hapticsEnabled: { type: 'boolean' },
        biometricLockEnabled: { type: 'boolean' },
      },
    },
  },
];

export const CONTROL_ACTION_MAP = new Map<string, ControlActionDefinition>(
  CONTROL_ACTIONS.map((a) => [a.name, a])
);

export function isActionAllowedForScope(actionName: string, scope: ControlKeyScope): boolean {
  const def = CONTROL_ACTION_MAP.get(actionName);
  if (!def) return false;
  if (scope === 'full') return true;
  if (scope === 'read_only') return def.tier === 'read';
  return def.tier === 'read' || def.tier === 'chat_and_tools';
}

export function getActionsForScope(scope: ControlKeyScope): ControlActionDefinition[] {
  return CONTROL_ACTIONS.filter((a) => isActionAllowedForScope(a.name, scope));
}

export function toMcpToolsForScope(scope: ControlKeyScope): McpTool[] {
  return getActionsForScope(scope).map((a) => ({
    name: a.name,
    description: a.description,
    inputSchema: a.inputSchema,
    annotations: {
      title: a.title,
      readOnlyHint: a.readOnlyHint,
      destructiveHint: a.destructiveHint ?? false,
    },
  }));
}
