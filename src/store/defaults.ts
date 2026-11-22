import { CONNECTOR_PRESETS } from '../config/connectors';
import { GITHUB_TOOLS, YOUTUBE_TOOLS } from '../services/mcp/virtualConnectors';
import type { AgentProfile, AppSettings, McpServerConfig } from '../types';

export const BUILT_IN_AGENTS: AgentProfile[] = [
  {
    id: 'agent_general',
    name: 'General Assistant',
    icon: 'compass',
    description: 'Balanced everyday assistant that uses connected MCP tools when helpful.',
    systemPrompt:
      'You are General Assistant inside MCP Hub. Answer clearly and concisely. When connected MCP tools can retrieve live facts or perform requested tasks, invoke them accurately and summarize the results.',
    defaultModelId: 'gemini-4-hydrogen',
    defaultEffort: 'medium',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'agent_operator',
    name: 'MCP Operator',
    icon: 'terminal',
    description: 'Careful tool-use specialist that validates parameters and verifies state changes.',
    systemPrompt:
      'You are MCP Operator, a careful tool-execution specialist. Always inspect available MCP tool schemas before calling a tool, prefer read-only checks before write operations, explain what write action you are about to perform, and verify outcomes after execution.',
    defaultModelId: 'gemini-4-neon',
    defaultEffort: 'high',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'agent_researcher',
    name: 'Researcher',
    icon: 'book-open',
    description: 'Deep synthesis specialist for multi-source reading, structured notes, and citations.',
    systemPrompt:
      'You are Researcher. Gather evidence systematically from connected MCP resources and tools, cross-check figures, highlight uncertainties explicitly, and structure final findings with clear headings and bullet points.',
    defaultModelId: 'qwen/qwen3-32b',
    defaultEffort: 'high',
    allowedServerIds: null,
    allowedToolNames: null,
    isBuiltIn: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

export const DEFAULT_SANDBOX_SERVER: McpServerConfig = {
  id: 'srv_sandbox',
  name: 'Workspace Sandbox',
  url: 'virtual://mcp-hub-sandbox',
  authType: 'none',
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: [],
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'sandbox',
};

export const YOUTUBE_DEFAULT_SERVER: McpServerConfig = {
  id: CONNECTOR_PRESETS.youtube.serverId,
  name: CONNECTOR_PRESETS.youtube.name,
  url: CONNECTOR_PRESETS.youtube.defaultUrl,
  authType: CONNECTOR_PRESETS.youtube.defaultAuthType,
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: YOUTUBE_TOOLS,
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'youtube',
  docsUrl: CONNECTOR_PRESETS.youtube.keyUrl,
};

export const GITHUB_DEFAULT_SERVER: McpServerConfig = {
  id: CONNECTOR_PRESETS.github.serverId,
  name: CONNECTOR_PRESETS.github.name,
  url: CONNECTOR_PRESETS.github.defaultUrl,
  authType: CONNECTOR_PRESETS.github.defaultAuthType,
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: GITHUB_TOOLS,
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'github',
  docsUrl: CONNECTOR_PRESETS.github.keyUrl,
};

export const CANVA_DEFAULT_SERVER: McpServerConfig = {
  id: CONNECTOR_PRESETS.canva.serverId,
  name: CONNECTOR_PRESETS.canva.name,
  url: CONNECTOR_PRESETS.canva.defaultUrl,
  authType: CONNECTOR_PRESETS.canva.defaultAuthType,
  enabled: true,
  transportPreference: 'auto',
  status: 'disconnected',
  tools: [],
  resources: [],
  prompts: [],
  disabledTools: [],
  presetId: 'canva',
  docsUrl: CONNECTOR_PRESETS.canva.keyUrl,
};

export const DEFAULT_SERVERS: McpServerConfig[] = [
  DEFAULT_SANDBOX_SERVER,
  YOUTUBE_DEFAULT_SERVER,
  GITHUB_DEFAULT_SERVER,
  CANVA_DEFAULT_SERVER,
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  accentTheme: 'pixel_blue',
  oledDark: false,
  confirmBeforeWrite: true,
  maxAgentSteps: 10,
  alwaysAllowedTools: [],
  biometricLockEnabled: false,
  hapticsEnabled: true,
  onboardingCompleted: false,
};
