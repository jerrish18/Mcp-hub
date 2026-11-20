import { z } from 'zod';

export const AuthTypeSchema = z.enum([
  'none',
  'bearer',
  'custom_headers',
  'basic',
  'oauth_pkce',
  'oauth_client_credentials',
]);

export type AuthType = z.infer<typeof AuthTypeSchema>;

export const EffortLevelSchema = z.enum(['low', 'medium', 'high']);
export type EffortLevel = z.infer<typeof EffortLevelSchema>;

export const ProviderIdSchema = z.enum(['gemini', 'groq', 'openrouter', 'demo']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export interface ModelConfig {
  id: string;
  provider: ProviderId;
  label: string;
  description: string;
  contextWindow: number;
  supportsThinkingLevel?: boolean;
  supportsReasoningEffort?: boolean;
  isFreeTier: boolean;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export type ServerStatus = 'connected' | 'disconnected' | 'auth_expired' | 'error' | 'connecting';

export interface OAuthMetadata {
  issuer?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number; // epoch ms
  scope?: string;
}

export interface ServerSecretPayload {
  bearerToken?: string;
  customHeaders?: Record<string, string>;
  basicUsername?: string;
  basicPassword?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScopes?: string;
  oauthTokens?: OAuthTokenSet;
  oauthMetadata?: OAuthMetadata;
}

export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Server name is required').max(80),
  url: z
    .string()
    .min(1, 'Server URL is required')
    .refine(
      (val) =>
        val.startsWith('https://') ||
        val.startsWith('virtual://') ||
        val.startsWith('http://localhost') ||
        val.startsWith('http://127.0.0.1'),
      { message: 'Remote servers must use HTTPS (or virtual:// / localhost for testing)' }
    ),
  authType: AuthTypeSchema,
  enabled: z.boolean().default(true),
  transportPreference: z.enum(['auto', 'streamable_http', 'sse']).default('auto'),
  status: z.enum(['connected', 'disconnected', 'auth_expired', 'error', 'connecting']).default('disconnected'),
  lastError: z.string().optional(),
  lastConnectedAt: z.number().optional(),
  tools: z.array(z.custom<McpTool>()).default([]),
  resources: z.array(z.custom<McpResource>()).default([]),
  prompts: z.array(z.custom<McpPrompt>()).default([]),
  disabledTools: z.array(z.string()).default([]),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Agent name is required').max(60),
  icon: z.string().min(1).default('bot'),
  description: z.string().max(240).default(''),
  systemPrompt: z.string().min(1, 'System prompt is required'),
  defaultModelId: z.string().min(1),
  defaultEffort: EffortLevelSchema.default('medium'),
  allowedServerIds: z.array(z.string()).nullable(), // null = all connected servers
  allowedToolNames: z.array(z.string()).nullable(), // null = all enabled tools on allowed servers
  isBuiltIn: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export type ToolCallStatus =
  | 'pending_approval'
  | 'running'
  | 'success'
  | 'error'
  | 'denied'
  | 'cancelled';

export interface ToolCallRecord {
  id: string;
  toolName: string;
  serverId: string;
  serverName: string;
  arguments: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  durationMs?: number;
  status: ToolCallStatus;
  isReadOnly: boolean;
  startedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system_notice';
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallRecord[];
  modelId?: string;
  agentId?: string;
  effort?: EffortLevel;
  createdAt: number;
  isStreaming?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  agentId: string;
  modelId: string;
  effort: EffortLevel;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ProviderKeys {
  gemini?: string;
  groq?: string;
  openrouter?: string;
}

export interface PendingApproval {
  toolCallId: string;
  serverId: string;
  serverName: string;
  toolName: string;
  qualifiedKey: string; // `${serverId}:${toolName}`
  arguments: Record<string, unknown>;
  description?: string;
  isDestructive?: boolean;
  resolve: (decision: 'approve' | 'always_allow' | 'deny') => void;
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  confirmBeforeWrite: boolean;
  maxAgentSteps: number;
  alwaysAllowedTools: string[]; // `${serverId}:${toolName}`
  biometricLockEnabled: boolean;
  hapticsEnabled: boolean;
  onboardingCompleted: boolean;
}
