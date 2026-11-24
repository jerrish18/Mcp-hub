import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FREE_MODELS } from '../../config/models';
import type { ChatMessage, ModelConfig } from '../../types';
import { buildVerificationInput, eligibleReviewModels, verifyAnswer } from './verifyAnswer';

const model = FREE_MODELS.find((entry) => entry.provider === 'groq')!;
const keys = { groq: 'gsk_fixture_private_provider_value' };
const same: ModelConfig = { ...model };
const answer: ChatMessage = {
  id: 'reply', role: 'assistant', content: 'An answer. ' + keys.groq, createdAt: 1,
  toolCalls: [{
    id: 'tool', serverId: 's', serverName: 'Reports', toolName: 'read', arguments: { ignored: 'never-sent' },
    status: 'error', isReadOnly: true, startedAt: 1, result: '{"api_key":"hidden secret","total":4}',
  }],
};

test('verification selects a distinct configured free model and redacts the evidence', () => {
  assert.deepEqual(eligibleReviewModels([same], keys, model.id), []);
  assert.deepEqual(eligibleReviewModels([{ ...same, isFreeTier: false }], keys), []);
  assert.deepEqual(eligibleReviewModels([same], {}), []);
  const input = buildVerificationInput('Check the report', answer, keys);
  assert.match(input, /Reports \/ read/);
  assert.match(input, /total.*4/);
  assert.doesNotMatch(input, /hidden secret|fixture_private|never-sent/);
});

test('verification makes one tool-free call and accumulates findings separately', async () => {
  const seen: string[] = [];
  await verifyAnswer({ question: 'Check', answer, model, keys, signal: new AbortController().signal,
    onText: (text) => seen.push(text) }, async (request) => {
    assert.equal(request.model.id, model.id);
    assert.deepEqual(request.tools, []);
    assert.equal(request.a2uiEnabled, false);
    request.onEvent({ type: 'text_delta', delta: 'Finding: ' });
    request.onEvent({ type: 'text_delta', delta: 'tool failed' });
  });
  assert.equal(seen.at(-1), 'Finding: tool failed');
  assert.match(answer.content, /An answer/);
});
