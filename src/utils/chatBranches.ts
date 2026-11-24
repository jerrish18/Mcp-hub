import type { ChatMessage, Conversation } from '../types';

export interface ConversationForkRequest {
  mode: 'fork' | 'edit' | 'regenerate';
  messageId?: string;
  text?: string;
  modelId?: string;
}

export function buildConversationFork(
  source: Conversation, request: ConversationForkRequest, id: string, now = Date.now()
): { conversation: Conversation; replay?: ChatMessage } {
  const clicked = request.messageId === undefined ? source.messages.length - 1
    : source.messages.findIndex((item) => item.id === request.messageId);
  if (request.messageId && clicked < 0) throw new Error('The selected message is unavailable.');
  let end = clicked + 1;
  let replay: ChatMessage | undefined;
  if (request.mode !== 'fork') {
    const userIndex = request.mode === 'edit' ? clicked
      : source.messages.slice(0, clicked).map((item) => item.role).lastIndexOf('user');
    const original = source.messages[userIndex];
    if (original?.role !== 'user') throw new Error('No user message is available to rerun.');
    const content = request.mode === 'edit' ? request.text?.trim() ?? '' : original.content;
    if (!content && !original.attachments?.length) throw new Error('Enter a message before rerunning.');
    end = userIndex;
    replay = { ...structuredClone(original), content, displayContent: request.mode === 'edit' ? undefined : original.displayContent };
  }
  return {
    conversation: {
      ...source,
      id,
      title: source.title.slice(0, 90) + ' (fork)',
      modelId: request.modelId ?? source.modelId,
      forkedFrom: { conversationId: source.id, messageId: source.messages[clicked]?.id },
      messages: source.messages.slice(0, end).map((message) => ({
        ...structuredClone(message), canvasEdit: undefined, isStreaming: false,
      })),
      createdAt: now, updatedAt: now,
    },
    replay,
  };
}
