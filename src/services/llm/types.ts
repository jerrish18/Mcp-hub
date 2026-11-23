import type {
  ChatAttachment,
  ChatMode,
  EffortLevel,
  GroundingCitation,
  KnowledgeSourceMode,
  ModelConfig,
} from '../../types';

export interface LlmToolDefinition {
  qualifiedName: string; // e.g. `srv_1__workspace_search_notes`
  originalName: string;
  serverId: string;
  serverName: string;
  description: string;
  parameters: Record<string, unknown>;
  isReadOnly: boolean;
  isDestructive: boolean;
}

export interface LlmToolCall {
  id: string;
  name: string; // qualifiedName
  rawArguments: string;
  parsedArguments?: Record<string, unknown>;
  parseError?: string;
  thoughtSignature?: string;
}

export type LlmConversationItem =
  | { role: 'user'; text: string; attachments?: ChatAttachment[] }
  | {
      role: 'assistant';
      text: string;
      toolCalls?: LlmToolCall[];
    }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      content: string;
      isError?: boolean;
    };

export type LlmStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'tool_calls'; calls: LlmToolCall[] }
  | { type: 'citations'; citations: GroundingCitation[] }
  | { type: 'done' };

export interface StreamCompletionRequest {
  model: ModelConfig;
  apiKey: string;
  systemPrompt: string;
  effort: EffortLevel;
  chatMode?: ChatMode;
  knowledgeSource?: KnowledgeSourceMode;
  messages: LlmConversationItem[];
  tools: LlmToolDefinition[];
  signal?: AbortSignal;
  onEvent: (event: LlmStreamEvent) => void;
  fetchFn?: typeof fetch;
}

export class RateLimitError extends Error {
  status = 429;
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ModelUnavailableError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = 'ModelUnavailableError';
    this.status = status;
  }
}

export class ProviderAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'ProviderAuthError';
    this.status = status;
  }
}

export function extractReadableApiError(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return 'Empty error response';
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string; status?: string; code?: string | number };
      message?: string;
    };
    const msg = parsed?.error?.message ?? parsed?.message;
    if (msg) return msg;
  } catch {
    // not JSON
  }
  return trimmed.length > 260 ? `${trimmed.slice(0, 260)}…` : trimmed;
}
