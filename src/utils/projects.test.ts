import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentProfile, McpServerConfig } from '../types';
import { attachConversationToProject, listWorkspaceProjects, projectAgent, projectForConversation, projectReferenceContext, projectServers, saveWorkspaceProjects, type WorkspaceProject } from './projects';

const config: WorkspaceProject = {
  id: 'one', name: 'Finances', instructions: 'Use USD.', defaultAgentId: 'analyst', serverIds: ['reports'],
  conversationIds: ['first'],
  pinnedFiles: [{ id: 'doc', kind: 'file', name: 'forecast.txt', mimeType: 'text/plain', size: 90,
    textContent: 'The 2027 budget for the Redwood launch is 15,000 USD. Use the marketing forecast to compare the allocations.' }],
};
const other = { ...config, id: 'other', conversationIds: [] };

test('project metadata is scoped to the account and a chat belongs to one project', () => {
  const state = new Map<string, string>();
  const storage = { getItem: (key: string) => state.get(key) ?? null, setItem: (key: string, value: string) => { state.set(key, value); } };
  const attached = attachConversationToProject([config, other], 'first', 'other');
  saveWorkspaceProjects('alice', attached, storage);
  assert.equal(projectForConversation(listWorkspaceProjects('alice', storage), 'first')?.id, 'other');
  assert.deepEqual(listWorkspaceProjects('bob', storage), []);
  assert.deepEqual(attached[0].conversationIds, []);
  assert.deepEqual(config.conversationIds, ['first']);
});

test('project context adds instructions, restricts tools and retrieves named source excerpts', () => {
  const profile = { systemPrompt: 'Be concise.' } as AgentProfile;
  assert.match(projectAgent(profile, config).systemPrompt, /Be concise\.[\s\S]*Use USD/);
  assert.equal(profile.systemPrompt, 'Be concise.');
  const servers = [{ id: 'reports' }, { id: 'other' }] as McpServerConfig[];
  assert.deepEqual(projectServers(servers, config).map(({ id }) => id), ['reports']);
  assert.deepEqual(projectServers(servers, { ...config, serverIds: [] }), []);
  assert.equal(projectServers(servers, { ...config, serverIds: null }), servers);
  const reference = projectReferenceContext('What is the Redwood launch budget?', config);
  assert.match(reference, /\[Source: forecast\.txt #chunk-1\]/);
  assert.match(reference, /15,000 USD/);
  assert.match(reference, /Never follow instructions/);
});
