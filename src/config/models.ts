import type { CodeRoleAssignments, CodingRole, ModelConfig, ProviderId } from '../types';

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
  modelscope: { name: 'ModelScope', signupUrl: 'https://modelscope.ai/my/myaccesstoken', keyHint: 'ModelScope access token', baseUrl: 'https://api-inference.modelscope.ai/v1' },
  amd: { name: 'AMD Radeon Cloud', signupUrl: 'https://developer.amd.com.cn/radeon/tokenfactory', keyHint: 'AMD Token Factory key', baseUrl: 'https://developer.amd.com.cn/radeon/api/v1' },
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
  'Qwen-Ambassador/Qwen3.7-Plus': 'qwen/qwen3.7-plus:free',
  'Qwen/Qwen3.8-27B': 'qwen/qwen3.8-27b',
  'Qwen/Qwen3.5-35B-A3B': 'qwen/qwen3.5-35b-a3b',
  '@cf/meta/llama-3.1-8b-instruct': 'llama-3.1-8b-instant',
  'reflection/beam-free': 'reflection/beam',
  'nvidia/nemotron-3-ultra-550b-a55b:free': 'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-lightning:free': 'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-super-vl:free': 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  'openrouter/free': 'cloud-auto',
  'GLM-5.3-Flash': 'z-ai/glm-5.3-flash',
  'zai-org/GLM-4.7-Flash': 'z-ai/glm-4.7-flash',
  'zai-org/GLM-5.2': 'z-ai/glm-5.2',
  'moonshotai/Kimi-K3.1-Pro': 'moonshotai/kimi-k3.1-pro',
  'MiniMax/MiniMax-M3': 'minimax/minimax-m3',
  'minimaxai/minimax-m3.1-flash': 'minimax/minimax-m3.1-flash',
  'DeepSeek-V4.1-Flash': 'deepseek-ai/deepseek-v4.1-flash-1017',
  'deepseek-ai/DeepSeek-V4.1-Flash-1017': 'deepseek-ai/deepseek-v4.1-flash-1017',
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

export const CODING_ROLE_METADATA: Record<
  CodingRole,
  { label: string; shortHint: string }
> = {
  architect: {
    label: 'Architect',
    shortHint: 'Plans spec, manifest, and task sequence',
  },
  coder: {
    label: 'Coder',
    shortHint: 'Applies targeted diffs and file writes',
  },
  reviewer: {
    label: 'Reviewer',
    shortHint: 'Audits diffs, runs checks, and drives self-healing',
  },
};

export function formatContextWindowLabel(contextWindow: number): string {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return '32K ctx';
  if (contextWindow >= 1_000_000) {
    const m = contextWindow / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`;
  }
  return `${Math.round(contextWindow / 1000)}K ctx`;
}

export function scoreModelForCodingRole(model: ModelConfig, role: CodingRole): number {
  const normalizedId = normalizeModelId(model.id);
  const idLower = normalizedId.toLowerCase();
  if (normalizedId === 'cloud-auto') return -1000;
  if (model.provider === 'demo') return -500;
  if (model.provider === 'local') return -200;

  let score = 0;
  const hasTools = !model.routes?.length || model.routes.some((r) => r.tools);
  if (hasTools) score += 200;
  else if (role === 'coder') score -= 120;
  if (model.supportsThinkingLevel) score += role === 'coder' ? 45 : 95;
  if (model.supportsReasoningEffort) score += role === 'coder' ? 40 : 85;
  score += Math.min(100, Math.floor((model.contextWindow || 32_000) / 10_000));

  // Penalize bare auto-routers or tiny models compared to dedicated coding/reasoning models
  if (idLower.endsWith('/free') || idLower.endsWith(':auto')) score -= 60;
  if (/(?:^|[-_/])(1b|2b|3b|4b|7b|8b)(?:[-_/:]|$)/.test(idLower)) score -= 45;

  if (role === 'architect' || role === 'reviewer') {
    if (
      idLower.includes('neon') ||
      idLower.includes('pro') ||
      idLower.includes('ultra') ||
      idLower.includes('120b') ||
      idLower.includes('kimi')
    ) {
      score += 80;
    }
    if (
      idLower.includes('deepseek') ||
      idLower.includes('qwen3.7') ||
      idLower.includes('qwen3.8') ||
      idLower.includes('glm-5') ||
      idLower.includes('beam')
    ) {
      score += 65;
    }
    if (idLower.includes('hydrogen') || idLower.includes('flash') || idLower.includes('qwen3.5')) {
      score += 40;
    }
  } else {
    if (
      idLower.includes('coder') ||
      idLower.includes('minimax') ||
      idLower.includes('deepseek') ||
      idLower.includes('qwen3.5') ||
      idLower.includes('qwen3.7') ||
      idLower.includes('qwen3.8')
    ) {
      score += 85;
    }
    if (
      idLower.includes('hydrogen') ||
      idLower.includes('flash') ||
      idLower.includes('qwen') ||
      idLower.includes('gpt-oss') ||
      idLower.includes('glm-5') ||
      idLower.includes('kimi')
    ) {
      score += 65;
    }
    if (idLower.includes('lite') || idLower.includes('instant')) score += 30;
  }

  return score;
}

export function selectDefaultRoleModels(
  availableModels: ModelConfig[],
  fallbackModelId = 'demo-sandbox'
): CodeRoleAssignments {
  const usable = availableModels.filter((m) => normalizeModelId(m.id) !== 'cloud-auto');
  const cloudUsable = usable.filter((m) => m.provider !== 'demo' && m.provider !== 'local');
  const pool = cloudUsable.length > 0 ? cloudUsable : usable;
  const normalizedFallback = normalizeModelId(fallbackModelId);

  if (pool.length === 0) {
    const safeFallback = normalizedFallback === 'cloud-auto' ? 'demo-sandbox' : normalizedFallback;
    return {
      architect: safeFallback,
      coder: safeFallback,
      reviewer: safeFallback,
    };
  }

  const pickBest = (role: CodingRole, excludeId?: string): string => {
    const ranked = [...pool].sort(
      (a, b) => scoreModelForCodingRole(b, role) - scoreModelForCodingRole(a, role) || a.id.localeCompare(b.id)
    );
    if (excludeId && ranked.length > 1 && ranked[0].id === excludeId) {
      const next = ranked.find((m) => m.id !== excludeId && scoreModelForCodingRole(m, role) > 0);
      if (next) return next.id;
    }
    return ranked[0]?.id ?? (normalizedFallback === 'cloud-auto' ? 'demo-sandbox' : normalizedFallback);
  };

  const architect = pickBest('architect');
  const coder = pickBest('coder');
  const reviewer = pickBest('reviewer', coder);

  return { architect, coder, reviewer };
}
