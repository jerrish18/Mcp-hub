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
  cloudflare: { name: 'Cloudflare Workers AI', signupUrl: 'https://dash.cloudflare.com/', keyHint: 'Workers AI API token', baseUrl: 'https://api.cloudflare.com/client/v4/accounts' },
  nvidia: { name: 'NVIDIA NIM', signupUrl: 'https://build.nvidia.com/', keyHint: 'NVIDIA Build API key', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  kilo: { name: 'Kilo Gateway', signupUrl: 'https://kilo.ai/docs/gateway', keyHint: 'Anonymous free access', baseUrl: 'https://ai-gateway.kilo.ai/api/v1' },
  local: {
    name: 'Local model',
    signupUrl: '',
    keyHint: 'No API key required',
    baseUrl: 'http://127.0.0.1:11434/v1',
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
  'openai/gpt-oss-120b:free': 'openai/gpt-oss-120b',
  '@cf/openai/gpt-oss-120b': 'openai/gpt-oss-120b',
  'openai/gpt-oss-20b:free': 'openai/gpt-oss-20b',
  '@cf/openai/gpt-oss-20b': 'openai/gpt-oss-20b',
  '@cf/qwen/qwen3.8-27b': 'qwen/qwen3.8-27b',
  '@cf/meta/llama-3.1-8b-instruct': 'llama-3.1-8b-instant',
  'reflection/beam-free': 'reflection/beam',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-lightning:free': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl:free': 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'openrouter/free': 'cloud-auto',
};

export function normalizeModelId(modelId: string): string {
  return Object.hasOwn(MODEL_MIGRATION_ALIASES, modelId) ? MODEL_MIGRATION_ALIASES[modelId] : modelId;
}

export function formatReadableModelSlug(modelId: string): string {
  const withoutVendor = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
  const cleaned = withoutVendor.replace(/:free$/i, '').replace(/[-_]+/g, ' ').trim();
  return cleaned
    .split(/\s+/)
    .map((part) => {
      if (/^(gpt|oss|llm|ai|vl)$/i.test(part)) return part.toUpperCase();
      if (/^\d+[bmk]?$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function getShortModelName(model: Pick<ModelConfig, 'id' | 'label'>): string {
  if (model.id === 'demo-sandbox') return 'Sandbox Demo';
  const baseLabel = model.label
    .replace(/\s*\((?:Hydrogen|Neon|Groq|Groq Live|OpenRouter Free|Synced|Free)\)\s*/gi, '')
    .trim();
  if (!baseLabel || baseLabel.includes('/') || baseLabel === model.id) {
    return formatReadableModelSlug(model.id);
  }
  return baseLabel;
}

export function getModelById(modelId: string, dynamicModels: ModelConfig[] = []): ModelConfig {
  const normalized = normalizeModelId(modelId);
  if (normalized === 'cloud-auto') return {
    id: normalized, provider: 'openrouter', label: 'Automatic free model', description: 'Select a verified free model for this request.',
    contextWindow: 32_000, isFreeTier: true,
  };
  if (normalized.startsWith('local:')) {
    return dynamicModels.find(model => model.id === normalized && model.provider === 'local') ?? {
      id: normalized, provider: 'local', label: normalized.slice(6), description: 'Local model', contextWindow: 8192, isFreeTier: true,
    };
  }
  return (
    dynamicModels.find((m) => m.id === normalized) ??
    FREE_MODELS.find((m) => m.id === normalized) ??
    { id: normalized, provider: 'openrouter', label: formatReadableModelSlug(normalized), description: 'Cloud model awaiting verification', contextWindow: 128_000, isFreeTier: false }
  );
}
