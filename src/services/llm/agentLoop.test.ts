import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentToolCatalog, composeEffectiveSystemPrompt, runAgentLoop } from './agentLoop';
import { syncLiveProviderModels } from './provider';
import { extractReadableApiError } from './types';
import type { AgentProfile, McpServerConfig, ProviderKeys } from '../../types';

const baseAgent: AgentProfile = {
  id: 'agent_test',
  name: 'Test Operator',
  icon: 'terminal',
  description: 'Test agent',
  systemPrompt: 'You are a test agent.',
  defaultModelId: 'openai/gpt-oss-120b',
  defaultEffort: 'medium',
  defaultChatMode: 'professional',
  studyInstructions: '',
  allowedServerIds: null,
  allowedToolNames: null,
  isBuiltIn: false,
  createdAt: 1,
  updatedAt: 1,
};

const virtualServer: McpServerConfig = {
  id: 'srv_virtual',
  name: 'Workspace Sandbox',
  url: 'virtual://mcp-hub-sandbox',
  authType: 'none',
  enabled: true,
  transportPreference: 'auto',
  status: 'connected',
  tools: [
    {
      name: 'calculate_expression',
      description: 'Calc',
      inputSchema: { type: 'object', properties: { expression: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'workspace_create_note',
      description: 'Create note',
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } } },
      annotations: { readOnlyHint: false },
    },
  ],
  resources: [],
  prompts: [],
  disabledTools: [],
};

function makeOpenAiSseResponse(chunks: Array<Record<string, unknown>>, status = 200): Response {
  if (status !== 200) {
    return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status });
  }
  const lines = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(lines, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

test('agentLoop executes read-only tool, enforces write confirmation, and completes loop', async () => {
  let step = 0;
  const mockFetch = (async () => {
    step++;
    if (step === 1) {
      return makeOpenAiSseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tc_1',
                    function: {
                      name: 'srv_virtual__calculate_expression',
                      arguments: '{"expression":"6 * 7"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }
    if (step === 2) {
      return makeOpenAiSseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tc_2',
                    function: {
                      name: 'srv_virtual__workspace_create_note',
                      arguments: '{"title":"Math Result","content":"42"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }
    return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'Done! Created note with 42.' } }] }]);
  }) as typeof fetch;

  const keys: ProviderKeys = { groq: 'gsk_test_123456' };
  const approvalsRequested: string[] = [];
  let alwaysAllowedAdded = '';

  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'high',
    keys,
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Compute 6*7 and save a note' }],
    maxSteps: 10,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: () => {},
      requestApproval: async (a) => {
        approvalsRequested.push(a.toolName);
        return 'always_allow';
      },
      onAlwaysAllowTool: (k) => {
        alwaysAllowedAdded = k;
      },
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.deepEqual(approvalsRequested, ['workspace_create_note']);
  assert.equal(alwaysAllowedAdded, 'srv_virtual:workspace_create_note');
  assert.equal(res.toolCalls.length, 2);
  assert.equal(res.toolCalls[0].status, 'success');
  assert.equal(res.toolCalls[1].status, 'success');
  assert.ok(res.finalText.includes('Done! Created note with 42.'));
});

test('agentLoop automatically falls back on 429 rate-limit error', async () => {
  const modelsHit: string[] = [];
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    modelsHit.push(`${url}:${body.model ?? 'gemini'}`);
    if (url.includes('groq.com')) {
      return makeOpenAiSseResponse([], 429);
    }
    return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'Fallback worked!' } }] }]);
  }) as typeof fetch;

  let fallbackNoticed = '';
  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'low',
    keys: {
      groq: 'gsk_test_123456',
      openrouter: 'sk-or-v1-test123456',
    },
    servers: [],
    history: [{ role: 'user', text: 'Hello' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: (from, to) => {
        fallbackNoticed = `${from.id}->${to.id}`;
      },
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.ok(fallbackNoticed.startsWith('openai/gpt-oss-120b->'));
  assert.equal(res.finalText, 'Fallback worked!');
});

test('agentLoop respects Stop abort signal immediately', async () => {
  const controller = new AbortController();
  controller.abort();

  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'demo-sandbox',
    effort: 'low',
    keys: {},
    servers: [],
    history: [{ role: 'user', text: 'Hello' }],
    maxSteps: 10,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: controller.signal,
    callbacks: {
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

  assert.equal(res.stoppedByUser, true);
  assert.equal(res.stepsExecuted, 0);
});

test('agentLoop falls back automatically on 503 high demand or 404 deprecated model errors', async () => {
  let groqCalls = 0;
  const mockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }),
        { status: 503 }
      );
    }
    if (url.includes('groq.com')) {
      groqCalls++;
      return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'Recovered via Groq!' } }] }]);
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  let fallbackNotice = '';
  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'gemini-4-hydrogen',
    effort: 'low',
    keys: {
      gemini: 'AIzaTest1234567890',
      groq: 'gsk_test_123456',
    },
    servers: [],
    history: [{ role: 'user', text: 'Ping' }],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: (from, to) => {
        fallbackNotice = `${from.id}->${to.id}`;
      },
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.equal(groqCalls, 1);
  assert.ok(fallbackNotice.startsWith('gemini-4-hydrogen->'));
  assert.equal(res.finalText, 'Recovered via Groq!');
});

test('extractReadableApiError unwraps nested JSON API error payloads cleanly', () => {
  const raw = JSON.stringify({
    error: {
      message: 'Qwen3 235B A22B was deprecated on Oct 9, 2026.',
      code: 404,
    },
    user_id: 'user_3MNgwsu4vwqsr5CFX2Ld2Jt3',
  });
  assert.equal(extractReadableApiError(raw), 'Qwen3 235B A22B was deprecated on Oct 9, 2026.');
});

test('syncLiveProviderModels discovers active free tool-calling models from configured providers', async () => {
  const mockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('openrouter.ai/api/v1/models')) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'qwen/qwen3.7-plus:free',
              name: 'Qwen 3.7 Plus',
              context_length: 131072,
              supported_parameters: ['tools', 'reasoning'],
            },
            {
              id: 'paid/model',
              name: 'Paid Only',
              pricing: { prompt: '0.01' },
            },
          ],
        }),
        { status: 200 }
      );
    }
    return new Response('[]', { status: 404 });
  }) as typeof fetch;

  const synced = await syncLiveProviderModels(
    { openrouter: 'sk-or-v1-test' },
    mockFetch
  );
  assert.deepEqual(synced.syncedProviders, ['OpenRouter']);
  assert.equal(synced.models.length, 1);
  assert.equal(synced.models[0].id, 'qwen/qwen3.7-plus:free');
  assert.equal(synced.models[0].supportsReasoningEffort, true);
});

test('buildAgentToolCatalog deduplicates long qualified tool names exceeding 64 chars', () => {
  const longServer: McpServerConfig = {
    ...virtualServer,
    id: 'srv_very_long_server_identifier_123456',
    tools: [
      {
        name: 'extremely_long_mcp_tool_name_that_truncates_ identically_at_sixty_four_alpha',
        description: 'Alpha',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'extremely_long_mcp_tool_name_that_truncates_ identically_at_sixty_four_beta',
        description: 'Beta',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  };

  const { tools } = buildAgentToolCatalog(baseAgent, [longServer]);
  assert.equal(tools.length, 2);
  assert.notEqual(tools[0].qualifiedName, tools[1].qualifiedName);
  assert.ok(tools[0].qualifiedName.length <= 64);
  assert.ok(tools[1].qualifiedName.length <= 64);
});

test('agentLoop unblocks pending write approval immediately on AbortSignal and treats mid-stream 429 SSE errors as fallback', async () => {
  const controller = new AbortController();
  const mockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('groq.com')) {
      return makeOpenAiSseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tc_write',
                    function: {
                      name: 'srv_virtual__workspace_create_note',
                      arguments: '{"title":"T","content":"C"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  const hangingApprovalPromise = runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'low',
    keys: { groq: 'gsk_test_123456' },
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Create a note' }],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: controller.signal,
    fetchFn: mockFetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: () => {},
      requestApproval: () =>
        new Promise<'approve'>(() => {
          setTimeout(() => controller.abort(), 15);
        }),
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  const abortedRes = await hangingApprovalPromise;
  assert.equal(abortedRes.stoppedByUser, true);

  // Mid-stream SSE 429 error chunk should trigger fallback to next model
  let fallbackTriggered = false;
  const sseErrorFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('groq.com')) {
      return makeOpenAiSseResponse([
        { error: { code: 429, message: 'Mid-stream rate limit reached' } },
      ]);
    }
    return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'Recovered after SSE error!' } }] }]);
  }) as typeof fetch;

  const sseRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'low',
    keys: { groq: 'gsk_test_123456', openrouter: 'sk-or-v1-test123456' },
    servers: [],
    history: [{ role: 'user', text: 'Hi' }],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: sseErrorFetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: () => {
        fallbackTriggered = true;
      },
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.equal(fallbackTriggered, true);
  assert.equal(sseRes.finalText, 'Recovered after SSE error!');
});

test('study and general chatModes strip all MCP tools and enforce custom study instructions & knowledge source', async () => {
  const capturedBodies: Array<{ tools?: unknown[]; messages?: Array<{ role: string; content: string }> }> = [];
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      tools?: unknown[];
      messages?: Array<{ role: string; content: string }>;
    };
    capturedBodies.push(body);
    return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'Structured study response.' } }] }]);
  }) as typeof fetch;

  // Study mode with connected virtualServer must send ZERO tools and embed study instructions
  const studyRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'medium',
    chatMode: 'study',
    studyInstructions: '1. Overview\n2. Flashcards',
    knowledgeSource: 'uploaded',
    keys: { groq: 'gsk_test_123456' },
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Teach me recursion' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks: {
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

  assert.equal(studyRes.toolCalls.length, 0);
  assert.equal(studyRes.finalText, 'Structured study response.');
  assert.equal(capturedBodies[0].tools, undefined);
  const sysMsg = capturedBodies[0].messages?.find((m) => m.role === 'system')?.content ?? '';
  assert.ok(sysMsg.includes('1. Overview\n2. Flashcards'));
  assert.ok(sysMsg.includes('UPLOADED FILES & IMAGES ONLY'));

  // General mode also suppresses MCP tools
  const generalPrompt = composeEffectiveSystemPrompt({
    basePrompt: 'Base prompt',
    chatMode: 'general',
    knowledgeSource: 'web',
  });
  assert.ok(generalPrompt.includes('GENERAL CHAT MODE — MCP TOOLS DISABLED'));
  assert.ok(generalPrompt.includes('KNOWLEDGE SOURCE: WEB SEARCH'));
});

test('agentLoop applies ApprovalResolution editedArguments and propagates denyReason guidance to the model', async () => {
  let step = 0;
  const secondStepToolResults: string[] = [];

  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    step++;
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ role: string; content?: string }>;
    };
    if (step === 1) {
      return makeOpenAiSseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tc_edit',
                    function: {
                      name: 'srv_virtual__workspace_create_note',
                      arguments: '{"title":"Draft","content":"Old text"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }
    if (step === 2) {
      for (const m of body.messages ?? []) {
        if (m.role === 'tool' && m.content) secondStepToolResults.push(m.content);
      }
      return makeOpenAiSseResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tc_deny',
                    function: {
                      name: 'srv_virtual__workspace_create_note',
                      arguments: '{"title":"Second","content":"Wait"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      ]);
    }
    for (const m of body.messages ?? []) {
      if (m.role === 'tool' && m.content) secondStepToolResults.push(m.content);
    }
    return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'Handled edits and denial.' } }] }]);
  }) as typeof fetch;

  let approvalCount = 0;
  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'medium',
    chatMode: 'professional',
    keys: { groq: 'gsk_test_123456' },
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Create two notes' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onFallbackNotice: () => {},
      requestApproval: async () => {
        approvalCount++;
        if (approvalCount === 1) {
          return {
            decision: 'approve',
            editedArguments: { title: 'Edited Title', content: 'Updated by user' },
          };
        }
        return {
          decision: 'deny',
          denyReason: 'Skip the second note and summarize instead.',
        };
      },
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.equal(res.toolCalls.length, 2);
  assert.equal(res.toolCalls[0].status, 'success');
  assert.deepEqual(res.toolCalls[0].arguments, { title: 'Edited Title', content: 'Updated by user' });
  assert.equal(res.toolCalls[1].status, 'denied');
  assert.ok(secondStepToolResults.some((c) => c.includes('Skip the second note and summarize instead.')));
  assert.equal(res.finalText, 'Handled edits and denial.');
});

test('agentLoop in Study mode enriches visual prompts with verified web images and appends figure cards when omitted', async () => {
  let capturedSystem = '';
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ role: string; content?: string }>;
    };
    capturedSystem = body.messages?.find((m) => m.role === 'system')?.content ?? '';
    return makeOpenAiSseResponse([{ choices: [{ delta: { content: 'The heart pumps blood via four chambers.' } }] }]);
  }) as typeof fetch;

  let citationsUpdated = 0;
  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'openai/gpt-oss-120b',
    effort: 'medium',
    chatMode: 'study',
    knowledgeSource: 'auto',
    keys: { groq: 'gsk_test_123456' },
    servers: [],
    history: [{ role: 'user', text: 'Show me real images of human heart anatomy' }],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    fetchStudyImages: async (query) => {
      assert.equal(query, 'human heart anatomy');
      return [
        {
          title: 'Diagram of the human heart',
          imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/heart.png',
          pageUrl: 'https://en.wikipedia.org/wiki/Heart',
          source: 'Wikipedia',
          caption: 'Anterior view of human heart chambers.',
        },
      ];
    },
    callbacks: {
      onTextDelta: () => {},
      onReasoningDelta: () => {},
      onToolCallsUpdated: () => {},
      onCitationsUpdated: (cites) => {
        citationsUpdated = cites.length;
      },
      onFallbackNotice: () => {},
      requestApproval: async () => 'approve',
      onAlwaysAllowTool: () => {},
      getServerSecrets: async () => ({}),
      saveServerSecrets: async () => {},
    },
  });

  assert.ok(capturedSystem.includes('[VERIFIED WEB IMAGES FOUND]'));
  assert.ok(capturedSystem.includes('https://upload.wikimedia.org/wikipedia/commons/heart.png'));
  assert.equal(citationsUpdated, 1);
  assert.equal(res.citations.length, 1);
  assert.ok(res.finalText.includes('![Diagram of the human heart](https://upload.wikimedia.org/wikipedia/commons/heart.png'));
});

function makeGeminiSseResponse(chunks: Array<Record<string, unknown>>): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

test('Gemini provider preserves thoughtSignature across parallel multi-turn function calls and coalesces tool responses', async () => {
  let step = 0;
  const capturedBodies: Array<{
    contents?: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  }> = [];

  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    step++;
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      contents?: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    capturedBodies.push(body);

    if (step === 1) {
      // Simulate Gemini 3/4 response: thought part with thoughtSignature + two parallel functionCall parts
      return makeGeminiSseResponse([
        {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Planning calculations...', thought: true, thoughtSignature: 'sig_thought_abc123' },
                  { functionCall: { name: 'srv_virtual__calculate_expression', args: { expression: '2 + 3' } } },
                  {
                    functionCall: { name: 'srv_virtual__calculate_expression', args: { expression: '4 * 5' } },
                    thought_signature: 'sig_inline_def456',
                  },
                ],
              },
            },
          ],
        },
      ]);
    }

    return makeGeminiSseResponse([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'Results are 5 and 20.' }],
            },
          },
        ],
      },
    ]);
  }) as typeof fetch;

  const res = await runAgentLoop({
    agent: baseAgent,
    modelId: 'gemini-3.1-flash-lite',
    effort: 'high',
    chatMode: 'professional',
    keys: { gemini: 'AIzaTestSignature123456' },
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Compute 2+3 and 4*5' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    fetchFn: mockFetch,
    callbacks: {
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

  assert.equal(step, 2);
  assert.equal(res.finalText, 'Results are 5 and 20.');
  assert.equal(res.toolCalls.length, 2);

  // Inspect Step 2 contents payload sent back to Gemini
  const step2Contents = capturedBodies[1]?.contents ?? [];
  assert.equal(step2Contents.length, 3); // [user prompt, model tool calls, coalesced user tool responses]
  assert.equal(step2Contents[1].role, 'model');
  assert.equal(step2Contents[1].parts[0].thoughtSignature, 'sig_thought_abc123');
  assert.equal(step2Contents[1].parts[1].thoughtSignature, 'sig_inline_def456');

  // Consecutive tool responses must be coalesced into ONE user message with two functionResponse parts
  assert.equal(step2Contents[2].role, 'user');
  assert.equal(step2Contents[2].parts.length, 2);
  assert.ok('functionResponse' in step2Contents[2].parts[0]);
  assert.ok('functionResponse' in step2Contents[2].parts[1]);
});

test('Pro mode system prompt enforces strict PDF/app routing and demoProvider generates artifact-pdf and artifact-app without workspace notes', async () => {
  const proPrompt = composeEffectiveSystemPrompt({
    basePrompt: 'General assistant',
    chatMode: 'professional',
  });
  assert.ok(proPrompt.includes('NEVER call `workspace_create_note`'));
  assert.ok(proPrompt.includes('artifact-app'));
  assert.ok(proPrompt.includes('github_push_files_batch'));

  const pdfRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'demo-sandbox',
    effort: 'medium',
    chatMode: 'professional',
    keys: {},
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Generate me a pdf about giraffe' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    callbacks: {
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

  assert.equal(pdfRes.toolCalls.length, 0);
  assert.ok(pdfRes.finalText.includes('```artifact-pdf'));
  assert.ok(pdfRes.finalText.includes('Giraffe Briefing'));

  const appRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'demo-sandbox',
    effort: 'medium',
    chatMode: 'professional',
    keys: {},
    servers: [virtualServer],
    history: [{ role: 'user', text: 'Build a multi-file web app taskboard' }],
    maxSteps: 5,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    callbacks: {
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

  assert.ok(appRes.finalText.includes('```artifact-app'));
  assert.ok(appRes.finalText.includes('Sprint Taskboard Pro'));
});

test('A2UI toggle controls system prompt instructions and demoProvider output across chat modes', async () => {
  const enabledPrompt = composeEffectiveSystemPrompt({
    basePrompt: 'Helpful assistant',
    chatMode: 'general',
    a2uiEnabled: true,
  });
  assert.ok(enabledPrompt.includes('[A2UI INTERACTIVE WIDGETS ENABLED]'));

  const disabledPrompt = composeEffectiveSystemPrompt({
    basePrompt: 'Helpful assistant',
    chatMode: 'general',
    a2uiEnabled: false,
  });
  assert.ok(disabledPrompt.includes('[A2UI INTERACTIVE WIDGETS DISABLED]'));

  const makeCallbacks = () => ({
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCallsUpdated: () => {},
    onFallbackNotice: () => {},
    requestApproval: async () => 'approve' as const,
    onAlwaysAllowTool: () => {},
    getServerSecrets: async () => ({}),
    saveServerSecrets: async () => {},
  });

  const a2uiOnRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'demo-sandbox',
    effort: 'medium',
    chatMode: 'general',
    a2uiEnabled: true,
    keys: {},
    servers: [],
    history: [{ role: 'user', text: 'Plan my weekly study schedule' }],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    callbacks: makeCallbacks(),
  });
  assert.ok(a2uiOnRes.finalText.includes('```a2ui'));

  const a2uiOffRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'demo-sandbox',
    effort: 'medium',
    chatMode: 'general',
    a2uiEnabled: false,
    keys: {},
    servers: [],
    history: [{ role: 'user', text: 'Plan my weekly study schedule' }],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    callbacks: makeCallbacks(),
  });
  assert.equal(a2uiOffRes.finalText.includes('```a2ui'), false);

  const solarPdfRes = await runAgentLoop({
    agent: baseAgent,
    modelId: 'demo-sandbox',
    effort: 'medium',
    chatMode: 'professional',
    a2uiEnabled: true,
    keys: {},
    servers: [virtualServer],
    history: [
      {
        role: 'user',
        text: 'Generate a detailed PDF about solar energy covering photovoltaic cells, grid storage, and efficiency comparison table',
      },
    ],
    maxSteps: 3,
    confirmBeforeWrite: true,
    alwaysAllowedTools: [],
    signal: new AbortController().signal,
    callbacks: makeCallbacks(),
  });
  assert.ok(solarPdfRes.finalText.includes('```artifact-pdf'));
  assert.ok(solarPdfRes.finalText.includes('Photovoltaic Cells'));
  assert.ok(solarPdfRes.finalText.includes('Grid Storage'));
  assert.ok(solarPdfRes.finalText.includes('```a2ui'));
});
