import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCommand, composerCommand, matchingPromptMacros, removeComposerCommand } from './composerCommands';

test('composer recognizes slash and resource triggers without consuming ordinary mentions', () => {
  assert.deepEqual(composerCommand('Use @budget'), { mode: 'resource', query: 'budget' });
  assert.deepEqual(composerCommand('/rea'), { mode: 'prompt', query: 'rea' });
  assert.equal(composerCommand('person@example.org'), undefined);
  assert.equal(removeComposerCommand('Draft this /plan'), 'Draft this');
  assert.equal(compareCommand('/compare'), '');
  assert.equal(compareCommand('/COMPARE Evaluate both approaches'), 'Evaluate both approaches');
  assert.equal(compareCommand('/compare-more'), undefined);
});

test('slash results find saved macros by title and category', () => {
  const items = [{ id: 'p', title: 'Release Plan', category: 'Pro', template: 'Plan', updatedAt: 0 }];
  assert.equal(matchingPromptMacros(items, 'release-plan').length, 1);
  assert.equal(matchingPromptMacros(items, 'pro').length, 1);
  assert.equal(matchingPromptMacros(items, 'study').length, 0);
});
