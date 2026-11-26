import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conversation } from '../types';
import { buildConversationFork } from './chatBranches';

const source = {
  id: 'original', title: 'Original', modelId: 'demo', messages: [
    { id: 'one', role: 'user', content: 'Question one' },
    { id: 'two', role: 'assistant', content: 'Original answer', canvasEdit: { artifactId: 'old', kind: 'app' } },
    { id: 'three', role: 'user', content: 'Question two', attachments: [{ id: 'file', name: 'example.txt' }] },
    { id: 'four', role: 'assistant', content: 'Old answer', modelId: 'old-model' },
    { id: 'five', role: 'user', content: 'Later turn' },
  ],
} as Conversation;

test('fork copies through the selected message and isolates Canvas lineage', () => {
  const { conversation } = buildConversationFork(source, { mode: 'fork', messageId: 'two' }, 'forked', 100);
  assert.equal(conversation.id, 'forked');
  assert.deepEqual(conversation.forkedFrom, { conversationId: 'original', messageId: 'two' });
  assert.deepEqual(conversation.messages.map((message) => message.id), ['one', 'two']);
  assert.equal(conversation.messages[1].canvasEdit, undefined);
  assert.ok(source.messages[1].canvasEdit);
  assert.equal(source.messages.length, 5);
});

test('edit and regenerate share the prefix and replay the correct user turn', () => {
  const edit = buildConversationFork(source, { mode: 'edit', messageId: 'three', text: ' Changed ' }, 'edit');
  const regenerate = buildConversationFork(source, { mode: 'regenerate', messageId: 'four', modelId: 'second' }, 'regenerate');
  assert.deepEqual(edit.conversation.messages.map((message) => message.id), ['one', 'two']);
  assert.equal(edit.replay?.content, 'Changed');
  assert.equal(edit.replay?.attachments?.[0].name, 'example.txt');
  assert.equal(regenerate.replay?.content, 'Question two');
  assert.equal(regenerate.conversation.modelId, 'second');
  assert.throws(() => buildConversationFork(source, { mode: 'edit', messageId: 'missing' }, 'edit'), /unavailable/);
});

test('regeneration excludes the source answer model from rate-limit fallbacks', async () => {
  const { FREE_MODELS } = await import('../config/models');
  const { streamWithRateLimitFallback } = await import('../services/llm/provider');
  const [chosen, original] = FREE_MODELS.filter((model) => model.provider === 'groq');
  const attempted: string[] = [];
  await assert.rejects(streamWithRateLimitFallback({
    primaryModelId: chosen.id, excludeFallbackModelId: original.id,
    keys: { groq: 'fixture' }, systemPrompt: '', effort: 'low', tools: [],
    messages: [{ role: 'user', text: 'Repeat the analysis' }], onEvent: () => {},
    onModelAttemptStart: (model) => { attempted.push(model.id); },
    routeFixture: () => [chosen, original],
    fetchFn: async () => new Response('{"error":{"message":"Rate limited"}}', { status: 429 }),
  }), /Rate limit/i);
  assert.equal(attempted[0], chosen.id);
  assert.equal(attempted.includes(original.id), false);
});
