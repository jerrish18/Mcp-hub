import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelId } from '../../config/models';
import { catalogRoute, readProviderCatalog } from './freeRegistry';
import { dispatchStreamCompletion, getAvailableModels, getUnavailableCatalogModels, preserveCatalogForSameCredentials, retainTransientCatalogRoutes, streamWithRateLimitFallback, syncLiveProviderModels } from './provider';
import type { ModelConfig } from '../../types';

const beam = {
  id: 'reflection/beam-free',
  isFree: true,
  pricing: { prompt: '0', completion: '0' },
  supported_parameters: ['tools', 'reasoning'],
};
const stream = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';

test('free policy fails closed for unknown prices, paid add-ons, expired routes and dynamic aliases', () => {
  const free = { id: 'vendor/model:free', pricing: { prompt: '0', completion: '0' } };
  assert.ok(catalogRoute('openrouter', free));
  assert.equal(catalogRoute('openrouter', { ...free, pricing: { prompt: '0' } }), undefined);
  assert.equal(catalogRoute('openrouter', { ...free, pricing: { ...free.pricing, image: '0.01' } }), undefined);
  assert.equal(catalogRoute('openrouter', { ...free, id: 'vendor/model' }), undefined);
  assert.equal(catalogRoute('openrouter', { ...free, id: 'openrouter/free' }), undefined);
  assert.equal(catalogRoute('kilo', { ...beam, expiration_date: '2020-01-01T00:00:00Z' }), undefined);
  assert.equal(catalogRoute('kilo', { ...beam, isFree: false }), undefined);
  assert.equal(catalogRoute('nvidia', { id: 'z-ai/glm-5.3-flash', pricing: { prompt: '0.1', completion: '0' } }), undefined);
  for (const provider of ['cloudflare', 'gemini', 'groq'] as const) {
    assert.equal(catalogRoute(provider, free), undefined);
  }
});

test('the selector includes one canonical model and hides rediscovered unknown candidates', async () => {
  const mockFetch: typeof fetch = async () => Response.json({ data: [beam, { ...beam, id: 'unknown/free' }] });
  const discovered = await syncLiveProviderModels({}, mockFetch);
  assert.deepEqual(discovered.models.map((model) => model.id), ['reflection/beam']);
  assert.deepEqual(discovered.pending, ['Kilo Gateway · unknown/free']);
  assert.deepEqual(getAvailableModels({}, discovered.models).filter((model) => model.routes?.length).map((model) => model.id), ['reflection/beam']);
  assert.equal(normalizeModelId('openai/gpt-oss-120b:free'), normalizeModelId('@cf/openai/gpt-oss-120b'));
  assert.notEqual(normalizeModelId('llama-3.3-70b-versatile'), normalizeModelId('openai/gpt-oss-120b'));
});

test('a route that became paid makes no inference request even if saved discovery still shows it', async () => {
  const route = catalogRoute('kilo', beam);
  assert.ok(route);
  const methods: string[] = [];
  await assert.rejects(dispatchStreamCompletion({
    model: { id: 'reflection/beam', label: 'Beam', description: '', provider: 'kilo',
      contextWindow: 128_000, isFreeTier: true, routes: [route] },
    apiKey: '', systemPrompt: '', effort: 'low', messages: [], tools: [], onEvent: () => {},
    fetchFn: async (_url, init) => {
      methods.push(init?.method ?? 'GET');
      return Response.json({ data: [{ ...beam, pricing: { prompt: '0.1', completion: '0' } }] });
    },
  }), /no currently verified free route/);
  assert.deepEqual(methods, ['GET']);
});

test('two live-verified providers list one canonical model and fall back before output', async () => {
  const modelId = 'nvidia/nemotron-3-ultra-550b-a55b';
  const keys = { openrouter: 'fixture' };
  const row = { ...beam, id: `${modelId}:free` };
  const transitions: string[] = [];
  const fetchFn: typeof fetch = async (url, init) => {
    if (!init?.method || init.method === 'GET') return Response.json({ data: [row] });
    if (String(url).includes('kilo.ai')) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
    const body = JSON.parse(String(init.body ?? '{}'));
    assert.equal(body.model, row.id);
    assert.equal(body.provider.max_price.prompt, 0);
    assert.equal(body.provider.max_price.completion, 0);
    return new Response(stream);
  };
  const { models } = await syncLiveProviderModels(keys, fetchFn);
  const options = getAvailableModels(keys, models).filter((model) => model.routes?.length);
  assert.deepEqual(options.map((model) => model.id), [modelId]);
  assert.deepEqual(options[0].routes?.map((route) => route.provider).sort(), ['kilo', 'openrouter']);
  const result = await streamWithRateLimitFallback({
    primaryModelId: modelId, keys, dynamicModels: models, systemPrompt: '', effort: 'low', messages: [], tools: [],
    fetchFn,
    onEvent: () => {},
    onModelFallback: (from, to) => {
      assert.equal(from.id, modelId);
      assert.equal(to.id, modelId);
      transitions.push(`${from.provider} → ${to.provider}`);
    },
  });
  assert.equal(result.usedModel.id, modelId);
  assert.equal(result.usedModel.provider, 'openrouter');
  assert.deepEqual(transitions, ['kilo → openrouter']);
});

test('fallback preserves partial source after a cloud stream disconnects', async () => {
  const model: ModelConfig = { id: 'canonical/model', label: 'Canonical', description: '', provider: 'kilo',
    contextWindow: 128_000, isFreeTier: true };
  const requests: string[] = [];
  let text = '';
  await assert.rejects(streamWithRateLimitFallback({
    primaryModelId: model.id, keys: { openrouter: 'fixture' }, systemPrompt: '', effort: 'low', messages: [], tools: [],
    routeFixture: () => [model, { ...model, provider: 'openrouter' }],
    fetchFn: async (url) => {
      requests.push(String(url));
      return new Response(stream.replace('data: [DONE]', ''));
    },
    onEvent: (event) => { if (event.type === 'text_delta') text += event.delta; },
  }), /ended the response before completion/);
  assert.equal(text, 'ok');
  assert.equal(requests.length, 1);
});

test('ModelScope only accepts first-party catalog rows without a nonzero price', () => {
  const row = { id: 'MiniMax/MiniMax-M3', owned_by: 'system' };
  assert.ok(catalogRoute('modelscope', row));
  assert.equal(catalogRoute('modelscope', { ...row, owned_by: 'external' }), undefined);
  assert.equal(catalogRoute('modelscope', { ...row, pricing: { prompt: '0.2', completion: '0' } }), undefined);
  assert.equal(normalizeModelId('moonshotai/Kimi-K3.1-Pro'), normalizeModelId('moonshotai/kimi-k3.1-pro'));
});

test('AMD rejects a listed route when its model details conflict with a public free badge', async () => {
  const rows = await readProviderCatalog('amd', { amd: 'fixture' }, async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname === '/radeon/api/v1/models') {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture');
      return Response.json({ data: [{ id: 'GLM-5.3-Flash' }] });
    }
    assert.equal(target.searchParams.get('id'), 'model_gateway:GLM-5.3-Flash');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json({ model: { model: 'GLM-5.3-Flash', enabled: true, status: 'online',
      free: false, pricing: { prompt: '1.4e-7', completion: '2.8e-7' }, display_status: 'free_endpoint' } });
  });
  assert.equal(rows.length, 1);
  assert.equal(catalogRoute('amd', rows[0]), undefined);
});

test('catalog refresh keeps previously checked routes only for temporary failures and unchanged keys', async () => {
  const keys = { openrouter: 'fixture' };
  const row = { ...beam, id: 'nvidia/nemotron-3-ultra-550b-a55b:free' };
  const previous = await syncLiveProviderModels(keys, async () => Response.json({ data: [row] }));
  const refresh = await syncLiveProviderModels(keys, async (url) =>
    String(url).includes('kilo.ai') ? new Response('', { status: 429 })
      : Response.json({ data: [row] }));
  assert.deepEqual(refresh.transientProviders, ['kilo']);
  const merged = retainTransientCatalogRoutes(refresh.models, previous.models, refresh.transientProviders, keys);
  assert.deepEqual(merged[0].routes?.map((route) => route.provider).sort(), ['kilo', 'openrouter']);
  const available = getAvailableModels({}, merged).find((model) => model.id === merged[0].id);
  assert.equal(available?.provider, 'kilo');
  assert.deepEqual(available?.routes?.map((route) => route.provider), ['kilo']);

  const denied = await syncLiveProviderModels(keys, async () => new Response('', { status: 403 }));
  assert.deepEqual(retainTransientCatalogRoutes(denied.models, previous.models, denied.transientProviders, keys), []);
  const changed = preserveCatalogForSameCredentials(previous.models, keys, { openrouter: 'replacement' });
  assert.deepEqual(changed[0].routes?.map((route) => route.provider), ['kilo']);
});

test('older model names remain discoverable without enabling an unverified route', () => {
  const available = getAvailableModels({ gemini: 'saved', groq: 'saved' });
  const older = getUnavailableCatalogModels(available);
  assert.ok(older.some((model) => model.id === 'openai/gpt-oss-120b'));
  assert.ok(older.some((model) => model.id === 'qwen/qwen3.7-plus:free'));
  assert.ok(!older.some((model) => model.id === 'openrouter/free'));
  assert.ok(!available.some((model) => model.id === 'openai/gpt-oss-120b'));
});
