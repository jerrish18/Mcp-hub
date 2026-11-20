import type { ModelConfig, ProviderId } from '../types';

/**
 * Single configuration source for all cloud LLM model IDs.
 * Free-tier model slugs change periodically; update IDs here without touching provider code.
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
    id: 'gemini-4-neon',
    provider: 'gemini',
    label: 'Gemini 4 Pro (Neon)',
    description: 'Deep reasoning for multi-step agent planning and complex MCP tool orchestration.',
    contextWindow: 1_000_000,
    supportsThinkingLevel: true,
    isFreeTier: true,
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash-Lite',
    description: 'Ultra-low latency lightweight Gemini tier for quick direct tool actions.',
    contextWindow: 1_000_000,
    supportsThinkingLevel: true,
    isFreeTier: true,
  },
  {
    id: 'llama-3.3-70b-versatile',
    provider: 'groq',
    label: 'Llama 3.3 70B (Groq)',
    description: 'Sub-second inference on Groq free tier with strong parallel tool calling.',
    contextWindow: 128_000,
    supportsReasoningEffort: false,
    isFreeTier: true,
  },
  {
    id: 'qwen/qwen3-32b',
    provider: 'groq',
    label: 'Qwen 3 32B (Groq)',
    description: 'Fast open reasoning model with explicit effort support and tool calls.',
    contextWindow: 131_072,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    label: 'GPT-OSS 120B (Groq)',
    description: 'Open-weight 120B class model on Groq with reasoning effort levels.',
    contextWindow: 128_000,
    supportsReasoningEffort: true,
    isFreeTier: true,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    label: 'Llama 3.3 70B (OpenRouter Free)',
    description: 'Reliable free-tier OpenRouter router model with OpenAI tool schema support.',
    contextWindow: 128_000,
    supportsReasoningEffort: false,
    isFreeTier: true,
  },
  {
    id: 'qwen/qwen3-235b-a22b:free',
    provider: 'openrouter',
    label: 'Qwen 3 235B (OpenRouter Free)',
    description: 'Large MoE open model on OpenRouter free tier for complex synthesis.',
    contextWindow: 131_072,
    supportsReasoningEffort: true,
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

export function getModelById(modelId: string): ModelConfig {
  return FREE_MODELS.find((m) => m.id === modelId) ?? FREE_MODELS[0];
}
