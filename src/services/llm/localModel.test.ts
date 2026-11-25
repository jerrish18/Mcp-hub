import test from 'node:test';
import assert from 'node:assert/strict';
import { getFallbackModelCandidates, dispatchStreamCompletion, getApiKeyForProvider } from './provider';
import { getModelById } from '../../config/models';

test('local model never falls back to a cloud model even if its configuration is missing', () => {
  const local = getModelById('local:fixture');
  assert.equal(local.provider, 'local');
  assert.deepEqual(getFallbackModelCandidates(local.id, { gemini: 'fixture' }), [local]);
});

test('local streaming sends to loopback without API credentials or tool definitions', async () => {
  const model = getModelById('local:fixture');
  const events: string[] = [];
  await dispatchStreamCompletion({ model, apiKey: getApiKeyForProvider('local', {}), effort: 'low', systemPrompt: 'Be concise', messages: [{ role: 'user', text: 'Hello' }], tools: [], onEvent: event => { if (event.type === 'text_delta') events.push(event.delta); }, fetchFn: async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'fixture');
    assert.equal(body.tools, undefined);
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n');
  } });
  assert.deepEqual(events, ['Hello']);
});
