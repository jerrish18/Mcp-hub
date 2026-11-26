import test from 'node:test';
import assert from 'node:assert/strict';
import { getFallbackModelCandidates, dispatchStreamCompletion, getApiKeyForProvider } from './provider';
import { streamOpenAiCompatibleCompletion } from './openaiCompatible';
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

test('stream retains the last text frame and reports an explicit generation limit', async () => {
  const received: string[] = [];
  const lastFrame = 'data: {"choices":[{"delta":{"content":"partial project"},"finish_reason":"length"}]}';
  await assert.rejects(dispatchStreamCompletion({
    model: getModelById('local:fixture'),
    apiKey: getApiKeyForProvider('local', {}),
    effort: 'low',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Build a large project' }],
    tools: [],
    fetchFn: async () => new Response(lastFrame),
    onEvent: (event) => { if (event.type === 'text_delta') received.push(event.delta); },
  }), /reached its output limit/);
  assert.deepEqual(received, ['partial project']);
});

test('distinguishes OpenRouter stream interruption from an explicit completion', async () => {
  const model = { ...getModelById('cloud-auto'), id: 'example/fixture:free' };
  const delta = 'data: {"choices":[{"delta":{"content":"partial project"}}]}\n\n';
  const text: string[] = [];
  const run = (payload: string) => streamOpenAiCompatibleCompletion({
    model, apiKey: 'fixture', effort: 'low', systemPrompt: '',
    messages: [{ role: 'user', text: 'Build a website' }], tools: [],
    fetchFn: async () => new Response(payload),
    onEvent: (event) => { if (event.type === 'text_delta') text.push(event.delta); },
  });
  await assert.rejects(run(delta), /ended the response before completion/);
  assert.deepEqual(text, ['partial project']);
  await run(delta + 'data: [DONE]');
  await assert.rejects(run(delta + 'data: {"choices":[{"finish_reason":"error"}]}'), /stopped generating/);
});

test('NVIDIA GLM 5.3 Flash bounds its default reasoning and clears prior thinking', async () => {
  const model = { ...getModelById('z-ai/glm-5.3-flash'), provider: 'nvidia' as const };
  const inspect = async (effort: 'medium' | 'high') => streamOpenAiCompatibleCompletion({
    model, apiKey: 'fixture', effort, systemPrompt: '', messages: [{ role: 'user', text: 'Hello' }],
    tools: [], onEvent: () => {},
    fetchFn: async (url, init) => {
      assert.equal(String(url), 'https://integrate.api.nvidia.com/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'z-ai/glm-5.3-flash');
      assert.equal(body.reasoning_effort, effort === 'high' ? 'high' : 'low');
      assert.deepEqual(body.chat_template_kwargs, { clear_thinking: true });
      return new Response('data: [DONE]\n\n');
    },
  });
  await inspect('medium');
  await inspect('high');
});
