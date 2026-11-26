import { Readable } from 'node:stream';
import { Router, json } from 'express';
import { nvidiaRequestOptions } from '../services/llm/nvidiaOptions.ts';
import { catalogRoute, evidenceFor, FREE_AI_RELAY_PROVIDERS, providerEndpoint, readProviderCatalog } from '../services/llm/freeRegistry.ts';

type RelayProvider = typeof FREE_AI_RELAY_PROVIDERS[number];

export function createFreeAiRouter() {
  const router = Router();
  router.use(json({ limit: '8mb' }));

  router.all('/free-ai/:provider/:resource/:action?', async (req, res) => {
    const provider = FREE_AI_RELAY_PROVIDERS.find((value) => value === req.params.provider);
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
    const authorization = provider === 'kilo' ? undefined : req.get('authorization');
    if (!endpoint || (provider !== 'kilo' && !/^Bearer [^\s]+$/.test(authorization ?? ''))) {
      res.status(400).json({ error: 'Provider credentials are incomplete.' });
      return;
    }

    const catalog = provider === 'cloudflare' ? endpoint.replace(/\/v1$/, '/models/search') : `${endpoint}/models`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(isCatalog ? 10_000 : 150_000)]);
    res.set('Cache-Control', 'no-store');
    try {
      if (isCatalog && provider === 'amd') {
        const data = await readProviderCatalog(provider, { amd: authorization?.slice(7) }, fetch, signal);
        res.json({ data });
        return;
      }
      if (isCatalog) {
        const upstream = await fetch(catalog, { headers, signal, redirect: 'error' });
        if (!upstream.ok) {
          res.status(upstream.status).json({ error: 'Provider catalog is unavailable.' });
          return;
        }
        res.json(await upstream.json());
        return;
      }
      await relayInference(provider, endpoint, headers, req.body ?? {}, signal, res);
    } catch {
      if (res.headersSent) res.end();
      else if (!abort.signal.aborted) res.status(503).json({ error: 'Free provider connection was interrupted.' });
    }
  });

  return router;
}

async function relayInference(
  provider: RelayProvider, endpoint: string, headers: Record<string, string>,
  body: Record<string, unknown>, signal: AbortSignal, res: import('express').Response,
) {
  const modelId = typeof body.model === 'string' ? body.model : '';
  const evidence = evidenceFor({ provider, modelId });
  if (!evidence || !Array.isArray(body.messages)) {
    res.status(403).json({ error: 'This provider route has not passed free access verification.' });
    return;
  }
  const token = headers.Authorization?.slice(7);
  const rows = await readProviderCatalog(provider, { [provider]: token }, fetch, signal);
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
  const requestedMax = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? Math.floor(body.max_tokens) : 24576;
  const templateOptions = body.chat_template_kwargs;
  const effort = body.reasoning_effort ?? (templateOptions && typeof templateOptions === 'object'
    && 'reasoning_effort' in templateOptions ? templateOptions.reasoning_effort : undefined);
  const nvidiaOptions = provider === 'nvidia' ? nvidiaRequestOptions(modelId, effort) : undefined;
  const upstream = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST', headers: nvidiaOptions ? { ...headers, Accept: 'text/event-stream' } : headers, signal, redirect: 'error',
    body: JSON.stringify({ model: modelId, messages: body.messages, stream: true,
      max_tokens: Math.min(requestedMax, route.maxOutput ?? 24576, 24576), tools: body.tools, tool_choice: body.tool_choice, ...nvidiaOptions }),
  });
  for (const name of ['retry-after', 'x-ratelimit-remaining-requests']) {
    const value = upstream.headers.get(name);
    if (value) res.set(name, value);
  }
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.ok ? 502 : upstream.status).json({ error: 'Free provider could not complete the request.' });
    return;
  }
  res.set({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>).on('error', () => res.destroy()).pipe(res);
}
