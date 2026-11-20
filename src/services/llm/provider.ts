import { FREE_MODELS, getModelById } from '../../config/models';
import type { EffortLevel, ModelConfig, ProviderId, ProviderKeys } from '../../types';
import { streamDemoCompletion } from './demoProvider';
import { streamGeminiCompletion } from './gemini';
import { streamOpenAiCompatibleCompletion } from './openaiCompatible';
import { type LlmStreamEvent, RateLimitError, type StreamCompletionRequest } from './types';

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

export function getAvailableModels(keys: ProviderKeys): ModelConfig[] {
  return FREE_MODELS.filter((m) => m.provider === 'demo' || Boolean(getApiKeyForProvider(m.provider, keys)));
}

export function getFallbackModelCandidates(primaryModelId: string, keys: ProviderKeys): ModelConfig[] {
  const primary = getModelById(primaryModelId);
  const configured = FREE_MODELS.filter(
    (m) => m.id !== primary.id && m.provider !== 'demo' && Boolean(getApiKeyForProvider(m.provider, keys))
  );
  // Prioritize models from different providers first, then remaining models
  const differentProvider = configured.filter((m) => m.provider !== primary.provider);
  const sameProvider = configured.filter((m) => m.provider === primary.provider);
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
  systemPrompt: string;
  effort: EffortLevel;
  messages: StreamCompletionRequest['messages'];
  tools: StreamCompletionRequest['tools'];
  signal?: AbortSignal;
  onEvent: (event: LlmStreamEvent) => void;
  onModelFallback?: (fromModel: ModelConfig, toModel: ModelConfig, reason: string) => void;
  fetchFn?: typeof fetch;
}): Promise<{ usedModel: ModelConfig }> {
  const candidates = getFallbackModelCandidates(params.primaryModelId, params.keys);
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
        messages: params.messages,
        tools: params.tools,
        signal: params.signal,
        onEvent: params.onEvent,
        fetchFn: params.fetchFn,
      });
      return { usedModel: model };
    } catch (err) {
      if (err instanceof RateLimitError && i + 1 < candidates.length) {
        const nextModel = candidates[i + 1];
        params.onModelFallback?.(model, nextModel, err.message);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All configured models hit rate limits.');
}

export async function testModelConnection(params: {
  modelId: string;
  keys: ProviderKeys;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; latencyMs: number; preview: string }> {
  const model = getModelById(params.modelId);
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
