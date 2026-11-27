import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Router, json } from 'express';
import { nvidiaRequestOptions } from '../services/llm/nvidiaOptions.ts';
import {
  catalogRoute,
  type CatalogRow,
  CLOUD_PROVIDERS,
  evidenceFor,
  ProviderCatalogError,
  providerEndpoint,
  readProviderCatalog,
} from '../services/llm/freeRegistry.ts';
import type { CloudProvider } from '../types/index.ts';
import { redactSecrets } from '../utils/redact.ts';

const CATALOG_CACHE_TTL_MS = 60_000;
const MAX_CATALOG_CACHE_ENTRIES = 100;
const catalogCache = new Map<string, { expiresAt: number; rows: CatalogRow[] }>();

function catalogCacheKey(provider: CloudProvider, token: string, account?: string): string {
  const tokenHash = token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : 'anon';
  return `${provider}:${tokenHash}:${account ?? ''}`;
}

async function getCachedProviderCatalog(
  provider: Exclude<CloudProvider, 'gemini'>,
  token: string,
  account: string | undefined,
  signal: AbortSignal,
): Promise<CatalogRow[]> {
  const key = catalogCacheKey(provider, token, account);
  const now = Date.now();
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.rows;
  }
  const rows = await readProviderCatalog(
    provider,
    { [provider]: token, ...(account ? { cloudflareAccountId: account } : {}) },
    fetch,
    signal
  );
  if (catalogCache.size >= MAX_CATALOG_CACHE_ENTRIES) {
    const firstKey = catalogCache.keys().next().value;
    if (firstKey !== undefined) catalogCache.delete(firstKey);
  }
  catalogCache.set(key, { expiresAt: now + CATALOG_CACHE_TTL_MS, rows });
  return rows;
}

function readProviderToken(provider: CloudProvider, req: import('express').Request): string {
  if (provider === 'kilo') return '';
  if (provider === 'gemini') {
    const googKey = req.get('x-goog-api-key')?.trim();
    if (googKey) return googKey;
  }
  const auth = req.get('authorization')?.trim() ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

async function readSafeUpstreamError(upstream: Response, token: string): Promise<string> {
  const raw = await upstream.text().catch(() => '');
  let msg = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: string | { message?: string }; message?: string };
    if (typeof parsed.error === 'string') msg = parsed.error;
    else if (parsed.error?.message) msg = parsed.error.message;
    else if (parsed.message) msg = parsed.message;
  } catch {
    // keep text preview
  }
  const clean = redactSecrets(String(msg ?? '').trim(), token ? [token] : []);
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
}

export function createFreeAiRouter() {
  const router = Router();
  router.use(json({ limit: '8mb' }));

  router.all('/free-ai/:provider/:resource/:action?', async (req, res) => {
    const provider = CLOUD_PROVIDERS.find((value) => value === req.params.provider);
    const isCatalog = req.method === 'GET' && req.params.resource === 'models' && !req.params.action;
    const isInference = req.method === 'POST' && req.params.resource === 'chat' && req.params.action === 'completions';
    if (!provider || (!isCatalog && !isInference)) {
      res.sendStatus(404);
      return;
    }
    if (isInference && (req.get('X-MCPHub-UI') !== '1' || req.get('Sec-Fetch-Site') === 'cross-site')) {
      res.sendStatus(403);
      return;
    }
    const endpoint = providerEndpoint(provider, req.get('X-MCPHub-Account'));
    const token = readProviderToken(provider, req);
    if (!endpoint || (provider !== 'kilo' && (!token || /\s/.test(token)))) {
      res.status(400).json({ error: 'Provider credentials are incomplete.' });
      return;
    }

    const catalog = provider === 'cloudflare' ? endpoint.replace(/\/v1$/, '/models/search') : `${endpoint}/models`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      if (provider === 'gemini') headers['x-goog-api-key'] = token;
      else headers.Authorization = `Bearer ${token}`;
    }
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(isCatalog ? 10_000 : 150_000)]);
    res.set('Cache-Control', 'no-store');
    try {
      if (isCatalog && provider === 'amd') {
        const data = await readProviderCatalog(provider, { amd: token }, fetch, signal);
        res.json({ data });
        return;
      }
      if (isCatalog) {
        const upstream = await fetch(catalog, { headers, signal, redirect: 'error' });
        if (!upstream.ok) {
          const detail = await readSafeUpstreamError(upstream, token);
          res.status(upstream.status).json({ error: detail || 'Provider catalog is unavailable.' });
          return;
        }
        res.json(await upstream.json());
        return;
      }
      const manualOverride = req.get('X-MCPHub-Manual-Override') === '1' && Boolean(token);
      if (provider === 'gemini') {
        await relayGeminiInference(endpoint, token, headers, req.body ?? {}, manualOverride, signal, res);
        return;
      }
      await relayOpenAiInference(
        provider,
        endpoint,
        token,
        req.get('X-MCPHub-Account'),
        headers,
        req.body ?? {},
        manualOverride,
        signal,
        res
      );
    } catch (err) {
      if (res.headersSent) res.end();
      else if (err instanceof ProviderCatalogError) {
        const clean = redactSecrets(err.message, token ? [token] : []);
        res.status(err.status).json({ error: clean || 'Provider catalog is unavailable.' });
      } else if (!abort.signal.aborted) {
        res.status(503).json({ error: 'Provider connection was interrupted.' });
      }
    }
  });

  return router;
}

async function relayGeminiInference(
  endpoint: string,
  token: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  manualOverride: boolean,
  signal: AbortSignal,
  res: import('express').Response,
) {
  const modelId = typeof body.model === 'string' ? body.model.trim() : '';
  const payload = body.payload;
  if (!modelId || !/^[a-zA-Z0-9._:-]{1,128}$/.test(modelId) || !payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Invalid Gemini inference payload.' });
    return;
  }
  if (!manualOverride) {
    const evidence = evidenceFor({ provider: 'gemini', modelId });
    if (!evidence) {
      res.status(403).json({ error: 'This provider route has not passed free access verification.' });
      return;
    }
  }
  const upstreamUrl = `${endpoint}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers,
    signal,
    redirect: 'error',
    body: JSON.stringify(payload),
  });
  for (const name of ['retry-after', 'x-ratelimit-remaining-requests']) {
    const value = upstream.headers.get(name);
    if (value) res.set(name, value);
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await readSafeUpstreamError(upstream, token);
    res.status(upstream.ok ? 502 : upstream.status).json({ error: detail || 'Gemini could not complete the request.' });
    return;
  }
  res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>).on('error', () => res.destroy()).pipe(res);
}

async function relayOpenAiInference(
  provider: Exclude<CloudProvider, 'gemini'>,
  endpoint: string,
  token: string,
  cloudflareAccountId: string | undefined,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  manualOverride: boolean,
  signal: AbortSignal,
  res: import('express').Response,
) {
  const modelId = typeof body.model === 'string' ? body.model : '';
  if (!modelId || !Array.isArray(body.messages)) {
    res.status(400).json({ error: 'Invalid inference request.' });
    return;
  }

  let effectiveMaxOutput: number | undefined;
  if (!manualOverride) {
    const evidence = evidenceFor({ provider, modelId });
    if (!evidence) {
      res.status(403).json({ error: 'This provider route has not passed free access verification.' });
      return;
    }
    const rows = await getCachedProviderCatalog(provider, token, cloudflareAccountId, signal);
    const row = rows.find((entry) => entry.id === modelId);
    const route = row && catalogRoute(provider, row);
    if (!route) {
      res.status(403).json({ error: 'The provider no longer lists this model as eligible for free inference.' });
      return;
    }
    if (body.tools && (!evidence.tools || !route.tools)) {
      res.status(400).json({ error: 'Tool use is unavailable on this verified route.' });
      return;
    }
    effectiveMaxOutput = route.maxOutput;
  }

  const requestedMax = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? Math.floor(body.max_tokens) : undefined;
  const cappedMax = requestedMax !== undefined
    ? Math.min(requestedMax, effectiveMaxOutput ?? 24576, 24576)
    : effectiveMaxOutput !== undefined
      ? Math.min(effectiveMaxOutput, 24576)
      : undefined;
  const templateOptions = body.chat_template_kwargs;
  const effort = body.reasoning_effort ?? (templateOptions && typeof templateOptions === 'object'
    && 'reasoning_effort' in templateOptions ? (templateOptions as { reasoning_effort?: unknown }).reasoning_effort : undefined);
  const nvidiaOptions = provider === 'nvidia' && effort !== undefined ? nvidiaRequestOptions(modelId, effort) : undefined;
  const upstreamPayload: Record<string, unknown> = {
    model: modelId,
    messages: body.messages,
    stream: true,
    ...(cappedMax !== undefined ? { max_tokens: cappedMax } : {}),
    ...(body.tools
      ? {
          tools: body.tools,
          ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
        }
      : {}),
    ...(nvidiaOptions
      ? nvidiaOptions
      : {
          ...(body.reasoning_effort !== undefined ? { reasoning_effort: body.reasoning_effort } : {}),
          ...(templateOptions && typeof templateOptions === 'object'
            ? { chat_template_kwargs: templateOptions }
            : {}),
        }),
    ...(body.reasoning !== undefined && provider === 'openrouter' ? { reasoning: body.reasoning } : {}),
    ...(provider === 'openrouter' && body.provider ? { provider: body.provider } : {}),
  };

  const upstream = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: nvidiaOptions || provider === 'nvidia' ? { ...headers, Accept: 'text/event-stream' } : headers,
    signal,
    redirect: 'error',
    body: JSON.stringify(upstreamPayload),
  });
  for (const name of ['retry-after', 'x-ratelimit-remaining-requests']) {
    const value = upstream.headers.get(name);
    if (value) res.set(name, value);
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await readSafeUpstreamError(upstream, token);
    res.status(upstream.ok ? 502 : upstream.status).json({ error: detail || 'Provider could not complete the request.' });
    return;
  }
  res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>).on('error', () => res.destroy()).pipe(res);
}
