import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AgentProfile,
  CodeOrchestrationSettings,
  ModelConfig,
  ProviderKeys,
} from '../../types';
import { compactConversationHistory, runAgentLoop } from './agentLoop';
import {
  createInitialCodingSession,
  parseCodingPlanFromText,
  resolveCodingRoleModel,
  runCodingExecutionPhase,
  runCodingPlanPhase,
} from './codingOrchestrator';
import { getFallbackModelCandidates, getOrchestratorModels, getUnavailableCatalogModelsWithDetails, syncLiveProviderModels } from './provider';
import type { LlmConversationItem } from './types';

const TEST_AGENT: AgentProfile = {
  id: 'agent_code',
  name: 'Code Specialist',
  icon: 'terminal',
  description: 'Coding specialist',
  systemPrompt: 'Write clean modular code.',
  studyInstructions: '',
  defaultModelId: 'demo-sandbox',
  defaultEffort: 'medium',
  defaultChatMode: 'coding',
  allowedServerIds: null,
  allowedToolNames: null,
  isBuiltIn: false,
  createdAt: 1,
  updatedAt: 1,
};

const TEST_KEYS: ProviderKeys = {
  gemini: 'gm-test-12345',
  openrouter: 'or-test-12345',
  groq: '',
  nvidia: '',
  cloudflare: '',
  cloudflareAccountId: '',
  modelscope: '',
  amd: '',
};

test('resolveCodingRoleModel supports custom per-role vs single-model mode', () => {
  const models: ModelConfig[] = [
    {
      id: 'gemini-4-neon',
      provider: 'gemini',
      label: 'Gemini 4 Neon',
      description: 'Reasoning model',
      contextWindow: 1_000_000,
      isFreeTier: true,
    },
    {
      id: 'qwen/qwen3-coder',
      provider: 'openrouter',
      label: 'Qwen3 Coder',
      description: 'Coding specialist',
      contextWindow: 128_000,
      isFreeTier: true,
    },
  ];

  const customOrch: CodeOrchestrationSettings = {
    mode: 'custom',
    roles: {
      architect: 'gemini-4-neon',
      coder: 'qwen/qwen3-coder',
      reviewer: 'gemini-4-neon',
    },
    autoRun: false,
  };

  assert.equal(
    resolveCodingRoleModel('architect', customOrch, models, 'cloud-auto').model.id,
    'gemini-4-neon'
  );
  assert.equal(
    resolveCodingRoleModel('coder', customOrch, models, 'cloud-auto').model.id,
    'qwen/qwen3-coder'
  );

  const singleOrch: CodeOrchestrationSettings = {
    ...customOrch,
    mode: 'single',
  };
  assert.equal(
    resolveCodingRoleModel('coder', singleOrch, models, 'gemini-4-neon').model.id,
    'gemini-4-neon'
  );
});

test('parseCodingPlanFromText extracts fenced CodingPlan JSON and respects autoRun flag', () => {
  const raw = `Here is the plan:\n\`\`\`json\n{"summary":"Build Kanban","requirements":["Drag cards","Filter tasks"],"fileManifest":[{"path":"index.html","action":"create","purpose":"App layout"}],"tasks":[{"id":"t1","title":"Create markup","targetFiles":["index.html"],"verificationCheck":"Balanced HTML"}]}\n\`\`\``;
  const manual = parseCodingPlanFromText(raw, 'Build a Kanban board', false, {});
  assert.equal(manual.phase, 'awaiting_approval');
  assert.equal(manual.summary, 'Build Kanban');
  assert.equal(manual.requirements.length, 2);
  assert.equal(manual.fileManifest[0].path, 'index.html');
  assert.equal(manual.tasks[0].title, 'Create markup');

  const auto = parseCodingPlanFromText(raw, 'Build a Kanban board', true, {});
  assert.equal(auto.phase, 'executing');
  const invalid = parseCodingPlanFromText('partial response', 'Build a Kanban board', true, {});
  assert.equal(invalid.phase, 'awaiting_approval');
  assert.equal(invalid.autoRun, false);
});

test('Spec -> Build -> Verify pipeline executes cleanly in sandbox and self-heals broken workspace files', async () => {
  const session = createInitialCodingSession();
  const controller = new AbortController();
  const orchestration: CodeOrchestrationSettings = {
    mode: 'single',
    roles: { architect: 'demo-sandbox', coder: 'demo-sandbox', reviewer: 'demo-sandbox' },
    autoRun: false,
  };

  const planRes = await runCodingPlanPhase({
    prompt: 'Build a clean task dashboard',
    session,
    orchestration,
    activeModelId: 'demo-sandbox',
    effort: 'medium',
    agent: TEST_AGENT,
    keys: { ...TEST_KEYS, gemini: '', openrouter: '' },
    dynamicModels: [],
    manualModelOverrides: [],
    allowLocalTools: false,
    servers: [],
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: controller.signal,
    callbacks: {
      onPlanUpdated: () => {},
      onSessionUpdated: () => {},
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: () => {},
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.equal(planRes.plan.phase, 'awaiting_approval');
  assert.equal(planRes.plan.subagentTraces[0].role, 'architect');

  // Seed a broken file before execution to verify self-healing pass in Phase 3
  planRes.session.files['broken.js'] = {
    path: 'broken.js',
    content: 'function bad( { return 0; }',
    language: 'javascript',
    status: 'created',
    updatedAt: Date.now(),
  };

  const execRes = await runCodingExecutionPhase({
    plan: planRes.plan,
    session: planRes.session,
    orchestration,
    activeModelId: 'demo-sandbox',
    effort: 'medium',
    agent: TEST_AGENT,
    keys: { ...TEST_KEYS, gemini: '', openrouter: '' },
    dynamicModels: [],
    manualModelOverrides: [],
    allowLocalTools: false,
    servers: [],
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: controller.signal,
    callbacks: {
      onPlanUpdated: () => {},
      onSessionUpdated: () => {},
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: () => {},
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.equal(execRes.plan.phase, 'completed');
  assert.equal(execRes.plan.tasks.every((t) => t.status === 'completed'), true);
  assert.ok(execRes.session.contextStats.estimatedTokens > 0);
  assert.ok(execRes.session.files['index.html']);
  assert.ok(execRes.finalText.includes('```artifact-app'));
});

test('runAgentLoop performs up to 2 silent self-repair retries when tool call fails validation', async () => {
  let callCount = 0;
  const mockFetch = async (_input: RequestInfo | URL): Promise<Response> => {
    callCount++;
    if (callCount === 1) {
      // Malformed call missing required "path" parameter
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_bad_1',
                    type: 'function',
                    function: {
                      name: 'srv_workspace__read_file',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (callCount === 2) {
      // Repaired call with valid "path"
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_ok_2',
                    type: 'function',
                    function: {
                      name: 'srv_workspace__read_file',
                      arguments: '{"path":"index.html"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Read index.html cleanly after repairing the missing argument.',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const traceEntries: Array<{ validationStatus: string; repairAttempts: number }> = [];
  const res = await runAgentLoop({
    agent: TEST_AGENT,
    modelId: 'openai/gpt-oss-120b',
    effort: 'low',
    chatMode: 'coding',
    a2uiEnabled: false,
    keys: TEST_KEYS,
    dynamicModels: [
      {
        id: 'openai/gpt-oss-120b',
        provider: 'openrouter',
        label: 'GPT OSS 120B',
        description: 'OpenRouter test model',
        contextWindow: 128_000,
        isFreeTier: true,
      },
    ],
    manualModelOverrides: ['openai/gpt-oss-120b'],
    allowLocalTools: false,
    servers: [],
    extraTools: [
      {
        qualifiedName: 'srv_workspace__read_file',
        originalName: 'read_file',
        serverId: 'srv_workspace',
        serverName: 'Code Workspace',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        isReadOnly: true,
        isDestructive: false,
      },
    ],
    customToolExecutor: async () => ({ ok: true, text: '1: <h1>Hello</h1>' }),
    history: [{ role: 'user', text: 'Inspect index.html' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch as typeof fetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onToolTraceEntry: (entry) => {
        traceEntries.push({
          validationStatus: entry.validationStatus,
          repairAttempts: entry.repairAttempts,
        });
      },
      onFallbackNotice: () => {},
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.equal(callCount, 3);
  assert.ok(res.finalText.includes('Read index.html cleanly'));
  assert.equal(traceEntries.some((t) => t.validationStatus === 'repaired' && t.repairAttempts >= 1), true);
  assert.equal(traceEntries.some((t) => t.validationStatus === 'valid'), true);
});

test('compactConversationHistory compacts above 75% budget while pinning active plan and latest files', () => {
  const longText = 'x'.repeat(2400);
  const messages: LlmConversationItem[] = [
    { role: 'user', text: 'Initial build prompt' },
    { role: 'assistant', text: longText },
    { role: 'user', text: 'Step 2 feedback' },
    { role: 'assistant', text: longText },
    { role: 'user', text: 'Step 3 feedback' },
    { role: 'assistant', text: longText },
    { role: 'user', text: 'Final check' },
    { role: 'assistant', text: 'Checking now' },
  ];

  const compacted = compactConversationHistory(messages, 2000, 0.75, {
    planSummary: 'Summary: Build modular app',
    files: {
      'app.js': {
        path: 'app.js',
        content: 'console.log("ready");',
        language: 'javascript',
        status: 'modified',
        updatedAt: Date.now(),
      },
    },
  });

  assert.equal(compacted.compacted, true);
  assert.equal(compacted.stats.compacted, true);
  const summaryMsg = compacted.messages.find(
    (m) => m.role === 'user' && 'text' in m && m.text.includes('[Pinned Coding Plan]')
  );
  assert.ok(summaryMsg && 'text' in summaryMsg);
  assert.ok(summaryMsg.text.includes('app.js'));
});

test('linked unverified and expired models are discoverable but never automatically runnable', () => {
  const expiredAt = Date.now() - 60_000;
  const catalog = {
    keys: {
      gemini: 'AIzaTestKey',
      groq: 'gsk_test',
      nvidia: 'nvapi-test',
      modelscope: 'ms-test',
      openrouter: 'sk-or-bad',
      cloudflare: '',
      cloudflareAccountId: '',
      amd: '',
    },
    dynamicModels: [
      {
        id: 'gemini-2.5-flash',
        provider: 'gemini',
        label: 'Gemini 2.5 Flash',
        description: 'Google Gemini catalog model',
        contextWindow: 1_000_000,
        isFreeTier: true,
        supportsThinkingLevel: true,
      },
      {
        id: 'text-embedding-004',
        provider: 'gemini',
        label: 'Embedding 004',
        description: 'Embedding model',
        contextWindow: 2048,
        isFreeTier: true,
      },
      {
        id: 'minimax/minimax-m3.1-flash',
        provider: 'nvidia',
        label: 'Minimax M3.1 Flash',
        description: 'Expired route cached from earlier session',
        contextWindow: 1_000_000,
        isFreeTier: true,
        routes: [
          {
            provider: 'nvidia',
            modelId: 'minimaxai/minimax-m3.1-flash',
            contextWindow: 1_000_000,
            tools: true,
            images: true,
            reasoning: true,
            checkedAt: expiredAt - 1000,
            expiresAt: expiredAt,
          },
        ],
      },
      {
        id: 'custom/my-nvidia-coder',
        provider: 'nvidia',
        label: 'My Custom NVIDIA Coder',
        description: 'Custom user model',
        contextWindow: 128_000,
        isFreeTier: true,
      },
    ],
    providerValidation: {
      nvidia: {
        provider: 'nvidia',
        status: 'valid',
        badge: 'Valid Key',
        detail: 'OK',
        checkedAt: Date.now(),
        modelsFound: 10,
      },
      openrouter: {
        provider: 'openrouter',
        status: 'invalid_key',
        httpStatus: 401,
        badge: 'Invalid Key (401)',
        detail: 'Invalid key',
        checkedAt: Date.now(),
        modelsFound: 0,
      },
    },
  } satisfies Parameters<typeof getOrchestratorModels>[0];

  const available = getOrchestratorModels(catalog);
  assert.deepEqual(available.map((model) => model.id), ['demo-sandbox']);
  const unavailable = getUnavailableCatalogModelsWithDetails(
    available, catalog.keys, catalog.dynamicModels, catalog.providerValidation
  );
  const unavailableIds = unavailable.map((entry) => entry.model.id);
  assert.ok(unavailableIds.includes('minimax/minimax-m3.1-flash'));
  assert.ok(unavailableIds.includes('gemini-2.5-flash'));
  assert.ok(unavailableIds.includes('custom/my-nvidia-coder'));
  assert.ok(!unavailableIds.includes('text-embedding-004'));

  const manualModelOverrides = ['custom/my-nvidia-coder'];
  const explicitlyEnabled = getOrchestratorModels({ ...catalog, manualModelOverrides });
  assert.ok(explicitlyEnabled.some((model) => model.id === manualModelOverrides[0]));
  const automatic = resolveCodingRoleModel('coder', undefined, explicitlyEnabled, 'cloud-auto');
  assert.equal(automatic.model.id, 'demo-sandbox');
  assert.deepEqual(automatic.fallbackChain, []);
  assert.deepEqual(getFallbackModelCandidates('cloud-auto', catalog.keys, explicitlyEnabled, {
    manualModelOverrides, fallbackModelIds: manualModelOverrides, autoFallback: true,
  }), []);
  assert.equal(getFallbackModelCandidates(manualModelOverrides[0], catalog.keys, explicitlyEnabled, {
    manualModelOverrides,
  })[0]?.upstreamModelId, manualModelOverrides[0]);
});

test('Code Orchestrator runs Architect and Coder with verified linked models, skips website artifact hijack, and falls back on 429', async () => {
  const requests: Array<{ model: string; system: string; hasTools: boolean }> = [];
  const fallbacks: Array<{ from: string; to: string }> = [];
  let coderAttempts = 0;

  const mockFetch: typeof fetch = async (url, init) => {
    if (!init?.method || init.method === 'GET') {
      const hostname = new URL(String(url)).hostname;
      if (hostname.includes('nvidia.com')) {
        return Response.json({ data: [{ id: 'moonshotai/kimi-k3.1-pro' }, { id: 'minimaxai/minimax-m3.1-flash' }] });
      }
      if (hostname.includes('modelscope.')) {
        return Response.json({ data: [{ id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', owned_by: 'system' }] });
      }
      return Response.json({ data: [] });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      tools?: unknown[];
    };
    const systemMsg = body.messages.find((m) => m.role === 'system')?.content ?? '';
    requests.push({
      model: body.model,
      system: systemMsg,
      hasTools: Array.isArray(body.tools) && body.tools.length > 0,
    });

    const userMsg = body.messages.find((m) => m.role === 'user')?.content ?? '';
    if (userMsg.includes('[PHASE 1 — ARCHITECT PLANNING]')) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  '```json\n{"summary":"Build Coffee Site","requirements":["Hero header"],"fileManifest":[{"path":"index.html","action":"create","purpose":"Entry HTML"}],"tasks":[{"id":"t1","title":"Build index.html","targetFiles":["index.html"],"verificationCheck":"Valid HTML"}]}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    coderAttempts += 1;
    if (coderAttempts === 1) {
      // First Coder candidate hits 429; orchestrator fallbackChain should transparently try Kimi/next linked model
      return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
        status: 429,
      });
    }

    if (coderAttempts === 2) {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_write_1',
                    type: 'function',
                    function: {
                      name: 'srv_workspace__write_file',
                      arguments: JSON.stringify({
                        path: 'index.html',
                        content: '<!DOCTYPE html><html><head><title>Coffee</title></head><body><h1>Coffee</h1></body></html>',
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Created index.html cleanly.',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const keys: ProviderKeys = { nvidia: 'nvapi-live-test-key', modelscope: 'ms-fixture' };
  const { models, validation } = await syncLiveProviderModels(keys, mockFetch);
  const choices = getOrchestratorModels({ keys, dynamicModels: models, providerValidation: validation });
  const cloudIds = choices.filter((m) => m.provider !== 'demo').map((model) => model.id).sort();
  assert.deepEqual(cloudIds, [
    'deepseek-ai/deepseek-v4.1-flash-1017', 'minimax/minimax-m3.1-flash', 'moonshotai/kimi-k3.1-pro'
  ]);
  const single: CodeOrchestrationSettings = { mode: 'single', roles: { architect: null, coder: null, reviewer: null }, autoRun: false };
  const singleRoles = (['architect', 'coder', 'reviewer'] as const)
    .map((role) => resolveCodingRoleModel(role, single, choices, 'cloud-auto'));
  assert.equal(new Set(singleRoles.map((target) => target.model.id)).size, 1);
  assert.ok(singleRoles.every((target) => target.fallbackChain.length === 0));

  const orchestration: CodeOrchestrationSettings = {
    mode: 'custom',
    roles: {
      architect: 'moonshotai/kimi-k3.1-pro',
      coder: 'minimax/minimax-m3.1-flash',
      reviewer: 'moonshotai/kimi-k3.1-pro',
    },
    autoRun: true,
  };

  const callbacks = {
    onPlanUpdated: () => {},
    onSessionUpdated: () => {},
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCallsUpdated: () => {},
    onFallbackNotice: (from: ModelConfig, to: ModelConfig) => {
      fallbacks.push({ from: from.id, to: to.id });
    },
    requestApproval: async () => 'approve' as const,
    onAlwaysAllowTool: () => {},
    getServerSecrets: async () => ({}),
    saveServerSecrets: async () => {},
  };

  const planRes = await runCodingPlanPhase({
    prompt: 'Build a website for a coffee shop',
    session: createInitialCodingSession(),
    orchestration,
    activeModelId: 'cloud-auto',
    effort: 'medium',
    agent: TEST_AGENT,
    keys,
    dynamicModels: models,
    providerValidation: validation,
    manualModelOverrides: [],
    allowLocalTools: false,
    servers: [],
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks,
  });

  assert.equal(planRes.plan.summary, 'Build Coffee Site');
  assert.equal(requests[0].model, 'moonshotai/kimi-k3.1-pro');
  assert.equal(requests[0].system.includes('start directly with the fenced artifact-app JSON'), false);

  const execRes = await runCodingExecutionPhase({
    plan: planRes.plan,
    session: planRes.session,
    orchestration,
    activeModelId: 'cloud-auto',
    effort: 'medium',
    agent: TEST_AGENT,
    keys,
    dynamicModels: models,
    providerValidation: validation,
    manualModelOverrides: [],
    allowLocalTools: false,
    servers: [],
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks,
  });

  assert.equal(execRes.plan.phase, 'completed');
  assert.ok(execRes.session.files['index.html']);
  assert.equal(requests[1].model, 'minimaxai/minimax-m3.1-flash');
  assert.equal(requests[1].system.includes('start directly with the fenced artifact-app JSON'), false);
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].from, 'minimax/minimax-m3.1-flash');
  assert.notEqual(fallbacks[0].to, 'minimax/minimax-m3.1-flash');

  const abort = new AbortController();
  let emittedPlans = 0;
  await assert.rejects(runCodingPlanPhase({
    prompt: 'Build a website',
    session: createInitialCodingSession(),
    orchestration,
    activeModelId: 'cloud-auto',
    effort: 'medium',
    agent: TEST_AGENT,
    keys,
    dynamicModels: models,
    manualModelOverrides: [],
    allowLocalTools: false,
    servers: [],
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: abort.signal,
    fetchFn: async (url, init) => {
      if (!init?.method || init.method === 'GET') return mockFetch(url, init);
      abort.abort();
      throw new DOMException('Stopped', 'AbortError');
    },
    callbacks: {
      ...callbacks,
      onPlanUpdated: () => { emittedPlans += 1; },
    },
  }), { name: 'AbortError' });
  assert.equal(emittedPlans, 0);

});

