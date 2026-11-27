import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { getModelById } from '../../config/models';
import { createFreeAiRouter } from '../../server/freeAiRouter';
import { formatTraceAsMarkdown, redactRunTrace } from '../../utils/runTrace';
import { streamGeminiCompletion } from './gemini';
import { streamOpenAiCompatibleCompletion } from './openaiCompatible';
import {
  classifyProviderFailure,
  dispatchStreamCompletion,
  getAvailableModels,
  getUnavailableCatalogModelsWithDetails,
  streamWithRateLimitFallback,
  testModelConnection,
  validateAllConfiguredProviderKeys,
} from './provider';
import { validateProviderKey } from './freeRegistry';

test('decoupled key validation marks valid Gemini, Groq, and NVIDIA keys independently of FREE_ROUTE_EVIDENCE', async () => {
  const fetchFn: typeof fetch = async (url) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      return Response.json({ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1000000 }] });
    }
    if (u.includes('api.groq.com')) {
      return Response.json({ data: [{ id: 'llama-3.3-70b-versatile', context_window: 128000 }] });
    }
    if (u.includes('integrate.api.nvidia.com')) {
      return Response.json({ data: [{ id: 'z-ai/glm-5.3-flash' }] });
    }
    if (u.includes('openrouter.ai')) {
      return new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 });
    }
    return Response.json({ data: [] });
  };

  const { validation, discoveredModels } = await validateAllConfiguredProviderKeys(
    {
      gemini: 'AIzaTestKey123',
      groq: 'gsk_test_123',
      nvidia: 'nvapi-test-123',
      openrouter: 'sk-or-bad-key',
    },
    fetchFn
  );

  assert.equal(validation.gemini?.status, 'valid');
  assert.equal(validation.gemini?.badge, 'Valid Key');
  assert.equal(validation.groq?.status, 'valid');
  assert.equal(validation.nvidia?.status, 'valid');
  assert.equal(validation.openrouter?.status, 'invalid_key');
  assert.equal(validation.openrouter?.badge, 'Invalid Key (401)');
  assert.ok(discoveredModels.some((m) => m.id === 'gemini-2.5-flash'));
});

test('validateProviderKey distinguishes unconfigured, 429 rate-limited, 400 unsupported param, and TypeError CORS failures', async () => {
  const unconfigured = await validateProviderKey('groq', {}, fetch);
  assert.equal(unconfigured.validation.status, 'unconfigured');
  assert.equal(unconfigured.validation.badge, 'No Key');

  const rateLimited = await validateProviderKey(
    'groq',
    { groq: 'gsk_123' },
    async () => new Response('Rate limit exceeded', { status: 429 })
  );
  assert.equal(rateLimited.validation.status, 'rate_limited');
  assert.equal(rateLimited.validation.badge, 'Rate Limited (429)');

  const corsBlocked = await validateProviderKey('nvidia', { nvidia: 'nvapi-123' }, async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(corsBlocked.validation.status, 'cors_blocked');
  assert.equal(corsBlocked.validation.badge, 'CORS Blocked');

  const badParam = classifyProviderFailure(400, 'Extra inputs are not permitted: reasoning_effort');
  assert.equal(badParam.status, 'unsupported_param');
  assert.equal(badParam.badge, 'Unsupported Param (400)');
});

test('unavailable catalog details expose explicit badges and allow manual override for valid keys', async () => {
  const keys = { gemini: 'AIzaValidKey', groq: 'gsk_ValidKey' };
  const availableBefore = getAvailableModels(keys, []);
  const detailsBefore = getUnavailableCatalogModelsWithDetails(
    availableBefore,
    keys,
    [],
    {
      gemini: { provider: 'gemini', status: 'valid', checkedAt: Date.now(), modelsFound: 1, badge: 'Valid Key', detail: 'OK' },
      groq: { provider: 'groq', status: 'valid', checkedAt: Date.now(), modelsFound: 1, badge: 'Valid Key', detail: 'OK' },
    },
    {}
  );

  const geminiEntry = detailsBefore.find((e) => e.model.provider === 'gemini');
  assert.ok(geminiEntry);
  assert.equal(geminiEntry.badge, 'Paid/Credit Route');
  assert.equal(geminiEntry.canOverride, true);

  const availableAfter = getAvailableModels(keys, [], [geminiEntry.model.id]);
  assert.ok(availableAfter.some((m) => m.id === geminiEntry.model.id));

  let seenMethod = '';
  let seenKey = '';
  const result = await streamWithRateLimitFallback({
    primaryModelId: geminiEntry.model.id,
    keys,
    manualModelOverrides: [geminiEntry.model.id],
    systemPrompt: 'Hello',
    effort: 'low',
    messages: [{ role: 'user', text: 'Ping' }],
    tools: [],
    fetchFn: async (_url, init) => {
      seenMethod = init?.method ?? 'POST';
      seenKey = new Headers(init?.headers).get('x-goog-api-key') ?? '';
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}\n\n');
    },
    onEvent: () => {},
  });
  assert.equal(seenMethod, 'POST');
  assert.equal(seenKey, 'AIzaValidKey');
  assert.equal(result.usedModel.id, geminiEntry.model.id);
});

test('isProbe strips reasoning_effort and chat_template_kwargs on OpenAI/NVIDIA and thinkingConfig on Gemini, plus HTTP 400 retry', async () => {
  const nvidiaModel = { ...getModelById('z-ai/glm-5.3-flash'), provider: 'nvidia' as const, supportsReasoningEffort: true };

  let probeBody: Record<string, unknown> = {};
  await testModelConnection({
    modelId: 'local:fixture',
    keys: {},
    fetchFn: async (_url, init) => {
      probeBody = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(probeBody.reasoning_effort, undefined);
  assert.equal(probeBody.chat_template_kwargs, undefined);

  // OpenAI-compatible 400 fallback when route rejects reasoning_effort during inference (e.g. Groq)
  let calls = 0;
  const retryBodies: Array<Record<string, unknown>> = [];
  await streamOpenAiCompatibleCompletion({
    model: { ...nvidiaModel, provider: 'groq', supportsReasoningEffort: true },
    apiKey: 'fixture',
    effort: 'high',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: [],
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      calls += 1;
      retryBodies.push(JSON.parse(String(init?.body)));
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }), { status: 400 });
      }
      return new Response('data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(calls, 2);
  assert.equal(retryBodies[0].reasoning_effort, 'high');
  assert.equal(retryBodies[1].reasoning_effort, undefined);

  // OpenRouter 400 fallback strips body.reasoning when rejected
  let orCalls = 0;
  const orBodies: Array<Record<string, unknown>> = [];
  await streamOpenAiCompatibleCompletion({
    model: { ...nvidiaModel, provider: 'openrouter', supportsReasoningEffort: true },
    apiKey: 'fixture',
    effort: 'high',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: [],
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      orCalls += 1;
      orBodies.push(JSON.parse(String(init?.body)));
      if (orCalls === 1) {
        return new Response(JSON.stringify({ error: { message: 'Unsupported parameter: reasoning' } }), { status: 400 });
      }
      return new Response('data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(orCalls, 2);
  assert.deepEqual(orBodies[0].reasoning, { effort: 'high' });
  assert.equal(orBodies[1].reasoning, undefined);

  // Probe on OpenAI-compatible explicitly strips reasoning_effort
  let openAiProbeBody: Record<string, unknown> = {};
  await streamOpenAiCompatibleCompletion({
    model: nvidiaModel,
    apiKey: 'nvapi-test',
    effort: 'high',
    isProbe: true,
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Ping' }],
    tools: [],
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      openAiProbeBody = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(openAiProbeBody.reasoning_effort, undefined);
  assert.equal(openAiProbeBody.chat_template_kwargs, undefined);

  // Gemini probe strips thinkingConfig and invalid key triggers ProviderAuthError (401 semantics)
  let geminiProbePayload: Record<string, unknown> = {};
  await streamGeminiCompletion({
    model: { ...getModelById('gemini-4-hydrogen'), supportsThinkingLevel: true },
    apiKey: 'AIzaTest',
    effort: 'high',
    isProbe: true,
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Ping' }],
    tools: [],
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      geminiProbePayload = JSON.parse(String(init?.body));
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}\n\n');
    },
  });
  assert.equal((geminiProbePayload.generationConfig as Record<string, unknown>)?.thinkingConfig, undefined);
});

test('local model attaches MCP tools only when allowLocalTools is explicitly true', async () => {
  const model = getModelById('local:llama3.2');
  const sampleTools = [
    {
      serverId: 'srv_demo',
      serverName: 'Demo',
      originalName: 'echo',
      qualifiedName: 'srv_demo__echo',
      description: 'Echo input',
      parameters: { type: 'object', properties: {} },
      isReadOnly: true,
      isDestructive: false,
    },
  ];

  let bodyWithoutOptIn: Record<string, unknown> = {};
  await dispatchStreamCompletion({
    model,
    apiKey: 'local',
    effort: 'low',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: sampleTools,
    allowLocalTools: false,
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      bodyWithoutOptIn = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(bodyWithoutOptIn.tools, undefined);

  let bodyWithOptIn: Record<string, unknown> = {};
  await dispatchStreamCompletion({
    model,
    apiKey: 'local',
    effort: 'low',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: sampleTools,
    allowLocalTools: true,
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      bodyWithOptIn = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.ok(Array.isArray(bodyWithOptIn.tools) && bodyWithOptIn.tools.length === 1);
});

test('redactRunTrace scrubs decrypted API keys from RunTrace JSON and Markdown exports', () => {
  const secretGemini = 'AIzaSySecretUnitTestKey12345';
  const secretOpenRouter = 'sk-or-v1-secret-unit-test-key-99999';
  const trace = redactRunTrace(
    {
      startedAt: 1000,
      finishedAt: 2000,
      durationMs: 1000,
      primaryModelId: 'gemini-4-hydrogen',
      usedModelId: 'gemini-4-hydrogen',
      stepsExecuted: 1,
      estimatedPromptTokens: 42,
      toolCalls: [],
      fallbacks: [],
      ragUsed: false,
      stoppedByUser: false,
      error: `Failed with x-goog-api-key=${secretGemini} and Bearer ${secretOpenRouter}`,
      steps: [
        {
          id: 'step_1',
          kind: 'model_call',
          modelId: 'gemini-4-hydrogen',
          error: `Bearer ${secretOpenRouter} rejected`,
          startedAt: 1000,
          durationMs: 500,
          status: 'error',
        },
      ],
    },
    [secretGemini, secretOpenRouter]
  );

  const md = formatTraceAsMarkdown(trace, 'Run Trace', [secretGemini, secretOpenRouter]);
  const json = JSON.stringify(trace);
  assert.equal(json.includes(secretGemini), false);
  assert.equal(json.includes(secretOpenRouter), false);
  assert.equal(md.includes(secretGemini), false);
  assert.equal(md.includes(secretOpenRouter), false);
});

test('freeAiRouter rejects unknown providers and unauthenticated/cross-site inference calls cleanly', async () => {
  const app = express();
  app.use('/api', createFreeAiRouter());
  let server!: http.Server;
  let baseUrl = '';
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  try {
    const unknownProv = await fetch(`${baseUrl}/api/free-ai/evil-ssrf/models`);
    assert.equal(unknownProv.status, 404);

    const noUiHeader = await fetch(`${baseUrl}/api/free-ai/nvidia/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'z-ai/glm-5.3-flash', messages: [] }),
    });
    assert.equal(noUiHeader.status, 403);

    const incompleteCreds = await fetch(`${baseUrl}/api/free-ai/nvidia/models`);
    assert.equal(incompleteCreds.status, 400);

    const unverifiedWithoutOverride = await fetch(`${baseUrl}/api/free-ai/groq/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCPHub-UI': '1',
        Authorization: 'Bearer gsk_fixture_123',
      },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(unverifiedWithoutOverride.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
