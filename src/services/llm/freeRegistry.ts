import { FREE_ROUTE_EVIDENCE } from '../../config/freeRouteEvidence.ts';
import { normalizeModelId, PROVIDER_INFO } from '../../config/models.ts';
import type {
  CloudProvider,
  ModelConfig,
  ModelRoute,
  ProviderKeys,
  ProviderKeyStatus,
  ProviderValidationResult,
} from '../../types/index.ts';

export const CATALOG_TTL = 15 * 60_000;
// NVIDIA Build's hosted developer endpoint is distinct from partner deployments.
const NIM_FREE_MODELS = new Map([
  ['moonshotai/kimi-k3.1-pro', { images: true, tools: true, reasoning: true }],
  ['minimaxai/minimax-m3.1-flash', { images: true, tools: true, reasoning: true }],
  ['z-ai/glm-5.3-flash', { images: true, tools: true, reasoning: true }],
  ['z-ai/glm-5.3', { images: true, tools: true, reasoning: true }],
  ['nvidia/nemotron-3-ultra-550b-a55b', { images: false, tools: true, reasoning: true }],
  ['nvidia/nemotron-3.5-lightning-30b-a3b', { images: false, tools: true, reasoning: true }],
  ['nvidia/nemotron-3.5-super-vl-120b-a12b', { images: true, tools: true, reasoning: true }],
]);

// Only ModelScope-hosted routes from its own free inference API are eligible.
const MODELSCOPE_MODELS = new Map([
  ['Qwen-Ambassador/Qwen3.7-Plus', { images: true, tools: true, reasoning: true, contextWindow: 262_144 }],
  ['Qwen/Qwen3.8-27B', { images: true, tools: true, reasoning: true, contextWindow: 262_144 }],
  ['Qwen/Qwen3.5-35B-A3B', { images: true, tools: true, reasoning: true, contextWindow: 262_144 }],
  ['zai-org/GLM-4.7-Flash', { images: false, tools: true, reasoning: true, contextWindow: 200_000 }],
  ['zai-org/GLM-5.2', { images: false, tools: true, reasoning: true, contextWindow: 200_000 }],
  ['moonshotai/Kimi-K3.1-Pro', { images: true, tools: true, reasoning: true, contextWindow: 262_144 }],
  ['MiniMax/MiniMax-M3', { images: true, tools: true, reasoning: true, contextWindow: 262_144 }],
  ['deepseek-ai/DeepSeek-V4.1-Flash-1017', { images: true, tools: true, reasoning: true, contextWindow: 262_144 }],
]);
const AMD_MODELS = new Set(['GLM-5.3-Flash', 'DeepSeek-V4.1-Flash']);

export const CLOUD_PROVIDERS = ['gemini', 'groq', 'openrouter', 'cloudflare', 'nvidia', 'kilo', 'modelscope', 'amd'] as const;
export const FREE_AI_RELAY_PROVIDERS = ['cloudflare', 'nvidia', 'kilo', 'modelscope', 'amd'] as const;

export function isBrowserHttpRuntime(fetcher: typeof fetch): boolean {
  return typeof window !== 'undefined' && /^https?:$/.test(window.location?.protocol) && fetcher === fetch;
}

export function usesFreeAiRelay(provider: CloudProvider, fetcher: typeof fetch): boolean {
  return isBrowserHttpRuntime(fetcher) && FREE_AI_RELAY_PROVIDERS.some((member) => member === provider);
}

export function cloudCredential(provider: CloudProvider, keys: ProviderKeys): string {
  return provider === 'kilo' ? '' : keys[provider]?.trim() ?? '';
}

export function providerEndpoint(provider: CloudProvider, account?: string): string | undefined {
  if (provider !== 'cloudflare') return PROVIDER_INFO[provider].baseUrl;
  return account && /^[0-9a-f]{32}$/i.test(account)
    ? `${PROVIDER_INFO.cloudflare.baseUrl}/${account}/ai/v1`
    : undefined;
}

export interface CatalogRow {
  id: string;
  name?: string;
  active?: boolean;
  displayName?: string;
  context_length?: number;
  context_window?: number;
  inputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number };
  pricing?: Record<string, string | number | null>;
  isFree?: boolean;
  mayTrainOnYourPrompts?: boolean;
  expiration_date?: string | null;
  autoRouting?: unknown;
  owned_by?: string;
  free?: boolean;
  amdFreeVerified?: boolean;
}

function catalogUrl(provider: CloudProvider, keys: ProviderKeys): string | undefined {
  const endpoint = providerEndpoint(provider, keys.cloudflareAccountId);
  if (!endpoint) return;
  return provider === 'cloudflare'
    ? endpoint.replace(/\/v1$/, '/models/search')
    : `${endpoint}/models`;
}

export class ProviderCatalogError extends Error {
  readonly status: number;

  constructor(status: number, provider: CloudProvider, detail?: string) {
    super(
      detail
        ? `${PROVIDER_INFO[provider].name} model catalog is unavailable (HTTP ${status}): ${detail}`
        : `${PROVIDER_INFO[provider].name} model catalog is unavailable (HTTP ${status}).`
    );
    this.status = status;
  }
}

export function isTransientCatalogError(error: unknown): boolean {
  if (error instanceof ProviderCatalogError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export function classifyProviderFailure(
  errOrStatus: unknown,
  detailText = ''
): { status: ProviderKeyStatus; httpStatus?: number; badge: string; detail: string } {
  let httpStatus =
    typeof errOrStatus === 'number'
      ? errOrStatus
      : typeof (errOrStatus as { status?: unknown })?.status === 'number'
        ? ((errOrStatus as { status: number }).status)
        : undefined;
  const rawMessage =
    errOrStatus instanceof Error
      ? errOrStatus.message
      : typeof errOrStatus === 'string'
        ? errOrStatus
        : '';
  const combined = [rawMessage, detailText].filter(Boolean).join(' ').trim();
  const lower = combined.toLowerCase();

  if (httpStatus === undefined) {
    const match = /\b(400|401|402|403|404|429|502|503|504)\b/.exec(combined);
    if (match) httpStatus = Number(match[1]);
  }

  if (
    httpStatus === 401 ||
    (httpStatus === 400 &&
      (lower.includes('api_key_invalid') ||
        lower.includes('api key not valid') ||
        lower.includes('invalid api key'))) ||
    (httpStatus === 403 &&
      !lower.includes('credit') &&
      !lower.includes('billing') &&
      !lower.includes('free access verification') &&
      !lower.includes('free inference'))
  ) {
    return {
      status: 'invalid_key',
      httpStatus: httpStatus ?? 401,
      badge: 'Invalid Key (401)',
      detail: combined || 'Provider rejected the configured API key.',
    };
  }

  if (httpStatus === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      status: 'rate_limited',
      httpStatus: 429,
      badge: 'Rate Limited (429)',
      detail: combined || 'Provider rate limit exceeded.',
    };
  }

  if (
    httpStatus === 402 ||
    lower.includes('payment required') ||
    lower.includes('credit') ||
    lower.includes('billing') ||
    lower.includes('insufficient_quota') ||
    lower.includes('no currently verified free route') ||
    lower.includes('free access verification') ||
    lower.includes('eligible for free inference')
  ) {
    return {
      status: 'paid_route',
      httpStatus: httpStatus ?? 402,
      badge: 'Paid/Credit Route',
      detail: combined || 'Route requires credits or manual override.',
    };
  }

  if (
    httpStatus === 400 ||
    lower.includes('reasoning_effort') ||
    lower.includes('chat_template_kwargs') ||
    lower.includes('unsupported') ||
    lower.includes('unknown field') ||
    lower.includes('extra_forbidden')
  ) {
    return {
      status: 'unsupported_param',
      httpStatus: 400,
      badge: 'Unsupported Param (400)',
      detail: combined || 'Endpoint rejected an unsupported request parameter.',
    };
  }

  if (
    errOrStatus instanceof TypeError ||
    lower.includes('cors') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return {
      status: 'cors_blocked',
      httpStatus,
      badge: 'CORS Blocked',
      detail: combined || 'Browser blocked direct cross-origin request.',
    };
  }

  return {
    status: 'network_error',
    httpStatus,
    badge: httpStatus ? `Network Error (${httpStatus})` : 'Network Error',
    detail: combined || 'Provider endpoint could not be reached.',
  };
}

function buildCatalogHeaders(provider: CloudProvider, keys: ProviderKeys, token: string, viaProxy: boolean): Record<string, string> {
  return {
    ...(token && provider === 'gemini' ? { 'x-goog-api-key': token } : {}),
    ...(token && provider !== 'gemini' ? { Authorization: `Bearer ${token}` } : {}),
    ...(provider === 'cloudflare' && keys.cloudflareAccountId ? { 'X-MCPHub-Account': keys.cloudflareAccountId } : {}),
    ...(viaProxy ? { 'X-MCPHub-UI': '1' } : {}),
  };
}

export async function readProviderCatalogWithMeta(
  provider: CloudProvider,
  keys: ProviderKeys,
  fetcher: typeof fetch,
  signal?: AbortSignal
): Promise<{ rows: CatalogRow[]; viaProxy: boolean }> {
  const url = catalogUrl(provider, keys);
  const token = cloudCredential(provider, keys);
  if (!url || (provider !== 'kilo' && !token)) return { rows: [], viaProxy: false };
  const webRelay = usesFreeAiRelay(provider, fetcher);
  let viaProxy = webRelay;
  let response: Response;
  try {
    response = await fetcher(webRelay ? `/api/free-ai/${provider}/models` : url, {
      headers: buildCatalogHeaders(provider, keys, token, webRelay),
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
  } catch (err) {
    if (!webRelay && isBrowserHttpRuntime(fetcher) && err instanceof TypeError && !signal?.aborted) {
      viaProxy = true;
      response = await fetcher(`/api/free-ai/${provider}/models`, {
        headers: buildCatalogHeaders(provider, keys, token, true),
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } else {
      throw err;
    }
  }
  if (!response.ok) {
    const rawErr = await response.text().catch(() => '');
    let parsedMsg: string;
    try {
      const parsed = JSON.parse(rawErr) as { error?: string | { message?: string }; message?: string };
      parsedMsg = typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error?.message ?? parsed.message ?? '';
    } catch {
      parsedMsg = rawErr.slice(0, 200);
    }
    throw new ProviderCatalogError(response.status, provider, parsedMsg.trim() || undefined);
  }
  const body = await response.json();
  const entries = provider === 'gemini' ? body.models : provider === 'cloudflare' ? body.result : body.data;
  if (!Array.isArray(entries)) throw new Error('Provider returned an invalid catalog.');
  const rows: CatalogRow[] = entries.flatMap((item) => {
    const id = provider === 'gemini' ? item?.name?.replace?.(/^models\//, '') : provider === 'cloudflare' ? item?.name : item?.id;
    return typeof id === 'string' ? [{ ...item, id }] : [];
  });
  if (provider !== 'amd' || viaProxy) return { rows, viaProxy };

  // AMD's public badge can differ from its pricing record. Require proof from
  // the exact model detail endpoint as well as membership in the account catalog.
  const amdRows = await Promise.all(rows.filter((row) => AMD_MODELS.has(row.id)).map(async (row) => {
    const detailUrl = new URL('https://developer.amd.com.cn/radeon/api/tokenfactory/model');
    detailUrl.searchParams.set('id', `model_gateway:${row.id}`);
    const detail = await fetcher(detailUrl, { cache: 'no-store', redirect: 'error', signal });
    if (!detail.ok) return { ...row, amdFreeVerified: false };
    const { model } = await detail.json();
    return {
      ...row,
      amdFreeVerified: model?.model === row.id && model.enabled === true && model.status === 'online'
        && model.free === true && zeroPrice(model.pricing)
        && (!row.pricing || zeroPrice(row.pricing)),
    };
  }));
  return { rows: amdRows, viaProxy };
}

export async function readProviderCatalog(provider: CloudProvider, keys: ProviderKeys, fetcher: typeof fetch, signal?: AbortSignal): Promise<CatalogRow[]> {
  const { rows } = await readProviderCatalogWithMeta(provider, keys, fetcher, signal);
  return rows;
}

export async function validateProviderKey(
  provider: CloudProvider,
  keys: ProviderKeys,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<{ validation: ProviderValidationResult; rows: CatalogRow[] }> {
  const checkedAt = Date.now();
  const token = cloudCredential(provider, keys);
  const endpoint = providerEndpoint(provider, keys.cloudflareAccountId);
  if ((provider !== 'kilo' && !token) || !endpoint) {
    return {
      validation: {
        provider,
        status: 'unconfigured',
        badge: 'No Key',
        detail: provider === 'cloudflare' && token && !endpoint
          ? 'Cloudflare Account ID (32-char hex) is required.'
          : 'No API key configured.',
        checkedAt,
        modelsFound: 0,
      },
      rows: [],
    };
  }
  try {
    const { rows, viaProxy } = await readProviderCatalogWithMeta(provider, keys, fetcher, signal);
    return {
      validation: {
        provider,
        status: 'valid',
        httpStatus: 200,
        badge: 'Valid Key',
        detail: viaProxy
          ? `Authenticated via server proxy (${rows.length} catalog models).`
          : `Authenticated (${rows.length} catalog models).`,
        checkedAt,
        modelsFound: rows.length,
        viaProxy,
      },
      rows,
    };
  } catch (err) {
    const classified = classifyProviderFailure(err);
    return {
      validation: {
        provider,
        status: classified.status,
        httpStatus: classified.httpStatus,
        badge: classified.badge,
        detail: classified.detail,
        checkedAt,
        modelsFound: 0,
      },
      rows: [],
    };
  }
}

function zeroPrice(pricing: CatalogRow['pricing']): boolean {
  if (!pricing || pricing.prompt == null || pricing.completion == null) return false;
  return Object.entries(pricing).every(([field, value]) => field === 'discount' || (
    (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number(value) === 0
  ));
}

/** Hosted routes that can reject paid inference before a request is sent. */
export function catalogRoute(provider: CloudProvider, row: CatalogRow, now = Date.now()): ModelRoute | undefined {
  if (row.active === false || row.autoRouting || row.id === 'openrouter/free' || row.id === 'kilo-auto/free') return;
  const expiry = row.expiration_date ? Date.parse(row.expiration_date) : Infinity;
  if (!(expiry > now)) return;
  const supportsText = !row.architecture?.output_modalities || row.architecture.output_modalities.includes('text');
  if (!supportsText) return;
  if (provider === 'openrouter' && !(row.id.endsWith(':free') && zeroPrice(row.pricing))) return;
  if (provider === 'kilo' && !(row.isFree === true && zeroPrice(row.pricing))) return;
  const nim = provider === 'nvidia' ? NIM_FREE_MODELS.get(row.id) : undefined;
  if (provider === 'nvidia' && (!nim || (row.pricing && !zeroPrice(row.pricing)))) return;
  const scope = provider === 'modelscope' ? MODELSCOPE_MODELS.get(row.id) : undefined;
  if (provider === 'modelscope' && (!scope || row.owned_by !== 'system' || (row.pricing && !zeroPrice(row.pricing)))) return;
  const amd = provider === 'amd' && AMD_MODELS.has(row.id);
  if (provider === 'amd' && (!amd || row.amdFreeVerified !== true || (row.pricing && !zeroPrice(row.pricing)))) return;
  if (provider === 'gemini' || provider === 'groq' || provider === 'cloudflare') return;
  return {
    provider, modelId: row.id,
    contextWindow: row.context_length ?? row.context_window ?? scope?.contextWindow ?? (nim ? 1_000_000 : 128_000),
    maxOutput: row.top_provider?.max_completion_tokens,
    tools: row.supported_parameters?.includes('tools') ?? nim?.tools ?? scope?.tools ?? amd,
    images: row.architecture?.input_modalities?.includes('image') ?? nim?.images ?? scope?.images ?? amd,
    reasoning: row.supported_parameters?.some((item) => ['reasoning', 'reasoning_effort', 'include_reasoning'].includes(item)) ?? nim?.reasoning ?? scope?.reasoning ?? amd,
    dataTerms: row.mayTrainOnYourPrompts ? 'Prompts may be retained and used for training.' : undefined,
    checkedAt: now, expiresAt: Math.min(expiry, now + CATALOG_TTL),
  };
}

export function evidenceFor(route: Pick<ModelRoute, 'provider' | 'modelId'>) {
  return FREE_ROUTE_EVIDENCE.find((entry) => entry.provider === route.provider && entry.modelId === route.modelId);
}

export async function currentVerifiedRoute(route: ModelRoute, keys: ProviderKeys, fetcher: typeof fetch, signal?: AbortSignal) {
  const evidence = evidenceFor(route);
  if (!evidence) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 10_000);
  let rows: CatalogRow[];
  try {
    rows = await readProviderCatalog(route.provider, keys, fetcher, controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  const row = rows.find((candidate) => candidate.id === route.modelId);
  const current = row && catalogRoute(route.provider, row);
  if (!current) return;
  return { ...current, tools: current.tools && evidence.tools, images: current.images && evidence.images,
    reasoning: current.reasoning && evidence.reasoning };
}

export function canonicalIdFor(provider: CloudProvider, modelId: string): string | undefined {
  const evidence = evidenceFor({ provider, modelId });
  if (evidence) return evidence.canonicalId;
  const mapped = normalizeModelId(modelId);
  if (mapped !== modelId) return mapped;
  // Public candidates with unknown identity stay as provider-specific proposals until reviewed.
  return undefined;
}

export function eligibleRoutes(model: ModelConfig, keys: ProviderKeys, now = Date.now()): ModelRoute[] {
  return (model.routes ?? []).filter((route) => {
    const evidence = evidenceFor(route);
    return evidence?.canonicalId === model.id && route.expiresAt > now
      && (route.provider === 'kilo' || Boolean(cloudCredential(route.provider, keys)));
  });
}
