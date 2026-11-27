import { FREE_ROUTE_EVIDENCE } from '../../config/freeRouteEvidence';
import { formatReadableModelSlug, FREE_MODELS, getModelById, PROVIDER_INFO, normalizeModelId } from '../../config/models';
import type {
  CloudProvider,
  EffortLevel,
  ModelConfig,
  ProviderId,
  ProviderKeys,
  ProviderKeyStatus,
  ProviderValidationResult,
} from '../../types';
import { streamDemoCompletion } from './demoProvider';
import { streamGeminiCompletion } from './gemini';
import { streamOpenAiCompatibleCompletion } from './openaiCompatible';
import {
  type LlmStreamEvent,
  ModelUnavailableError,
  ProviderAuthError,
  RateLimitError,
  type StreamCompletionRequest,
} from './types';
import {
  canonicalIdFor,
  catalogRoute,
  classifyProviderFailure,
  cloudCredential,
  CLOUD_PROVIDERS,
  currentVerifiedRoute,
  eligibleRoutes,
  evidenceFor,
  isTransientCatalogError,
  ProviderCatalogError,
  readProviderCatalog,
  validateProviderKey,
} from './freeRegistry';
import { recordProvider429, recordProviderRequest } from '../../utils/quotaTracker';

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
  if (provider === 'local') return 'local-model-no-api-key';
  if (provider === 'demo') return 'demo';
  if (provider === 'kilo') return 'anonymous';
  return cloudCredential(provider, keys);
}

export function isModelManuallyOverridden(modelId: string, manualOverrides: string[] = []): boolean {
  if (!manualOverrides.length) return false;
  const normalized = normalizeModelId(modelId);
  return manualOverrides.some((id) => id === modelId || normalizeModelId(id) === normalized);
}

export function isCloudProvider(provider: ProviderId): provider is CloudProvider {
  return provider !== 'local' && provider !== 'demo';
}

export function hasConfiguredCloudKey(provider: ProviderId, keys: ProviderKeys): boolean {
  if (provider === 'local' || provider === 'demo' || provider === 'kilo') return true;
  if (provider === 'cloudflare') {
    return Boolean(cloudCredential('cloudflare', keys) && keys.cloudflareAccountId && /^[0-9a-f]{32}$/i.test(keys.cloudflareAccountId));
  }
  return Boolean(cloudCredential(provider, keys));
}

export function mergeModelCatalog(dynamicModels: ModelConfig[] = []): ModelConfig[] {
  const curatedById = new Map<string, ModelConfig>();
  const byId = new Map<string, ModelConfig>();
  for (const m of FREE_MODELS) {
    curatedById.set(m.id, m);
    byId.set(m.id, m);
  }
  for (const dm of dynamicModels) {
    const curated = curatedById.get(dm.id);
    if (curated) {
      byId.set(dm.id, {
        ...dm,
        label: curated.label,
        description: dm.routes?.length ? dm.description : curated.description,
        supportsThinkingLevel: curated.supportsThinkingLevel ?? dm.supportsThinkingLevel,
        supportsReasoningEffort: curated.supportsReasoningEffort ?? dm.supportsReasoningEffort,
      });
    } else {
      const looksLikeSlug = dm.label.includes('/') || dm.label.startsWith(dm.id);
      byId.set(dm.id, {
        ...dm,
        label: looksLikeSlug ? `${formatReadableModelSlug(dm.id)} (${PROVIDER_INFO[dm.provider].name})` : dm.label,
      });
    }
  }
  return Array.from(byId.values());
}

export function getAvailableModels(
  keys: ProviderKeys,
  dynamicModels: ModelConfig[] = [],
  manualModelOverrides: string[] = []
): ModelConfig[] {
  return mergeModelCatalog(dynamicModels).flatMap((model) => {
    if (model.provider === 'demo' || model.provider === 'local') return [model];
    const routes = eligibleRoutes(model, keys);
    const primary = routes.find((route) => route.provider === model.provider) ?? routes[0];
    if (primary) {
      return [{ ...model, provider: primary.provider, contextWindow: primary.contextWindow, routes }];
    }
    if (
      isCloudProvider(model.provider) &&
      isModelManuallyOverridden(model.id, manualModelOverrides) &&
      hasConfiguredCloudKey(model.provider, keys)
    ) {
      const fallbackRoute = model.routes?.[0] ?? {
        provider: model.provider,
        modelId: model.upstreamModelId ?? model.id,
        contextWindow: model.contextWindow,
        tools: true,
        images: model.provider === 'gemini',
        reasoning: Boolean(model.supportsReasoningEffort || model.supportsThinkingLevel),
        checkedAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
      return [{ ...model, routes: [fallbackRoute] }];
    }
    return [];
  });
}

export function getUnavailableCatalogModels(available: ModelConfig[], dynamicModels: ModelConfig[] = []): ModelConfig[] {
  const availableIds = new Set(available.map((model) => normalizeModelId(model.id)));
  const known = new Map<string, ModelConfig>();
  for (const model of FREE_MODELS) {
    const id = normalizeModelId(model.id);
    if (model.provider !== 'demo' && id !== 'cloud-auto') known.set(id, model);
  }
  for (const dm of dynamicModels) {
    if (dm.provider !== 'demo' && dm.provider !== 'local' && dm.id !== 'cloud-auto') {
      const id = normalizeModelId(dm.id);
      if (!known.has(id)) known.set(id, dm);
    }
  }
  for (const evidence of FREE_ROUTE_EVIDENCE) {
    if (!known.has(evidence.canonicalId)) {
      const model = getModelById(evidence.canonicalId, dynamicModels);
      known.set(evidence.canonicalId, { ...model, provider: evidence.provider });
    }
  }
  return [...known].filter(([id]) => !availableIds.has(id)).map(([, model]) => model);
}

export interface UnavailableCatalogEntry {
  model: ModelConfig;
  status: ProviderKeyStatus | 'unverified_route';
  badge: string;
  detail: string;
  canOverride: boolean;
}

export function getUnavailableCatalogModelsWithDetails(
  available: ModelConfig[],
  keys: ProviderKeys,
  dynamicModels: ModelConfig[] = [],
  providerValidation: Partial<Record<CloudProvider, ProviderValidationResult>> = {},
  modelFailures: Record<string, { status: ProviderKeyStatus; badge: string; detail: string }> = {}
): UnavailableCatalogEntry[] {
  const models = getUnavailableCatalogModels(available, dynamicModels);
  return models.map((model) => {
    const modelErr = modelFailures[model.id] ?? modelFailures[normalizeModelId(model.id)];
    if (modelErr) {
      return {
        model,
        status: modelErr.status,
        badge: modelErr.badge,
        detail: modelErr.detail,
        canOverride: model.provider !== 'demo' && hasConfiguredCloudKey(model.provider, keys) && modelErr.status !== 'invalid_key',
      };
    }
    if (model.provider === 'local' || model.provider === 'demo') {
      return {
        model,
        status: 'unverified_route',
        badge: 'Local',
        detail: 'Local endpoint model.',
        canOverride: true,
      };
    }
    const configured = hasConfiguredCloudKey(model.provider, keys);
    const val = providerValidation[model.provider];
    if (!configured) {
      return {
        model,
        status: 'unconfigured',
        badge: 'No Key',
        detail: `Add your ${PROVIDER_INFO[model.provider].name} API key in Settings.`,
        canOverride: false,
      };
    }
    if (val && val.status !== 'valid' && val.status !== 'unconfigured') {
      return {
        model,
        status: val.status,
        badge: val.badge,
        detail: val.detail,
        canOverride: val.status !== 'invalid_key',
      };
    }
    if (val?.status === 'valid') {
      return {
        model,
        status: 'paid_route',
        badge: 'Paid/Credit Route',
        detail: 'API key is valid, but this model is outside the verified zero-cost allowlist. Enable override to use it.',
        canOverride: true,
      };
    }
    return {
      model,
      status: 'paid_route',
      badge: 'Paid/Credit Route',
      detail: 'No verified zero-cost route matched yet. Verify keys or enable manual override.',
      canOverride: true,
    };
  });
}

export function preserveCatalogForSameCredentials(
  models: ModelConfig[], previous: ProviderKeys, current: ProviderKeys,
): ModelConfig[] {
  return models.flatMap((model) => {
    if (!model.routes?.length) {
      return model.description === 'Custom user model' || (model.provider !== 'local' && model.provider !== 'demo' && hasConfiguredCloudKey(model.provider, current))
        ? [model]
        : [];
    }
    const routes = model.routes.filter((route) =>
      cloudCredential(route.provider, previous) === cloudCredential(route.provider, current)
      && (route.provider !== 'cloudflare' || previous.cloudflareAccountId === current.cloudflareAccountId));
    return routes.length ? [{ ...model, routes }] : [];
  });
}

export function retainTransientCatalogRoutes(
  fresh: ModelConfig[], previous: ModelConfig[], transientProviders: CloudProvider[], keys: ProviderKeys,
): ModelConfig[] {
  if (!transientProviders.length) return fresh;
  const models = new Map(fresh.map((model) => [model.id, model]));
  for (const old of previous) {
    const routes = eligibleRoutes(old, keys).filter((route) => transientProviders.includes(route.provider));
    if (!routes.length) continue;
    const current = models.get(old.id);
    models.set(old.id, { ...(current ?? old), routes: [...(current?.routes ?? []), ...routes] });
  }
  return [...models.values()];
}

const routeHealth = new Map<string, { latency?: number; cooldown?: number; remaining?: number }>();
const routeKey = (provider: string, modelId: string) => `${provider}/${modelId}`;

export function getFallbackModelCandidates(
  primaryModelId: string,
  keys: ProviderKeys,
  dynamicModels: ModelConfig[] = [],
  needs: { tools?: boolean; images?: boolean; autoFallback?: boolean; manualModelOverrides?: string[] } = {},
): ModelConfig[] {
  const normalized = normalizeModelId(primaryModelId);
  const catalog = mergeModelCatalog(dynamicModels);
  const picked = catalog.find((item) => item.id === normalized) ?? getModelById(normalized, dynamicModels);
  if (picked.provider === 'local' || picked.provider === 'demo') return [picked];

  const rank = (model: ModelConfig) => Math.max(0, ...(model.routes ?? []).map((route) => evidenceFor(route)?.codingScore ?? 0));
  const models = normalized === 'cloud-auto'
    ? catalog.filter((model) => model.routes?.length).sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))
    : [picked];
  const candidates = models.flatMap((model) => {
    const routes = eligibleRoutes(model, keys);
    if (routes.length > 0) {
      return routes
        .filter((route) => (!needs.tools || route.tools) && (!needs.images || route.images)
          && (routeHealth.get(routeKey(route.provider, route.modelId))?.cooldown ?? 0) <= Date.now())
        .sort((a, b) => {
          const first = routeHealth.get(routeKey(a.provider, a.modelId));
          const second = routeHealth.get(routeKey(b.provider, b.modelId));
          const quotaOrder = Number(first?.remaining === 0) - Number(second?.remaining === 0);
          return quotaOrder || (first?.latency ?? Infinity) - (second?.latency ?? Infinity) || a.provider.localeCompare(b.provider);
        })
        .map((route) => ({
          ...model,
          routes: [route],
          provider: route.provider,
          contextWindow: route.contextWindow,
          supportsThinkingLevel: route.provider === 'gemini' && route.reasoning,
          supportsReasoningEffort:
            (route.provider === 'openrouter' || route.provider === 'nvidia' || route.provider === 'groq') &&
            route.reasoning,
        }));
    }
    if (
      normalized !== 'cloud-auto' &&
      isCloudProvider(model.provider) &&
      isModelManuallyOverridden(model.id, needs.manualModelOverrides) &&
      hasConfiguredCloudKey(model.provider, keys)
    ) {
      const overrideRoute = model.routes?.[0] ?? {
        provider: model.provider,
        modelId: model.upstreamModelId ?? model.id,
        contextWindow: model.contextWindow,
        tools: true,
        images: model.provider === 'gemini',
        reasoning: Boolean(model.supportsReasoningEffort || model.supportsThinkingLevel),
        checkedAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
      return [{ ...model, routes: [overrideRoute] }];
    }
    return [];
  });
  return normalized === 'cloud-auto' && !needs.autoFallback
    ? candidates.filter((model) => model.id === candidates[0]?.id)
    : candidates;
}

export async function dispatchStreamCompletion(req: StreamCompletionRequest): Promise<void> {
  if (req.model.provider === 'local' || req.model.provider === 'demo') return runTransport(req);
  const route = req.model.routes?.find((item) => item.provider === req.model.provider);
  const keys = req.credentials ?? { [req.model.provider]: req.apiKey };
  if (req.manualOverride) {
    if (req.model.provider !== 'kilo' && !cloudCredential(req.model.provider, keys)) {
      throw new ProviderAuthError(`${PROVIDER_INFO[req.model.provider].name} API key is not configured.`);
    }
    await runTransport(req);
    return;
  }
  let current: Awaited<ReturnType<typeof currentVerifiedRoute>>;
  if (route && evidenceFor(route)?.canonicalId === req.model.id) {
    try {
      current = await currentVerifiedRoute(route, keys, req.fetchFn ?? fetch, req.signal);
    } catch (err) {
      if (req.signal?.aborted) throw err;
      if (err instanceof ProviderCatalogError) {
        if (err.status === 401 || err.status === 403) {
          throw new ProviderAuthError(err.message, err.status);
        }
        if (err.status === 429) {
          throw new RateLimitError(err.message);
        }
        throw new ModelUnavailableError(err.message, err.status, { cause: err });
      }
      if (err instanceof TypeError) {
        throw new ModelUnavailableError(`${PROVIDER_INFO[req.model.provider].name} could not be reached.`, 503, { cause: err });
      }
      current = undefined;
    }
  }
  if (!current) throw new ModelUnavailableError('This model has no currently verified free route.', 503);
  const images = req.messages.some((message) => message.role === 'user'
    ? message.attachments?.some((attachment) => attachment.kind === 'image' && attachment.dataBase64)
    : message.role === 'tool' && message.mediaBlocks?.some((block) => block.type === 'image'));
  if (images && !current.images) throw new ModelUnavailableError('This free route does not support image input.', 503);
  await runTransport({
    ...req,
    model: {
      ...req.model,
      routes: [current],
      supportsThinkingLevel: current.provider === 'gemini' && current.reasoning,
      supportsReasoningEffort:
        (current.provider === 'openrouter' || current.provider === 'nvidia' || current.provider === 'groq') &&
        current.reasoning,
    },
    tools: current.tools ? req.tools : [],
    onQuota: (headers) => {
      const value = headers.get('x-ratelimit-remaining-requests');
      if (value !== null && /^\d+$/.test(value)) {
        const key = routeKey(current.provider, current.modelId);
        routeHealth.set(key, { ...routeHealth.get(key), remaining: Number(value) });
      }
    },
  });
}

async function runTransport(req: StreamCompletionRequest): Promise<void> {
  const { model } = req;
  recordProviderRequest(model.provider);
  if (model.provider === 'demo') return streamDemoCompletion(req);

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  req.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (req.signal?.aborted) forwardAbort();
  let timedOut = false;
  let outputStarted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetIdleTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.websiteBuild && outputStarted ? 75_000 : 120_000);
  };
  resetIdleTimer();
  const request = {
    ...req,
    signal: controller.signal,
    onEvent: (event: LlmStreamEvent) => {
      if (event.type === 'text_delta') outputStarted = true;
      if (!req.websiteBuild || !outputStarted || event.type !== 'reasoning_delta') resetIdleTimer();
      req.onEvent(event);
    },
  };
  try {
    if (model.provider === 'gemini') return await streamGeminiCompletion(request);
    return await streamOpenAiCompatibleCompletion(request);
  } catch (err) {
    if (req.signal?.aborted) throw err;
    if (timedOut && !outputStarted) throw new ModelUnavailableError('The provider stopped responding.', 503, { cause: err });
    if (timedOut) throw new Error(outputStarted && req.websiteBuild
      ? 'The model stopped sending website source. Any received files are kept. Try again or request a smaller first version.'
      : 'The model stopped responding. Try again or choose a different model.', { cause: err });
    if (err instanceof RateLimitError) recordProvider429(model.provider);
    throw err;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function streamWithRateLimitFallback(params: {
  primaryModelId: string;
  excludeFallbackModelId?: string;
  keys: ProviderKeys;
  dynamicModels?: ModelConfig[];
  manualModelOverrides?: string[];
  isProbe?: boolean;
  allowLocalTools?: boolean;
  systemPrompt: string;
  effort: EffortLevel;
  chatMode?: import('../../types').ChatMode;
  knowledgeSource?: import('../../types').KnowledgeSourceMode;
  a2uiEnabled?: boolean;
  websiteBuild?: boolean;
  messages: StreamCompletionRequest['messages'];
  prepareMessages?: (model: ModelConfig) => StreamCompletionRequest['messages'];
  tools: StreamCompletionRequest['tools'];
  signal?: AbortSignal;
  onEvent: (event: LlmStreamEvent) => void;
  onModelAttemptStart?: (model: ModelConfig, index: number, prompt: string) => void;
  onModelAttemptEnd?: (status: 'success' | 'error' | 'cancelled', error?: unknown) => void;
  onModelFallback?: (fromModel: ModelConfig, toModel: ModelConfig, reason: string) => void;
  fetchFn?: typeof fetch;
  routeFixture?: typeof getFallbackModelCandidates;
}): Promise<{ usedModel: ModelConfig }> {
  const chooseRoutes = (params.fetchFn && params.routeFixture) || getFallbackModelCandidates;
  const candidates = chooseRoutes(
    params.primaryModelId, params.keys, params.dynamicModels, {
      tools: params.tools.length > 0,
      autoFallback: params.chatMode === 'coding',
      manualModelOverrides: params.manualModelOverrides,
      images: params.messages.some((message) => message.role === 'user'
        ? message.attachments?.some((attachment) => attachment.kind === 'image' && attachment.dataBase64)
        : message.role === 'tool' && message.mediaBlocks?.some((block) => block.type === 'image')),
    }
  ).filter((model, index) => index === 0 || normalizeModelId(model.id) !== normalizeModelId(params.excludeFallbackModelId ?? ''));
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const apiKey = getApiKeyForProvider(model.provider, params.keys);
    const augmentedPrompt = buildEffortAugmentedPrompt(params.systemPrompt, params.effort, model);
    const manualOverride =
      model.provider !== 'local' &&
      model.provider !== 'demo' &&
      isModelManuallyOverridden(model.id, params.manualModelOverrides) &&
      !eligibleRoutes(model, params.keys).length;

    params.onModelAttemptStart?.(model, i, augmentedPrompt);
    let startedResponse = false;
    const routeId = routeKey(model.provider, model.routes?.[0]?.modelId ?? model.id);
    const started = Date.now();
    const dispatch = params.routeFixture && params.fetchFn ? runTransport : dispatchStreamCompletion;
    try {
      await dispatch({
        model,
        apiKey,
        credentials: params.keys,
        systemPrompt: augmentedPrompt,
        effort: params.effort,
        chatMode: params.chatMode,
        knowledgeSource: params.knowledgeSource,
        a2uiEnabled: params.a2uiEnabled,
        websiteBuild: params.websiteBuild,
        isProbe: params.isProbe,
        manualOverride,
        allowLocalTools: params.allowLocalTools,
        messages: params.prepareMessages?.(model) ?? params.messages,
        tools: params.tools,
        signal: params.signal,
        onEvent: (event) => {
          if (!startedResponse && (event.type === 'text_delta' || event.type === 'tool_calls' || event.type === 'reasoning_delta')) {
            startedResponse = true;
            routeHealth.set(routeId, { ...routeHealth.get(routeId), latency: Date.now() - started });
          }
          params.onEvent(event);
        },
        fetchFn: params.fetchFn,
      });
      params.onModelAttemptEnd?.('success');
      return { usedModel: model };
    } catch (err) {
      params.onModelAttemptEnd?.(params.signal?.aborted ? 'cancelled' : 'error', err);
      const recoverable = err instanceof RateLimitError || err instanceof ModelUnavailableError || err instanceof ProviderAuthError;
      if (err instanceof RateLimitError) routeHealth.set(routeId, {
        ...routeHealth.get(routeId), cooldown: Date.now() + (err.retryAfterMs ?? 60_000),
      });
      if (!params.signal?.aborted && !startedResponse && recoverable && i + 1 < candidates.length) {
        const nextModel = candidates[i + 1];
        params.onModelFallback?.(model, nextModel, err.message);
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('No verified free model can handle this request. Check provider availability in Settings.');
}

export async function testModelConnection(params: {
  modelId: string;
  keys: ProviderKeys;
  dynamicModels?: ModelConfig[];
  manualModelOverrides?: string[];
  allowLocalTools?: boolean;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; latencyMs: number; preview: string }> {
  const started = Date.now();
  let preview = '';

  await streamWithRateLimitFallback({
    primaryModelId: params.modelId,
    keys: params.keys,
    dynamicModels: params.dynamicModels,
    manualModelOverrides: params.manualModelOverrides,
    isProbe: true,
    allowLocalTools: params.allowLocalTools,
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

export async function validateAllConfiguredProviderKeys(
  keys: ProviderKeys,
  fetchFn: typeof fetch = fetch
): Promise<{
  validation: Partial<Record<CloudProvider, ProviderValidationResult>>;
  discoveredModels: ModelConfig[];
}> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  const validation: Partial<Record<CloudProvider, ProviderValidationResult>> = {};
  const discoveredModels: ModelConfig[] = [];
  const seenIds = new Set(FREE_MODELS.map((m) => normalizeModelId(m.id)));

  try {
    const entries = await Promise.all(
      CLOUD_PROVIDERS.map(async (provider) => ({
        provider,
        result: await validateProviderKey(provider, keys, fetchFn, abort.signal),
      }))
    );
    for (const { provider, result } of entries) {
      validation[provider] = result.validation;
      if (result.validation.status === 'valid') {
        for (const row of result.rows) {
          if (row.active === false) continue;
          const id = canonicalIdFor(provider, row.id) ?? row.id;
          if (!id || id === 'openrouter/free' || id === 'kilo-auto/free') continue;
          if (seenIds.has(normalizeModelId(id))) continue;
          seenIds.add(normalizeModelId(id));
          discoveredModels.push({
            id,
            ...(row.id !== id ? { upstreamModelId: row.id } : {}),
            provider,
            label: row.displayName || row.name || formatReadableModelSlug(id),
            description: `${PROVIDER_INFO[provider].name} catalog model`,
            contextWindow: row.context_length ?? row.context_window ?? row.inputTokenLimit ?? 128_000,
            supportsThinkingLevel: provider === 'gemini',
            supportsReasoningEffort: row.supported_parameters?.includes('reasoning_effort') ?? false,
            isFreeTier: Boolean(catalogRoute(provider, row)),
          });
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  return { validation, discoveredModels };
}

export { classifyProviderFailure };

export async function syncLiveProviderModels(
  keys: ProviderKeys,
  fetchFn: typeof fetch = fetch,
): Promise<{ models: ModelConfig[]; pending: string[]; syncedProviders: string[]; transientProviders: CloudProvider[] }> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 10_000);
  const results = await Promise.allSettled(CLOUD_PROVIDERS.map(async (provider) => ({
    provider,
    rows: await readProviderCatalog(provider, keys, fetchFn, abort.signal),
  }))).finally(() => clearTimeout(timeout));
  const models = new Map<string, ModelConfig>();
  const pending: string[] = [];
  const syncedProviders: string[] = [];
  const transientProviders: CloudProvider[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      if (isTransientCatalogError(result.reason)) transientProviders.push(CLOUD_PROVIDERS[index]);
      continue;
    }
    const { provider, rows } = result.value;
    if (rows.length) syncedProviders.push(PROVIDER_INFO[provider].name);
    for (const row of rows) {
      const route = catalogRoute(provider, row);
      if (!route) continue;
      const evidence = evidenceFor(route);
      const canonical = canonicalIdFor(provider, route.modelId);
      if (!evidence || !canonical) {
        pending.push(`${PROVIDER_INFO[provider].name} · ${route.modelId}`);
        continue;
      }
      const checked = { ...route, tools: route.tools && evidence.tools, images: route.images && evidence.images,
        reasoning: route.reasoning && evidence.reasoning };
      const model = models.get(canonical);
      if (model) model.routes?.push(checked);
      else models.set(canonical, {
        id: canonical, provider, label: row.name?.replace(/\s*\(free\)$/i, '') || formatReadableModelSlug(canonical),
        description: 'Verified free cloud model', isFreeTier: true, contextWindow: checked.contextWindow, routes: [checked],
      });
    }
  }
  return { models: [...models.values()], pending, syncedProviders, transientProviders };
}
