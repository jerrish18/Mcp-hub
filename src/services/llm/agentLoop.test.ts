import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from './agentLoop';
import type { AgentProfile, McpServerConfig, ProviderKeys } from '../../types';

const baseAgent: AgentProfile = {
  id: 'agent_test',
  name: 'Test Operator',
  icon: 'terminal',
  description: 'Test agent',
  systemPrompt: 'You are a test agent.',
  defaultModelId: 'llama-3.3-70b-versatile',
  defaultEffort: 'medium',
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
    modelId: 'llama-3.3-70b-versatile',
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
    modelId: 'llama-3.3-70b-versatile',
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

  assert.ok(fallbackNoticed.startsWith('llama-3.3-70b-versatile->'));
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
