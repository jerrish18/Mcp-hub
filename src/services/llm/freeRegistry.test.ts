import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeModelId } from '../../config/models';
import { catalogRoute } from './freeRegistry';
import { dispatchStreamCompletion, getAvailableModels, streamWithRateLimitFallback, syncLiveProviderModels } from './provider';
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

test('fallback tries another provider for the same canonical identity before output', async () => {
  const model: ModelConfig = { id: 'canonical/model', label: 'Canonical', description: '', provider: 'kilo',
    contextWindow: 128_000, isFreeTier: true };
  const transitions: string[] = [];
  const result = await streamWithRateLimitFallback({
    primaryModelId: model.id, keys: { openrouter: 'fixture' }, systemPrompt: '', effort: 'low', messages: [], tools: [],
    routeFixture: () => [model, { ...model, provider: 'openrouter' }],
    fetchFn: async (url, init) => {
      if (String(url).includes('kilo.ai')) return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
      const body = JSON.parse(String(init?.body ?? '{}'));
      assert.equal(body.provider.max_price.prompt, 0);
      assert.equal(body.provider.max_price.completion, 0);
      return new Response(stream);
    },
    onEvent: () => {},
    onModelFallback: (from, to) => transitions.push(`${from.provider} → ${to.provider}`),
  });
  assert.equal(result.usedModel.id, model.id);
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
