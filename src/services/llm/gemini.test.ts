import test from 'node:test';
import assert from 'node:assert/strict';
import { getModelById } from '../../config/models';
import { streamGeminiCompletion } from './gemini';
import type { LlmStreamEvent } from './types';

function makeSseResponse(chunks: unknown[]): Response {
  const bodyText = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(bodyText));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('streamGeminiCompletion captures trailing thoughtSignature and injects skip_thought_signature_validator when absent in history', async () => {
  const model = getModelById('gemini-3.1-flash-lite');
  const events: LlmStreamEvent[] = [];

  // Step 1: trailing thought_signature arrives in a subsequent part after functionCall
  await streamGeminiCompletion({
    model,
    apiKey: 'AIzaTestKey123456',
    systemPrompt: 'Test system prompt',
    effort: 'medium',
    messages: [{ role: 'user', text: 'List my repos' }],
    tools: [
      {
        qualifiedName: 'srv_github__github_list_repos',
        originalName: 'github_list_repos',
        serverId: 'srv_github',
        serverName: 'GitHub',
        description: 'List repos',
        parameters: { type: 'object', properties: {} },
        isReadOnly: true,
        isDestructive: false,
      },
    ],
    onEvent: (ev) => events.push(ev),
    fetchFn: async () =>
      makeSseResponse([
        {
          candidates: [
            {
              content: {
                parts: [
                  { functionCall: { name: 'srv_github__github_list_repos', args: { perPage: 5 } } },
                ],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                parts: [{ text: '', thought_signature: 'SIG_TRAILING_ABC' }],
              },
            },
          ],
        },
      ]),
  });

  const toolEvent = events.find((e) => e.type === 'tool_calls');
  assert.ok(toolEvent && toolEvent.type === 'tool_calls');
  assert.equal(toolEvent.calls[0].thoughtSignature, 'SIG_TRAILING_ABC');

  // Step 2: sending history where assistant toolCall lacks thoughtSignature includes skip_thought_signature_validator
  let sentBody: { contents?: Array<{ role: string; parts: Array<Record<string, unknown>> }> } = {};
  await streamGeminiCompletion({
    model,
    apiKey: 'AIzaTestKey123456',
    systemPrompt: 'Test system prompt',
    effort: 'medium',
    messages: [
      { role: 'user', text: 'List my repos' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'srv_github__github_list_repos',
            rawArguments: '{}',
            parsedArguments: {},
          },
          {
            id: 'call_2',
            name: 'srv_github__github_list_repos',
            rawArguments: '{}',
            parsedArguments: {},
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call_1',
        toolName: 'srv_github__github_list_repos',
        content: '[]',
      },
    ],
    tools: [],
    onEvent: () => {},
    fetchFn: async (_url, init) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      return makeSseResponse([
        { candidates: [{ content: { parts: [{ text: 'Done.' }] } }] },
      ]);
    },
  });

  const modelMsg = sentBody.contents?.find((c) => c.role === 'model');
  assert.ok(modelMsg);
  assert.equal(modelMsg.parts[0].thoughtSignature, 'skip_thought_signature_validator');
});
