import { FREE_MODELS, getModelById, PROVIDER_INFO } from '../../config/models';
import type { EffortLevel, ModelConfig, ProviderId, ProviderKeys } from '../../types';
import { streamDemoCompletion } from './demoProvider';
import { streamGeminiCompletion } from './gemini';
import { streamOpenAiCompatibleCompletion } from './openaiCompatible';
import {
  type LlmStreamEvent,
  ModelUnavailableError,
  RateLimitError,
  type StreamCompletionRequest,
} from './types';

export function buildEffortAugmentedPrompt(basePrompt: string, effort: EffortLevel, model: ModelConfig): string {
  if (model.supportsThinkingLevel || model.supportsReasoningEffort) {
    if (effort === 'high') {
      return `${basePrompt}\n\n[Reasoning Mode: High] Formulate a clear plan, verify facts using available MCP tools, and double-check outputs before finalizing.`;
    }
    return basePrompt;
  }

  switch (effort) {
    case 'low':
      return `${basePrompt}\n\n[Effort: Low] Give a direct, concise answer immediately without extended planning.`;
    case 'medium':
      return `${basePrompt}\n\n[Effort: Medium] Briefly outline your approach in 1-2 sentences, then act using tools if needed.`;
    case 'high':
      return `${basePrompt}\n\n[Effort: High] Work methodically: 1) Write an explicit short plan, 2) Execute and verify via MCP tools, 3) Perform a brief self-check of tool outputs before answering.`;
  }
}

export function getApiKeyForProvider(provider: ProviderId, keys: ProviderKeys): string {
  switch (provider) {
    case 'gemini':
      return keys.gemini?.trim() ?? '';
    case 'groq':
      return keys.groq?.trim() ?? '';
    case 'openrouter':
      return keys.openrouter?.trim() ?? '';
    case 'demo':
      return 'demo';
  }
}

export function mergeModelCatalog(dynamicModels: ModelConfig[] = []): ModelConfig[] {
  const byId = new Map<string, ModelConfig>();
  for (const m of FREE_MODELS) {
    byId.set(m.id, m);
  }
  for (const dm of dynamicModels) {
    byId.set(dm.id, dm);
  }
  return Array.from(byId.values());
}

export function getAvailableModels(keys: ProviderKeys, dynamicModels: ModelConfig[] = []): ModelConfig[] {
  return mergeModelCatalog(dynamicModels).filter(
    (m) => m.provider === 'demo' || Boolean(getApiKeyForProvider(m.provider, keys))
  );
}

export function getFallbackModelCandidates(
  primaryModelId: string,
  keys: ProviderKeys,
  dynamicModels: ModelConfig[] = []
): ModelConfig[] {
  const catalog = mergeModelCatalog(dynamicModels);
  const primary = getModelById(primaryModelId, dynamicModels);
  const configured = catalog.filter(
    (m) => m.id !== primary.id && m.provider !== 'demo' && Boolean(getApiKeyForProvider(m.provider, keys))
  );
  // Prioritize models from same provider with lower latency, then other configured providers
  const sameProvider = configured.filter((m) => m.provider === primary.provider);
  const differentProvider = configured.filter((m) => m.provider !== primary.provider);
  return [primary, ...differentProvider, ...sameProvider];
}

export async function dispatchStreamCompletion(req: StreamCompletionRequest): Promise<void> {
  const { model } = req;
  if (model.provider === 'demo') {
    return streamDemoCompletion(req);
  }
  if (model.provider === 'gemini') {
    return streamGeminiCompletion(req);
  }
  return streamOpenAiCompatibleCompletion(req);
}

export async function streamWithRateLimitFallback(params: {
  primaryModelId: string;
  keys: ProviderKeys;
  dynamicModels?: ModelConfig[];
  systemPrompt: string;
  effort: EffortLevel;
  chatMode?: import('../../types').ChatMode;
  knowledgeSource?: import('../../types').KnowledgeSourceMode;
  messages: StreamCompletionRequest['messages'];
  tools: StreamCompletionRequest['tools'];
  signal?: AbortSignal;
  onEvent: (event: LlmStreamEvent) => void;
  onModelFallback?: (fromModel: ModelConfig, toModel: ModelConfig, reason: string) => void;
  fetchFn?: typeof fetch;
}): Promise<{ usedModel: ModelConfig }> {
  const candidates = getFallbackModelCandidates(
    params.primaryModelId,
    params.keys,
    params.dynamicModels
  );
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const apiKey = getApiKeyForProvider(model.provider, params.keys);
    const augmentedPrompt = buildEffortAugmentedPrompt(params.systemPrompt, params.effort, model);

    try {
      await dispatchStreamCompletion({
        model,
        apiKey,
        systemPrompt: augmentedPrompt,
        effort: params.effort,
        chatMode: params.chatMode,
        knowledgeSource: params.knowledgeSource,
        messages: params.messages,
        tools: params.tools,
        signal: params.signal,
        onEvent: params.onEvent,
        fetchFn: params.fetchFn,
      });
      return { usedModel: model };
    } catch (err) {
      const recoverable = err instanceof RateLimitError || err instanceof ModelUnavailableError;
      if (recoverable && i + 1 < candidates.length) {
        const nextModel = candidates[i + 1];
        params.onModelFallback?.(model, nextModel, err.message);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All configured models are unavailable.');
}

export async function testModelConnection(params: {
  modelId: string;
  keys: ProviderKeys;
  dynamicModels?: ModelConfig[];
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; latencyMs: number; preview: string }> {
  const model = getModelById(params.modelId, params.dynamicModels);
  const apiKey = getApiKeyForProvider(model.provider, params.keys);
  const started = Date.now();
  let preview = '';

  await dispatchStreamCompletion({
    model,
    apiKey,
    systemPrompt: 'Respond with exactly "OK" and nothing else.',
    effort: 'low',
    messages: [{ role: 'user', text: 'Ping' }],
    tools: [],
    fetchFn: params.fetchFn,
    onEvent: (ev) => {
      if (ev.type === 'text_delta') preview += ev.delta;
    },
  });

  return {
    ok: true,
    latencyMs: Date.now() - started,
    preview: preview.trim() || 'Connected',
  };
}

/**
 * Queries live free/active models directly from configured provider APIs
 * so deprecated slugs never strand the user.
 */
export async function syncLiveProviderModels(
  keys: ProviderKeys,
  fetchFn: typeof fetch = fetch
): Promise<{ models: ModelConfig[]; syncedProviders: string[] }> {
  const discovered: ModelConfig[] = [];
  const syncedProviders: string[] = [];

  if (keys.gemini?.trim()) {
    try {
      const res = await fetchFn(
        `${PROVIDER_INFO.gemini.baseUrl}/models?key=${encodeURIComponent(keys.gemini.trim())}`
      );
      if (res.ok) {
        const json = (await res.json()) as {
          models?: Array<{
            name: string;
            displayName?: string;
            description?: string;
            inputTokenLimit?: number;
            supportedGenerationMethods?: string[];
          }>;
        };
        const geminiModels = (json.models ?? [])
          .filter(
            (m) =>
              m.supportedGenerationMethods?.includes('generateContent') &&
              !m.name.includes('embedding') &&
              !m.name.includes('tts') &&
              !m.name.includes('image')
          )
          .slice(0, 8)
          .map((m): ModelConfig => {
            const id = m.name.replace(/^models\//, '');
            return {
              id,
              provider: 'gemini',
              label: `${m.displayName || id} (Synced)`,
              description: m.description || 'Live synced Gemini model',
              contextWindow: m.inputTokenLimit ?? 1_000_000,
              supportsThinkingLevel: id.includes('gemini-3') || id.includes('gemini-4'),
              isFreeTier: true,
            };
          });
        if (geminiModels.length > 0) {
          discovered.push(...geminiModels);
          syncedProviders.push('Gemini');
        }
      }
    } catch {
      // keep fallback registry
    }
  }

  if (keys.groq?.trim()) {
    try {
      const res = await fetchFn(`${PROVIDER_INFO.groq.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${keys.groq.trim()}` },
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{ id: string; active?: boolean; context_window?: number }>;
        };
        const groqModels = (json.data ?? [])
          .filter(
            (m) =>
              m.active !== false &&
              !m.id.includes('whisper') &&
              !m.id.includes('guard') &&
              !m.id.includes('tts')
          )
          .slice(0, 8)
          .map((m): ModelConfig => ({
            id: m.id,
            provider: 'groq',
            label: `${m.id} (Groq Live)`,
            description: 'Active model synced from your Groq account',
            contextWindow: m.context_window ?? 128_000,
            supportsReasoningEffort: m.id.includes('qwen') || m.id.includes('gpt-oss'),
            isFreeTier: true,
          }));
        if (groqModels.length > 0) {
          discovered.push(...groqModels);
          syncedProviders.push('Groq');
        }
      }
    } catch {
      // keep fallback registry
    }
  }

  if (keys.openrouter?.trim()) {
    try {
      const res = await fetchFn(`${PROVIDER_INFO.openrouter.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${keys.openrouter.trim()}` },
      });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: Array<{
            id: string;
            name?: string;
            context_length?: number;
            pricing?: { prompt?: string; completion?: string };
            supported_parameters?: string[];
          }>;
        };
        const freeToolModels = (json.data ?? [])
          .filter(
            (m) =>
              (m.id.endsWith(':free') || m.id === 'openrouter/free' || m.pricing?.prompt === '0') &&
              (!m.supported_parameters || m.supported_parameters.includes('tools'))
          )
          .slice(0, 8)
          .map((m): ModelConfig => ({
            id: m.id,
            provider: 'openrouter',
            label: `${m.name || m.id} (Free)`,
            description: 'Live free-tier OpenRouter model with tool calling',
            contextWindow: m.context_length ?? 128_000,
            supportsReasoningEffort: m.supported_parameters?.includes('reasoning') ?? false,
            isFreeTier: true,
          }));
        if (freeToolModels.length > 0) {
          discovered.push(...freeToolModels);
          syncedProviders.push('OpenRouter');
        }
      }
    } catch {
      // keep fallback registry
    }
  }

  return { models: discovered, syncedProviders };
}
