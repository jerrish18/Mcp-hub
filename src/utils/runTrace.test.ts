import assert from 'node:assert/strict';
import test from 'node:test';
import type { RunTrace } from '../types';
import { createRunTraceRecorder, MAX_TRACE_STEPS, traceMarkdown, tracePercentages, tracePreview, traceServerStats, traceSteps } from './runTrace';

test('trace previews scrub structured secrets and known values before truncating', () => {
  const preview = tracePreview({ header: 'opaque-value', nested: { client_secret: 'with whitespace', authorization: 'token text' } }, ['opaque-value']);
  assert.doesNotMatch(preview, /opaque-value|with whitespace|token text/);
  assert.match(preview, /REDACTED/);
  assert.equal(tracePreview('a'.repeat(3000)).length, 700);
  assert.doesNotMatch(tracePreview('{"token":"arbitrary private string"}'), /arbitrary private string/);
});

test('trace steps preserve start offsets for concurrent work and use bounded independent snapshots', () => {
  let now = 105;
  let changes = 0;
  const trace = createRunTraceRecorder(100, () => changes++, () => now);
  const first = trace.start({ type: 'tool_call', label: 'First' });
  now = 112;
  trace.start({ type: 'tool_call', label: 'Overlapping' });
  const liveSteps = trace.snapshot();
  now = 121;
  first('success');
  assert.equal(changes, 3);
  assert.equal(liveSteps[0].status, 'running');
  assert.equal(trace.snapshot()[0].durationMs, 16);
  assert.equal(trace.snapshot(true)[1].status, 'cancelled');
  assert.deepEqual(tracePercentages(liveSteps[1], 40, 30), { start: 30, width: 45, duration: 18 });
  for (let i = 0; i < 100; i++) trace.start({ type: 'model_call', label: 'Model' });
  assert.equal(trace.snapshot().length, MAX_TRACE_STEPS);
});

test('legacy trace history still contributes server stats and exports as Markdown', () => {
  const trace: RunTrace = {
    startedAt: 100, finishedAt: 500, durationMs: 400, primaryModelId: 'demo', usedModelId: 'demo',
    fallbacks: [], estimatedPromptTokens: 50, stepsExecuted: 1, stoppedByUser: false,
    toolCalls: [
      { id: 'a', serverName: 'MCP', toolName: 'read', durationMs: 100, status: 'success' },
      { id: 'b', serverName: 'MCP', toolName: 'read', durationMs: 200, status: 'error' },
      { id: 'c', serverName: 'MCP', toolName: 'write', durationMs: 100, status: 'denied' },
    ],
  };
  assert.equal(traceSteps(trace)[2].status, 'denied');
  assert.deepEqual(traceServerStats([trace]), [{ name: 'MCP', calls: 2, averageMs: 150, errorRate: 0.5 }]);
  assert.match(traceMarkdown(trace), /MCP · read · error · 200ms/);
});
