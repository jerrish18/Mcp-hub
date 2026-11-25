import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseA2uiBlock,
  repairA2uiJson,
  resolveA2uiMode,
  shouldOfferA2ui,
} from './a2ui';

test('parseA2uiBlock parses valid A2UI surfaces with multiple interactive widgets', () => {
  const raw = JSON.stringify({
    title: 'Solar Readiness Overview',
    subtitle: 'Interactive metrics and controls',
    badge: 'Pro A2UI',
    widgets: [
      {
        type: 'kpi_grid',
        items: [
          { label: 'PV Yield', value: '22.8%', delta: '+2.4%', hint: 'TOPCon average' },
          { label: 'BESS RTE', value: '88%', delta: '4-hr LFP' },
        ],
      },
      {
        type: 'checklist',
        title: 'Engineering Checklist',
        items: [
          { id: 'c1', label: 'Verify inverter MPPT range', checked: true },
          { id: 'c2', label: 'Size LFP reserve bank', checked: false, note: '4h peak shift' },
        ],
      },
      {
        type: 'form',
        title: 'Quick Parameters',
        submitLabel: 'Recalculate',
        promptTemplate: 'Recalculate using {{capacity}} MW and tier {{tier}}',
        fields: [
          { id: 'capacity', label: 'Capacity (MW)', kind: 'number', defaultValue: 50 },
          { id: 'tier', label: 'Tier', kind: 'select', options: ['Utility', 'Commercial'] },
        ],
      },
      {
        type: 'bar_chart',
        title: 'Efficiency',
        unit: '%',
        bars: [
          { label: 'PERC', value: 21, max: 35 },
          { label: 'Tandem', value: 30, max: 35 },
        ],
      },
      {
        type: 'timeline',
        steps: [
          { title: 'Permitting', detail: 'Grid study approved', status: 'done' },
          { title: 'Procurement', detail: 'LFP racks ordered', status: 'active' },
        ],
      },
      {
        type: 'actions',
        buttons: [{ label: 'Export PDF', prompt: 'Export this as PDF', style: 'primary' }],
      },
    ],
  });

  const parsed = parseA2uiBlock('a2ui', raw);
  assert.ok(parsed);
  assert.equal(parsed.title, 'Solar Readiness Overview');
  assert.equal(parsed.badge, 'Pro A2UI');
  assert.equal(parsed.widgets.length, 6);
  assert.equal(parsed.widgets[0].type, 'kpi_grid');
  assert.equal(parsed.widgets[2].type, 'form');
  assert.equal(parsed.widgets[5].type, 'actions');

  const alt = parseA2uiBlock('artifact-a2ui', raw);
  assert.ok(alt);
});

test('parseA2uiBlock rejects non-a2ui languages, malformed JSON, and empty widgets', () => {
  assert.equal(parseA2uiBlock('json', '{"title":"Test","widgets":[{"type":"actions","buttons":[{"label":"Go","prompt":"Run"}]}]}'), null);
  assert.equal(parseA2uiBlock('a2ui', '{bad json'), null);
  assert.equal(parseA2uiBlock('a2ui', '[]'), null);
  assert.equal(parseA2uiBlock('a2ui', JSON.stringify({ title: 'Empty', widgets: [] })), null);
  assert.equal(
    parseA2uiBlock('a2ui', JSON.stringify({ title: 'Bad Callout', widgets: [{ type: 'callout', text: '   ' }] })),
    null
  );
});

test('resolveA2uiMode migrates legacy boolean settings cleanly', () => {
  assert.equal(resolveA2uiMode(undefined), 'smart');
  assert.equal(resolveA2uiMode({ a2uiEnabled: true }), 'smart');
  assert.equal(resolveA2uiMode({ a2uiEnabled: false }), 'off');
  assert.equal(resolveA2uiMode({ a2uiMode: 'always', a2uiEnabled: true }), 'always');
  assert.equal(resolveA2uiMode({ a2uiMode: 'off', a2uiEnabled: true }), 'off');
});

test('shouldOfferA2ui gates widgets cleanly in Off, Smart, and Always modes', () => {
  assert.equal(shouldOfferA2ui('Compare SQL vs NoSQL', 'general', 'off', false), false);
  assert.equal(shouldOfferA2ui('hi', 'general', 'always', true), true);

  // Smart mode skips greetings, plain-text/code-only asks, and casual general Q&A
  assert.equal(shouldOfferA2ui('hello!', 'professional', 'smart', false), false);
  assert.equal(shouldOfferA2ui('thanks', 'study', 'smart', false), false);
  assert.equal(shouldOfferA2ui('Compare SQL vs NoSQL in plain text only', 'professional', 'smart', false), false);
  assert.equal(shouldOfferA2ui('Give me code only for binary search', 'professional', 'smart', false), false);
  assert.equal(shouldOfferA2ui('What is the capital of Japan?', 'general', 'smart', false), false);

  // Smart mode enables for structured comparisons, metrics, roadmaps, checklists, quizzes, builds
  assert.equal(shouldOfferA2ui('Compare Postgres vs DynamoDB trade-offs', 'general', 'smart', false), true);
  assert.equal(shouldOfferA2ui('Create a Q3 budget metrics breakdown', 'professional', 'smart', false), true);
  assert.equal(shouldOfferA2ui('Build a study plan and quiz for linear algebra', 'study', 'smart', false), true);
  // Suppress consecutive unsolicited widgets without explicit structured intent
  assert.equal(shouldOfferA2ui('Build a quick summary report for me please', 'professional', 'smart', true), false);
});

test('repairA2uiJson recovers trailing commas, smart quotes, and stray wrapper prose', () => {
  const dirty =
    'Here is the widget:\n{\u201Ctitle\u201D: \u201CBudget Summary\u201D, \u201Cwidgets\u201D: [{\u201Ctype\u201D: \u201Ccallout\u201D, \u201Ctext\u201D: \u201CAll targets met\u201D,},],}\nEnjoy!';
  const repaired = repairA2uiJson(dirty);
  assert.ok(repaired.startsWith('{'));
  const parsed = parseA2uiBlock('a2ui', dirty);
  assert.ok(parsed);
  assert.equal(parsed.title, 'Budget Summary');
  assert.equal(parsed.widgets[0].type, 'callout');
});

