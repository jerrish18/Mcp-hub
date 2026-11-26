import { FREE_ROUTE_EVIDENCE } from '../../config/freeRouteEvidence.ts';
import { normalizeModelId, PROVIDER_INFO } from '../../config/models.ts';
import type { CloudProvider, ModelConfig, ModelRoute, ProviderKeys } from '../../types/index.ts';

export const CATALOG_TTL = 15 * 60_000;
// NVIDIA Build's hosted developer endpoint is distinct from partner deployments.
const NIM_FREE_MODELS = new Map([
  ['z-ai/glm-5.3-flash', { images: true, tools: true, reasoning: true }],
  ['z-ai/glm-5.3', { images: true, tools: true, reasoning: true }],
  ['nvidia/nemotron-3-ultra-550b-a55b', { images: false, tools: true, reasoning: true }],
  ['nvidia/nemotron-3.5-lightning-30b-a3b', { images: false, tools: true, reasoning: true }],
  ['nvidia/nemotron-3.5-super-vl-120b-a12b', { images: true, tools: true, reasoning: true }],
]);

export const CLOUD_PROVIDERS = ['gemini', 'groq', 'openrouter', 'cloudflare', 'nvidia', 'kilo'] as const;

export function cloudCredential(provider: CloudProvider, keys: ProviderKeys): string {
  return provider === 'kilo' ? '' : keys[provider]?.trim() ?? '';
}

export function providerEndpoint(provider: CloudProvider, account?: string): string | undefined {
  if (provider !== 'cloudflare') return PROVIDER_INFO[provider].baseUrl;
  return account && /^[0-9a-f]{32}$/i.test(account)
    ? `${PROVIDER_INFO.cloudflare.baseUrl}/${account}/ai/v1`
    : undefined;
}

interface CatalogRow {
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
}

function catalogUrl(provider: CloudProvider, keys: ProviderKeys): string | undefined {
  const endpoint = providerEndpoint(provider, keys.cloudflareAccountId);
  if (!endpoint) return;
  return provider === 'cloudflare'
    ? endpoint.replace(/\/v1$/, '/models/search')
    : `${endpoint}/models`;
}

export async function readProviderCatalog(provider: CloudProvider, keys: ProviderKeys, fetcher: typeof fetch, signal?: AbortSignal): Promise<CatalogRow[]> {
  const url = catalogUrl(provider, keys);
  const token = cloudCredential(provider, keys);
  if (!url || (provider !== 'kilo' && !token)) return [];
  const webRelay = typeof window !== 'undefined' && /^https?:$/.test(window.location?.protocol)
    && ['cloudflare', 'nvidia', 'kilo'].includes(provider) && fetcher === fetch;
  const response = await fetcher(webRelay ? `/api/free-ai/${provider}/models` : url, {
    headers: {
      ...(token && provider === 'gemini' ? { 'x-goog-api-key': token } : {}),
      ...(token && provider !== 'gemini' ? { Authorization: `Bearer ${token}` } : {}),
      ...(provider === 'cloudflare' && keys.cloudflareAccountId ? { 'X-MCPHub-Account': keys.cloudflareAccountId } : {}),
    },
    cache: 'no-store', redirect: 'error', signal,
  });
  if (!response.ok) throw new Error(`${PROVIDER_INFO[provider].name} model catalog is unavailable (HTTP ${response.status}).`);
  const body = await response.json();
  const entries = provider === 'gemini' ? body.models : provider === 'cloudflare' ? body.result : body.data;
  if (!Array.isArray(entries)) throw new Error('Provider returned an invalid catalog.');
  return entries.flatMap((item) => {
    const id = provider === 'gemini' ? item?.name?.replace?.(/^models\//, '') : provider === 'cloudflare' ? item?.name : item?.id;
    return typeof id === 'string' ? [{ ...item, id }] : [];
  });
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
  if (provider === 'gemini' || provider === 'groq' || provider === 'cloudflare') return;
  return {
    provider, modelId: row.id,
    contextWindow: row.context_length ?? row.context_window ?? (nim ? 1_000_000 : 128_000),
    maxOutput: row.top_provider?.max_completion_tokens,
    tools: row.supported_parameters?.includes('tools') ?? nim?.tools ?? false,
    images: row.architecture?.input_modalities?.includes('image') ?? nim?.images ?? false,
    reasoning: row.supported_parameters?.some((item) => ['reasoning', 'reasoning_effort', 'include_reasoning'].includes(item)) ?? nim?.reasoning ?? false,
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
