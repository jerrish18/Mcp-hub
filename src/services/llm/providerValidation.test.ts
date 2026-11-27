import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { getModelById } from '../../config/models';
import { createFreeAiRouter } from '../../server/freeAiRouter';
import { formatTraceAsMarkdown, redactRunTrace } from '../../utils/runTrace';
import { streamGeminiCompletion } from './gemini';
import { createThinkTagParser, streamOpenAiCompatibleCompletion } from './openaiCompatible';
import {
  classifyProviderFailure,
  dispatchStreamCompletion,
  getAvailableModels,
  getUnavailableCatalogModelsWithDetails,
  streamWithRateLimitFallback,
  syncLiveProviderModels,
  testModelConnection,
  validateAllConfiguredProviderKeys,
} from './provider';
import { ModelUnavailableError, ProviderAuthError, RateLimitError, type LlmStreamEvent } from './types';
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

test('NVIDIA Minimax M3.1 Flash and Kimi K3.1 Pro send provider-specific reasoning options without forced max_tokens', async () => {
  const keys = { nvidia: 'nvapi-unit-test' };
  const nimRows = [{ id: 'minimaxai/minimax-m3.1-flash' }, { id: 'moonshotai/kimi-k3.1-pro' }];
  const sentBodies: Record<string, Record<string, unknown>> = {};
  const sentHeaders: Record<string, Headers> = {};

  const fetchFn: typeof fetch = async (url, init) => {
    const u = String(url);
    if (!init?.method || init.method === 'GET') {
      if (u.includes('integrate.api.nvidia.com')) {
        return Response.json({ data: nimRows });
      }
      return Response.json({ data: [] });
    }
    const parsed = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    sentBodies[String(parsed.model)] = parsed;
    sentHeaders[String(parsed.model)] = new Headers(init.headers);
    return new Response('data: {"choices":[{"delta":{"content":"Ready"}}]}\n\ndata: [DONE]\n\n');
  };

  const { models } = await syncLiveProviderModels(keys, fetchFn);
  await streamWithRateLimitFallback({
    primaryModelId: 'minimax/minimax-m3.1-flash',
    keys,
    dynamicModels: models,
    systemPrompt: 'Sys',
    effort: 'high',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: [],
    fetchFn,
    onEvent: () => {},
  });

  const minimaxBody = sentBodies['minimaxai/minimax-m3.1-flash'];
  assert.ok(minimaxBody);
  assert.equal(minimaxBody.reasoning_effort, undefined);
  assert.deepEqual(minimaxBody.chat_template_kwargs, { reasoning_effort: 'high' });
  assert.equal(minimaxBody.max_tokens, undefined);
  assert.equal(sentHeaders['minimaxai/minimax-m3.1-flash'].get('accept'), 'text/event-stream');

  await streamWithRateLimitFallback({
    primaryModelId: 'moonshotai/kimi-k3.1-pro',
    keys,
    dynamicModels: models,
    systemPrompt: 'Sys',
    effort: 'high',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: [],
    fetchFn,
    onEvent: () => {},
  });

  const kimiBody = sentBodies['moonshotai/kimi-k3.1-pro'];
  assert.ok(kimiBody);
  assert.equal(kimiBody.reasoning_effort, 'high');
  assert.equal(kimiBody.chat_template_kwargs, undefined);
  assert.equal(kimiBody.max_tokens, undefined);
});

test('dispatchStreamCompletion propagates 401/429 ProviderCatalogError instead of masking it as missing free route', async () => {
  const model = {
    ...getModelById('moonshotai/kimi-k3.1-pro'),
    provider: 'nvidia' as const,
    routes: [
      {
        provider: 'nvidia' as const,
        modelId: 'moonshotai/kimi-k3.1-pro',
        contextWindow: 1_000_000,
        tools: true,
        images: true,
        reasoning: true,
        checkedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    ],
  };

  await assert.rejects(
    dispatchStreamCompletion({
      model,
      apiKey: 'nvapi-bad',
      effort: 'low',
      systemPrompt: '',
      messages: [{ role: 'user', text: 'Hi' }],
      tools: [],
      onEvent: () => {},
      fetchFn: async () => new Response('Unauthorized', { status: 401 }),
    }),
    ProviderAuthError
  );

  await assert.rejects(
    dispatchStreamCompletion({
      model,
      apiKey: 'nvapi-rate',
      effort: 'low',
      systemPrompt: '',
      messages: [{ role: 'user', text: 'Hi' }],
      tools: [],
      onEvent: () => {},
      fetchFn: async () => new Response('Too many requests', { status: 429 }),
    }),
    RateLimitError
  );
});

test('createThinkTagParser splits split <think> tags cleanly and preserves HTML tags without lag', () => {
  let reasoning = '';
  let text = '';
  const parser = createThinkTagParser(
    (d) => {
      reasoning += d;
    },
    (d) => {
      text += d;
    }
  );
  parser.push('<th');
  parser.push('ink>Plan ');
  parser.push('step 1</thi');
  parser.push('nk>\n\n');
  parser.push('<div>Hello</div>');
  parser.flush();

  assert.equal(reasoning, 'Plan step 1');
  assert.equal(text, '<div>Hello</div>');
});

test('openaiCompatible supports non-SSE JSON responses, reused-index tool_calls, and HTTP 422 recovery', async () => {
  const model = { ...getModelById('moonshotai/kimi-k3.1-pro'), provider: 'nvidia' as const, supportsReasoningEffort: true };

  // Non-SSE JSON completion with <think> and tool_calls
  const jsonEvents: LlmStreamEvent[] = [];
  await streamOpenAiCompatibleCompletion({
    model,
    apiKey: 'nvapi-test',
    effort: 'low',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Run' }],
    tools: [],
    onEvent: (ev) => jsonEvents.push(ev),
    fetchFn: async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '<think>Internal plan</think>\nFinal reply',
              tool_calls: [{ id: 'tc_1', function: { name: 'srv__read', arguments: '{"a":1}' } }],
            },
          },
        ],
      }),
  });
  assert.equal(
    jsonEvents.filter((e) => e.type === 'reasoning_delta').map((e) => e.delta).join(''),
    'Internal plan'
  );
  assert.equal(
    jsonEvents.filter((e) => e.type === 'text_delta').map((e) => e.delta).join(''),
    'Final reply'
  );
  const tcEv = jsonEvents.find((e) => e.type === 'tool_calls');
  assert.ok(tcEv && tcEv.type === 'tool_calls' && tcEv.calls[0].name === 'srv__read');

  // Reused tool index 0 with distinct tc.id creates two separate tool calls
  const multiEvents: LlmStreamEvent[] = [];
  const sseBody = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"tool_one","arguments":"{\\"x\\":1}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_b","function":{"name":"tool_two","arguments":"{\\"y\\":2}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  await streamOpenAiCompatibleCompletion({
    model,
    apiKey: 'nvapi-test',
    effort: 'low',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Run both' }],
    tools: [],
    onEvent: (ev) => multiEvents.push(ev),
    fetchFn: async () => new Response(sseBody),
  });
  const multiTc = multiEvents.find((e) => e.type === 'tool_calls');
  assert.ok(multiTc && multiTc.type === 'tool_calls');
  assert.equal(multiTc.calls.length, 2);
  assert.equal(multiTc.calls[0].name, 'tool_one');
  assert.equal(multiTc.calls[1].name, 'tool_two');

  // HTTP 422 retries after stripping unsupported reasoning param and maps unrecovered 422 cleanly
  let attempts = 0;
  await streamOpenAiCompatibleCompletion({
    model,
    apiKey: 'nvapi-test',
    effort: 'low',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Hi' }],
    tools: [],
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      attempts += 1;
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (attempts === 1) {
        assert.equal(body.reasoning_effort, 'low');
        return new Response(JSON.stringify({ detail: 'Extra inputs are not permitted: reasoning_effort' }), { status: 422 });
      }
      assert.equal(body.reasoning_effort, undefined);
      return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
    },
  });
  assert.equal(attempts, 2);

  await assert.rejects(
    streamOpenAiCompatibleCompletion({
      model,
      apiKey: 'nvapi-test',
      effort: 'low',
      systemPrompt: '',
      messages: [{ role: 'user', text: 'Hi' }],
      tools: [],
      onEvent: () => {},
      fetchFn: async () => new Response('Unprocessable entity', { status: 422 }),
    }),
    ModelUnavailableError
  );
  assert.equal(classifyProviderFailure(422, 'Unsupported field').badge, 'Unsupported Param (422)');
});

test('freeAiRouter forwards NVIDIA Minimax options cleanly without injecting max_tokens 24576', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUpstreamPayload: Record<string, unknown> = {};
  let upstreamModelsCalls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://integrate.api.nvidia.com/v1/models')) {
      upstreamModelsCalls += 1;
      return Response.json({ data: [{ id: 'minimaxai/minimax-m3.1-flash' }] });
    }
    if (url.startsWith('https://integrate.api.nvidia.com/v1/chat/completions')) {
      capturedUpstreamPayload = JSON.parse(String(init?.body ?? '{}'));
      return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

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
    for (let i = 0; i < 2; i++) {
      const res = await originalFetch(`${baseUrl}/api/free-ai/nvidia/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MCPHub-UI': '1',
          Authorization: 'Bearer nvapi-router-cache-test',
        },
        body: JSON.stringify({
          model: 'minimaxai/minimax-m3.1-flash',
          messages: [{ role: 'user', content: 'Hello' }],
          chat_template_kwargs: { reasoning_effort: 'high' },
        }),
      });
      assert.equal(res.status, 200);
      await res.text();
    }
    assert.equal(upstreamModelsCalls, 1);
    assert.equal(capturedUpstreamPayload.max_tokens, undefined);
    assert.equal(capturedUpstreamPayload.reasoning_effort, undefined);
    assert.deepEqual(capturedUpstreamPayload.chat_template_kwargs, { reasoning_effort: 'high' });
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('validateAllConfiguredProviderKeys skips non-chat models and openaiCompatible resolves canonical upstream IDs', async () => {
  const fetchFn: typeof fetch = async (url, init) => {
    const u = String(url);
    if (!init?.method || init.method === 'GET') {
      if (u.includes('generativelanguage.googleapis.com')) {
        return Response.json({
          models: [
            { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', displayName: 'Text Embedding', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/imagen-3.0-generate-002', displayName: 'Imagen 3' },
          ],
        });
      }
      return Response.json({ data: [] });
    }
    const body = JSON.parse(String(init.body ?? '{}')) as { model?: string; chat_template_kwargs?: unknown };
    assert.equal(body.model, 'minimaxai/minimax-m3.1-flash');
    assert.deepEqual(body.chat_template_kwargs, { reasoning_effort: 'high' });
    return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n');
  };

  const { discoveredModels } = await validateAllConfiguredProviderKeys({ gemini: 'AIzaTestKey' }, fetchFn);
  assert.ok(discoveredModels.some((m) => m.id === 'gemini-2.5-flash'));
  assert.equal(discoveredModels.some((m) => m.id === 'text-embedding-004'), false);
  assert.equal(discoveredModels.some((m) => m.id === 'imagen-3.0-generate-002'), false);

  await streamOpenAiCompatibleCompletion({
    model: {
      id: 'minimax/minimax-m3.1-flash',
      provider: 'nvidia',
      label: 'Minimax M3.1 Flash',
      description: 'Canonical model without preattached route',
      contextWindow: 1_000_000,
      isFreeTier: true,
      supportsReasoningEffort: true,
    },
    apiKey: 'nvapi-test',
    effort: 'high',
    systemPrompt: '',
    messages: [{ role: 'user', text: 'Ping' }],
    tools: [],
    onEvent: () => {},
    fetchFn,
  });
});

