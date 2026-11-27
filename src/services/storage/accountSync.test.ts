import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../store/defaults';
import type { Conversation } from '../../types';
import {
  chunkArray,
  computeConversationSignature,
  computeDirtySyncPlan,
  computeStateSignature,
  computeStudyNoteSignature,
  sanitizeConversationForSync,
  sanitizeSettingsForSync,
  type RemoteSyncBaseline,
} from './syncDiff';

function makeConv(id: string, updatedAt: number, msgCount = 1): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    agentId: 'agent_general',
    modelId: 'demo-sandbox',
    effort: 'medium',
    chatMode: 'professional',
    knowledgeSource: 'auto',
    studyInstructions: '',
    messages: Array.from({ length: msgCount }, (_, idx) => ({
      id: `m_${idx}`,
      role: 'user' as const,
      content: `Hello ${idx}`,
      createdAt: updatedAt,
    })),
    createdAt: 1000,
    updatedAt,
  };
}

test('computeDirtySyncPlan writes only changed documents and separates create vs update', () => {
  const convA = makeConv('c1', 1000, 1);
  const convB = makeConv('c2', 2000, 1);
  const convNew = makeConv('c3', 3000, 1);
  const note1 = { id: 'n1', title: 'Note 1', content: 'Body', createdAt: 1000 };

  const statePart = {
    settings: DEFAULT_SETTINGS,
    agents: [],
    servers: [],
    dynamicModels: [],
    dismissedDefaultServerIds: [],
  };

  const baseline: RemoteSyncBaseline = {
    stateExists: true,
    stateSignature: computeStateSignature(statePart),
    convSignatures: new Map([
      ['c1', computeConversationSignature(convA)],
      ['c2', computeConversationSignature(convB)],
    ]),
    noteSignatures: new Map([['n1', computeStudyNoteSignature(note1)]]),
  };

  // Update convB, keep convA & note1 & state identical, add convNew
  const convBUpdated = makeConv('c2', 2500, 2);
  const plan = computeDirtySyncPlan(
    {
      ...statePart,
      conversations: [convA, convBUpdated, convNew],
      savedStudyNotes: [note1],
    },
    baseline
  );

  assert.equal(plan.stateOp, null);
  assert.equal(plan.dirtyNotes.length, 0);
  assert.equal(plan.dirtyConversations.length, 2);
  assert.equal(plan.dirtyConversations[0].conv.id, 'c2');
  assert.equal(plan.dirtyConversations[0].op, 'update');
  assert.equal(plan.dirtyConversations[1].conv.id, 'c3');
  assert.equal(plan.dirtyConversations[1].op, 'create');
});

test('chunkArray respects Firestore <= 500 writeBatch limit', () => {
  const ops = Array.from({ length: 950 }, (_, i) => i);
  const chunks = chunkArray(ops, 450);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 450);
  assert.equal(chunks[1].length, 450);
  assert.equal(chunks[2].length, 50);
});

test('sanitizeSettingsForSync and sanitizeConversationForSync preserve coding mode and override flags', () => {
  const settings = sanitizeSettingsForSync({
    ...DEFAULT_SETTINGS,
    localModelToolsEnabled: true,
    manualModelOverrides: ['gemini-4-hydrogen', 'gemini-4-hydrogen', '  '],
  });
  assert.equal(settings.localModelToolsEnabled, true);
  assert.deepEqual(settings.manualModelOverrides, ['gemini-4-hydrogen']);

  const codingConv = sanitizeConversationForSync({
    ...makeConv('c_code', 4000, 1),
    chatMode: 'coding',
    codingSession: {
      activePlan: {
        id: 'plan_1',
        prompt: 'Build app',
        summary: 'Modular web app',
        phase: 'completed',
        autoRun: false,
        requirements: [{ id: 'req_1', text: 'Semantic HTML', checked: true }],
        fileManifest: [{ path: 'index.html', action: 'create', purpose: 'Entry' }],
        tasks: [
          {
            id: 't1',
            title: 'Create entry',
            targetFiles: ['index.html'],
            verificationCheck: 'Balanced tags',
            status: 'completed',
          },
        ],
        repairAttempts: 0,
        maxRepairAttempts: 3,
        verificationErrors: [],
        subagentTraces: [],
        createdAt: 4000,
        updatedAt: 4050,
      },
      files: {
        'index.html': {
          path: 'index.html',
          content: '<h1>App</h1>',
          language: 'html',
          status: 'created',
          updatedAt: 4050,
        },
      },
      diffs: {},
      checkpoints: [],
      toolTrace: [],
      contextStats: {
        estimatedTokens: 200,
        contextWindow: 128000,
        ratio: 0.002,
        compacted: false,
      },
    },
  });
  assert.equal(codingConv.chatMode, 'coding');
  assert.equal(codingConv.codingSession?.files['index.html'].path, 'index.html');
  assert.equal(codingConv.codingSession?.activePlan?.phase, 'completed');

  const orchSettings = sanitizeSettingsForSync({
    ...DEFAULT_SETTINGS,
    codeOrchestration: {
      mode: 'custom',
      roles: { architect: 'gemini-4-neon', coder: 'qwen/qwen3-coder', reviewer: null },
      autoRun: true,
    },
  });
  assert.equal(orchSettings.codeOrchestration?.autoRun, true);
  assert.equal(orchSettings.codeOrchestration?.roles.architect, 'gemini-4-neon');
  assert.equal(orchSettings.codeOrchestration?.roles.reviewer, null);
});

test('sanitized workspace settings and conversations only emit Firestore-allowlisted keys and valid enums', () => {
  const allowedSettingsKeys = new Set([
    'theme',
    'accentTheme',
    'chatLayout',
    'oledDark',
    'a2uiEnabled',
    'a2uiMode',
    'confirmBeforeWrite',
    'maxAgentSteps',
    'toolOutputBudgetChars',
    'alwaysAllowedTools',
    'alwaysAllowedRules',
    'toolPolicies',
    'biometricLockEnabled',
    'hapticsEnabled',
    'onboardingCompleted',
    'localModelToolsEnabled',
    'manualModelOverrides',
    'codeOrchestration',
  ]);

  const sanitizedSettings = sanitizeSettingsForSync({
    ...DEFAULT_SETTINGS,
    theme: 'invalid-theme' as typeof DEFAULT_SETTINGS.theme,
    accentTheme: 'invalid-accent' as typeof DEFAULT_SETTINGS.accentTheme,
  });

  for (const key of Object.keys(sanitizedSettings)) {
    assert.equal(allowedSettingsKeys.has(key), true, `Unexpected settings key: ${key}`);
  }
  assert.equal(sanitizedSettings.theme, 'system');
  assert.equal(sanitizedSettings.accentTheme, 'pixel_blue');
  assert.deepEqual(Object.keys(sanitizedSettings.codeOrchestration ?? {}).sort(), [
    'autoRun',
    'mode',
    'roles',
  ]);

  const sanitizedConv = sanitizeConversationForSync({
    ...makeConv('conv:bad/id', 5000, 1),
    effort: 'extreme' as Conversation['effort'],
    chatMode: 'unknown' as Conversation['chatMode'],
    knowledgeSource: 'unknown' as Conversation['knowledgeSource'],
    forkedFrom: { conversationId: 'conv_parent', messageId: 'm_0' },
  });
  assert.match(sanitizedConv.id, /^[a-zA-Z0-9_-]+$/);
  assert.equal(sanitizedConv.effort, 'medium');
  assert.equal(sanitizedConv.chatMode, 'professional');
  assert.equal(sanitizedConv.knowledgeSource, 'auto');
  assert.deepEqual(sanitizedConv.forkedFrom, {
    conversationId: 'conv_parent',
    messageId: 'm_0',
  });
});

