import test from 'node:test';
import assert from 'node:assert/strict';
import { searchConversations, summarizeWorkspaceUsage } from './workspaceInsights';
import type { Conversation } from '../types';
const sample = [{ id: '1', title: 'Physics', messages: [{ content: 'Study momentum', attachments: [{ name: 'notes.pdf' }], runTrace: { usedModelId: 'demo', durationMs: 250, estimatedPromptTokens: 50 } }] }] as unknown as Conversation[];
test('search matches title, message and attachment terms', () => {
  assert.equal(searchConversations(sample, 'physics notes.pdf').length, 1);
  assert.equal(searchConversations(sample, 'chemistry').length, 0);
  assert.match(searchConversations(sample, 'momentum')[0].excerpt, /momentum/);
});
test('usage aggregates completed run estimates', () => {
  assert.deepEqual(summarizeWorkspaceUsage(sample), [{ modelId: 'demo', runs: 1, promptTokens: 50, durationMs: 250, errors: 0, averageMs: 250 }]);
});
