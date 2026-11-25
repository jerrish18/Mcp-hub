import type { Conversation } from '../types';

export function searchConversations(conversations: Conversation[], query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return conversations.flatMap((conversation) => {
    const title = conversation.title.toLowerCase();
    const messages = conversation.messages.map(message => ({
      text: [message.content, ...(message.attachments ?? []).map(file => file.name)].join(' '),
    }));
    const text = [title, ...messages.map(message => message.text.toLowerCase())].join(' ');
    if (!terms.every(term => text.includes(term))) return [];
    const match = messages.find(message => terms.some(term => message.text.toLowerCase().includes(term)));
    return [{ conversation, excerpt: terms.length && match ? match.text.slice(0, 160) : '' }];
  });
}

export function summarizeWorkspaceUsage(conversations: Conversation[]) {
  const models = new Map<string, { modelId: string; runs: number; promptTokens: number; durationMs: number; errors: number }>();
  for (const conversation of conversations) for (const message of conversation.messages) {
    const trace = message.runTrace;
    if (!trace || trace.isLive) continue;
    const modelId = trace.usedModelId || trace.primaryModelId;
    const row = models.get(modelId) ?? { modelId, runs: 0, promptTokens: 0, durationMs: 0, errors: 0 };
    row.runs++;
    row.promptTokens += Math.max(0, trace.estimatedPromptTokens || 0);
    row.durationMs += Math.max(0, trace.durationMs || 0);
    row.errors += Number(Boolean(trace.error));
    models.set(modelId, row);
  }
  return [...models.values()].sort((a, b) => b.runs - a.runs).map(row => ({ ...row, averageMs: Math.round(row.durationMs / row.runs) }));
}
