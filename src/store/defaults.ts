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
};

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
