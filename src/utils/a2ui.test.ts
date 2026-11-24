import test from 'node:test';
import assert from 'node:assert/strict';
import { limitA2uiFences, loadA2uiState, parseA2uiBlock, readA2uiMode, shouldOfferA2ui } from './a2ui';

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

test('Smart A2UI offers financial, planning and comparison widgets selectively', () => {
  assert.equal(readA2uiMode({ a2uiEnabled: true }), 'smart');
  assert.equal(readA2uiMode({ a2uiEnabled: false }), 'off');
  assert.equal(readA2uiMode({ a2uiMode: 'always', a2uiEnabled: false }), 'always');
  assert.equal(shouldOfferA2ui('Compare A vs B', 'general', 'smart', true), true);
  assert.equal(shouldOfferA2ui('Draft a release plan', 'general', 'smart', false), true);
  assert.equal(shouldOfferA2ui('Status update', 'professional', 'smart', false), true);
  assert.equal(shouldOfferA2ui('Status update', 'professional', 'smart', true), false);
  assert.equal(shouldOfferA2ui('Compare them in plain text only', 'professional', 'smart', false), false);
  assert.equal(shouldOfferA2ui('Hello!', 'study', 'smart', false), false);
  assert.equal(shouldOfferA2ui('Compare A vs B', 'professional', 'off', false), false);
  assert.equal(shouldOfferA2ui('Hello!', 'general', 'always', false), true);
});

test('parser repairs smart quotes and trailing commas without touching quoted content', () => {
  const parsed = parseA2uiBlock('a2ui', '{“title”:“Summary”,“widgets”:[{“type”:“callout”,“text”:"Keep “quotes” and comma,}",},],}');
  assert.equal(parsed?.title, 'Summary');
  assert.deepEqual(parsed?.widgets[0], { type: 'callout', title: undefined, tone: 'info', text: 'Keep “quotes” and comma,}' });
  assert.equal(parseA2uiBlock('a2ui', 'irreparable'), null);
  const many = JSON.stringify({ widgets: Array.from({ length: 5 }, () => ({ type: 'callout', text: 'ok' })) });
  assert.equal(parseA2uiBlock('a2ui', many, 3)?.widgets.length, 3);
});

test('widget fences are limited without stripping code samples and saved state stays scoped', () => {
  const fence = '```a2ui\n{"widgets":[]}\n```';
  assert.equal(limitA2uiFences(['Prose', fence, fence].join('\n'), true), ['Prose', fence].join('\n'));
  assert.equal(limitA2uiFences(['Prose', fence].join('\n'), false), 'Prose');
  assert.equal(limitA2uiFences(['````md', fence, '````'].join('\n'), false), ['````md', fence, '````'].join('\n'));
  const storage = { getItem: (key: string) => key === 'one' ? '{"task":true}' : null };
  assert.deepEqual(loadA2uiState(storage, 'one', { task: false, another: false }), { task: true, another: false });
  assert.deepEqual(loadA2uiState(storage, 'two', { task: false }), { task: false });
});
