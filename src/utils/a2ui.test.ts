import test from 'node:test';
import assert from 'node:assert/strict';
import { parseA2uiBlock } from './a2ui';

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
