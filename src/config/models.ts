import type { ModelConfig, ProviderId } from '../types';

/**
 * Single configuration source for all cloud LLM model IDs.
 * Free-tier model slugs change periodically; update IDs here or use "Sync live models" in Settings.
 */
export const FREE_MODELS: ModelConfig[] = [
  {
    id: 'gemini-4-hydrogen',
    provider: 'gemini',
    label: 'Gemini 4 Flash (Hydrogen)',
    description: 'Fast reasoning, 1M context, reliable native tool calling on Google AI free tier.',
    contextWindow: 1_000_000,
    supportsThinkingLevel: true,
    isFreeTier: true,
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash-Lite',
    description: 'Ultra-low latency lightweight Gemini tier; great fallback when Flash has high demand.',
    contextWindow: 1_000_000,
    supportsThinkingLevel: true,
    isFreeTier: true,
  },
  {
    id: 'gemini-4-neon',
    provider: 'gemini',
    label: 'Gemini 4 Pro (Neon)',
    description: 'Deep reasoning for multi-step agent planning and complex MCP tool orchestration.',
    contextWindow: 1_000_000,
    supportsThinkingLevel: true,
    isFreeTier: true,
  },
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    label: 'GPT-OSS 120B (Groq)',
    description: 'Open-weight 120B class model on Groq with reasoning effort levels and tool calling.',
    contextWindow: 128_000,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
  {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    label: 'GPT-OSS 20B (Groq)',
    description: 'Fast low-latency open-weight model on Groq with reasoning effort support.',
    contextWindow: 128_000,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
  {
    id: 'qwen/qwen3-32b',
    provider: 'groq',
    label: 'Qwen 3 32B (Groq)',
    description: 'Fast open reasoning model on Groq with explicit effort support and tool calls.',
    contextWindow: 131_072,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
  {
    id: 'llama-3.1-8b-instant',
    provider: 'groq',
    label: 'Llama 3.1 8B Instant (Groq)',
    description: 'Sub-second lightweight Llama model on Groq free tier.',
    contextWindow: 128_000,
    supportsReasoningEffort: false,
    isFreeTier: true,
  },
  {
    id: 'openrouter/free',
    provider: 'openrouter',
    label: 'OpenRouter Free Auto-Router',
    description: 'Official OpenRouter free router that automatically picks an active free model.',
    contextWindow: 128_000,
    supportsReasoningEffort: false,
    isFreeTier: true,
  },
  {
    id: 'qwen/qwen3.7-plus:free',
    provider: 'openrouter',
    label: 'Qwen 3.7 Plus (OpenRouter Free)',
    description: 'Modern Qwen free-tier successor on OpenRouter with strong reasoning & tools.',
    contextWindow: 131_072,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    label: 'Llama 3.3 70B (OpenRouter Free)',
    description: 'Free-tier Llama 3.3 70B instruct model on OpenRouter.',
    contextWindow: 128_000,
    supportsReasoningEffort: false,
    isFreeTier: true,
  },
  {
    id: 'demo-sandbox',
    provider: 'demo',
    label: 'Local Sandbox Simulator',
    description: 'Zero-key interactive simulator for testing MCP tool-calling flows offline.',
    contextWindow: 32_000,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
];

export const PROVIDER_INFO: Record<
  ProviderId,
  {
    name: string;
    signupUrl: string;
    keyHint: string;
    baseUrl: string;
  }
> = {
  gemini: {
    name: 'Google Gemini',
    signupUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza...',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  groq: {
    name: 'Groq Cloud',
    signupUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  openrouter: {
    name: 'OpenRouter',
    signupUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-v1-...',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  demo: {
    name: 'Sandbox Demo',
    signupUrl: '',
    keyHint: 'No key required',
    baseUrl: 'virtual://demo',
  },
};

export const DEFAULT_MODEL_ID = 'gemini-4-hydrogen';

export const MODEL_MIGRATION_ALIASES: Record<string, string> = {
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'qwen/qwen3-235b-a22b:free': 'qwen/qwen3.7-plus:free',
};

export function normalizeModelId(modelId: string): string {
  return MODEL_MIGRATION_ALIASES[modelId] ?? modelId;
}

export function getModelById(modelId: string, dynamicModels: ModelConfig[] = []): ModelConfig {
  const normalized = normalizeModelId(modelId);
  return (
    dynamicModels.find((m) => m.id === normalized) ??
    FREE_MODELS.find((m) => m.id === normalized) ??
    FREE_MODELS[0]
  );
}
