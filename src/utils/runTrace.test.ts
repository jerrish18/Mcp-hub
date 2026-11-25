import assert from 'node:assert/strict';
import test from 'node:test';
import type { RunTrace } from '../types/index.ts';
import {
  aggregateTraceServerStats,
  buildTraceSummaryChipText,
  filterTraceSteps,
  formatTraceAsMarkdown,
  normalizeTraceSteps,
  redactAndPreview,
} from './runTrace.ts';

test('redactAndPreview strips secrets and caps output length', () => {
  const input = {
    token: 'ghp_1234567890abcdefghijklmnop',
    apiKey: 'AIzaSyA1234567890abcdefghijklmno',
    note: 'A'.repeat(400),
  };
  const out = redactAndPreview(input, 120, ['super-secret-value-99']);
  assert.ok(!out.includes('ghp_1234567890abcdefghijklmnop'));
  assert.ok(!out.includes('AIzaSyA1234567890abcdefghijklmno'));
  assert.ok(out.length <= 120);
});

test('normalizeTraceSteps converts legacy RunTrace objects without steps cleanly', () => {
  const legacy: RunTrace = {
    startedAt: 1000,
    finishedAt: 3400,
    durationMs: 2400,
    primaryModelId: 'gemini-3.1-flash-lite-preview',
    usedModelId: 'gemini-3.1-flash-lite-preview',
    fallbacks: [],
    toolCalls: [
      {
        id: 'tc_1',
        toolName: 'github_list_repos',
        serverName: 'GitHub',
        status: 'success',
        durationMs: 900,
      },
    ],
    estimatedPromptTokens: 420,
    stepsExecuted: 1,
    ragUsed: true,
    ragChunksCount: 2,
    stoppedByUser: false,
  };

  const steps = normalizeTraceSteps(legacy);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].kind, 'model_call');
  assert.equal(steps[1].kind, 'rag');
  assert.equal(steps[2].kind, 'tool_call');
  assert.equal(steps[2].toolName, 'github_list_repos');
});

test('buildTraceSummaryChipText summarizes live and completed runs with issues', () => {
  const liveTrace: RunTrace = {
    startedAt: 1000,
    finishedAt: 1500,
    durationMs: 500,
    primaryModelId: 'demo-sandbox',
    usedModelId: 'demo-sandbox',
    fallbacks: [],
    toolCalls: [],
    isLive: true,
    steps: [
      {
        kind: 'tool_call',
        id: 'tc_1',
        startedAt: 1100,
        durationMs: 0,
        serverName: 'Workspace Sandbox',
        toolName: 'workspace_search_notes',
        status: 'running',
      },
    ],
    estimatedPromptTokens: 100,
    stepsExecuted: 1,
    stoppedByUser: false,
  };
  assert.match(buildTraceSummaryChipText(liveTrace), /Live · Running workspace_search_notes/);

  const warnTrace: RunTrace = {
    startedAt: 1000,
    finishedAt: 3400,
    durationMs: 2400,
    primaryModelId: 'demo-sandbox',
    usedModelId: 'demo-sandbox',
    fallbacks: [{ from: 'a', to: 'b', reason: '429', at: 2000 }],
    toolCalls: [
      {
        id: 'tc_1',
        toolName: 'workspace_search_notes',
        serverName: 'Workspace Sandbox',
        status: 'success',
        durationMs: 120,
      },
    ],
    estimatedPromptTokens: 100,
    stepsExecuted: 1,
    stoppedByUser: false,
  };
  const summary = buildTraceSummaryChipText(warnTrace);
  assert.match(summary, /1 tool call · 2\.4s/);
  assert.match(summary, /1 warning/);
});

test('filterTraceSteps filters tools, models, and errors/slow steps', () => {
  const trace: RunTrace = {
    startedAt: 0,
    finishedAt: 6000,
    durationMs: 6000,
    primaryModelId: 'demo-sandbox',
    usedModelId: 'demo-sandbox',
    fallbacks: [],
    toolCalls: [],
    steps: [
      { kind: 'model_call', id: 'm1', startedAt: 0, durationMs: 400, modelId: 'demo-sandbox', status: 'ok' },
      { kind: 'tool_call', id: 't1', startedAt: 400, durationMs: 3500, serverName: 'GitHub', toolName: 'github_list_repos', status: 'success' },
      { kind: 'injection_warning', id: 'w1', startedAt: 4000, durationMs: 0, serverName: 'GitHub', toolName: 'github_list_repos', signals: ['override'] },
    ],
    estimatedPromptTokens: 200,
    stepsExecuted: 1,
    stoppedByUser: false,
  };
  const steps = normalizeTraceSteps(trace);
  assert.equal(filterTraceSteps(steps, 'tools').length, 1);
  assert.equal(filterTraceSteps(steps, 'models').length, 1);
  assert.equal(filterTraceSteps(steps, 'errors').length, 2); // slow t1 + w1
});

test('formatTraceAsMarkdown and aggregateTraceServerStats compute clean summaries', () => {
  const t1: RunTrace = {
    startedAt: 1000,
    finishedAt: 2200,
    durationMs: 1200,
    primaryModelId: 'demo-sandbox',
    usedModelId: 'demo-sandbox',
    fallbacks: [],
    toolCalls: [
      { id: '1', toolName: 'workspace_search_notes', serverName: 'Sandbox', status: 'success', durationMs: 100 },
      { id: '2', toolName: 'github_push_file', serverName: 'GitHub', status: 'error', durationMs: 500 },
    ],
    estimatedPromptTokens: 250,
    stepsExecuted: 1,
    stoppedByUser: false,
  };
  const md = formatTraceAsMarkdown(t1, 'Debug Turn');
  assert.match(md, /## Debug Turn/);
  assert.match(md, /github_push_file/);

  const stats = aggregateTraceServerStats([t1]);
  assert.equal(stats.length, 2);
  const sandbox = stats.find((s) => s.serverName === 'Sandbox');
  assert.equal(sandbox?.successRatePct, 100);
  const github = stats.find((s) => s.serverName === 'GitHub');
  assert.equal(github?.successRatePct, 0);
});
