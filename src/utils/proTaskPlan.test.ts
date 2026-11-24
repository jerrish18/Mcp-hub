import assert from 'node:assert/strict';
import test from 'node:test';
import { finishProTaskPlan, makeProTaskPlan, normalizeProPlan, parseProTaskPlan, shouldPlanProTask, splitProTask } from './proTaskPlan';

test('Pro planning recognizes requested work sequences while leaving simple questions direct', () => {
  assert.equal(shouldPlanProTask('Read the app, then fix the issue and test the result'), true);
  assert.equal(shouldPlanProTask('Please do the following:\n1. Inspect the export\n2. Compare checksums'), true);
  assert.equal(shouldPlanProTask('Explain how to code and test a calculator'), false);
  assert.equal(shouldPlanProTask('Generate one PDF about data privacy'), false);
  assert.deepEqual(splitProTask('First inspect the export, then check the result'), ['inspect the export', 'check the result']);
});

test('Pro plans validate model results and edited titles before approval', () => {
  assert.deepEqual(parseProTaskPlan('```json\n{"steps":[" Read ",9,"Read","Write"]}\n```'), ['Read', 'Write']);
  assert.deepEqual(parseProTaskPlan('unexpected prose'), []);
  assert.deepEqual(normalizeProPlan(['a', 'b', 'c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(makeProTaskPlan(['Read', 'Write'], 'review'), {
    status: 'review', steps: [{ title: 'Read', status: 'pending' }, { title: 'Write', status: 'pending' }],
  });
});

test('interrupted plans preserve completed steps and skip unfinished ones', () => {
  const plan = makeProTaskPlan(['Read', 'Verify'], 'running');
  plan.steps[0].status = 'completed';
  assert.deepEqual(finishProTaskPlan(plan, true), {
    status: 'stopped', steps: [{ title: 'Read', status: 'completed' }, { title: 'Verify', status: 'skipped' }],
  });
});
