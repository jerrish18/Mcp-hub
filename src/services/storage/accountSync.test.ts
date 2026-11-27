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
  });
  assert.equal(codingConv.chatMode, 'coding');
});
