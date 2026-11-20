import type { LlmToolCall, StreamCompletionRequest } from './types';

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

async function streamText(text: string, onDelta: (d: string) => void, signal?: AbortSignal): Promise<void> {
  const words = text.split(/(?<=\s)/);
  for (const w of words) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onDelta(w);
    await delay(14, signal);
  }
}

/**
 * Deterministic zero-key interactive sandbox model for testing MCP tool loops,
 * confirm-before-write gates, and effort levels offline or prior to adding API keys.
 */
export async function streamDemoCompletion(req: StreamCompletionRequest): Promise<void> {
  const { effort, messages, tools, signal, onEvent } = req;

  const lastMessage = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = lastUser?.role === 'user' ? lastUser.text : '';
  const lower = userText.toLowerCase();

  if (lastMessage?.role === 'tool') {
    const recentTools = messages.slice(-2).filter((m) => m.role === 'tool');
    const summaryLines = recentTools.map((t) => {
      if (t.role !== 'tool') return '';
      const displayName = t.toolName.includes('__') ? t.toolName.split('__').slice(1).join('__') : t.toolName;
      return t.isError
        ? `**${displayName}** returned an error: ${t.content}`
        : `**${displayName}** completed:\n\n\`\`\`json\n${t.content}\n\`\`\``;
    });
    const reply =
      effort === 'high'
        ? `I verified the MCP tool output and completed a self-check against your request:\n\n${summaryLines.join('\n')}\n\nEverything is up to date. Let me know if you want to inspect another tool or adjust parameters.`
        : `Completed using connected MCP tools:\n\n${summaryLines.join('\n')}`;
    await streamText(reply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  const searchTool = tools.find((t) => t.originalName === 'workspace_search_notes');
  const calcTool = tools.find((t) => t.originalName === 'calculate_expression');
  const createTool = tools.find((t) => t.originalName === 'workspace_create_note');
  const deleteTool = tools.find((t) => t.originalName === 'workspace_delete_note');

  const proposedCalls: LlmToolCall[] = [];

  if ((lower.includes('create') || lower.includes('save') || lower.includes('write') || lower.includes('add note')) && createTool) {
    const titleMatch = userText.match(/(?:titled|called|named)\s+"([^"]+)"/i);
    const title = titleMatch ? titleMatch[1] : 'MCP Hub Session Note';
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: createTool.qualifiedName,
      rawArguments: JSON.stringify({ title, content: userText }),
      parsedArguments: { title, content: userText },
    });
  } else if ((lower.includes('delete') || lower.includes('remove')) && deleteTool) {
    const idMatch = userText.match(/note-\d+/i);
    const noteId = idMatch ? idMatch[0] : 'note-1';
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: deleteTool.qualifiedName,
      rawArguments: JSON.stringify({ id: noteId }),
      parsedArguments: { id: noteId },
    });
  } else if ((lower.includes('calc') || /[0-9]+\s*[+\-*/]\s*[0-9]+/.test(userText)) && calcTool) {
    const exprMatch = userText.match(/([0-9().+\-*/\s]{3,})/);
    const expr = exprMatch ? exprMatch[1].trim() : '24 * 7';
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: calcTool.qualifiedName,
      rawArguments: JSON.stringify({ expression: expr }),
      parsedArguments: { expression: expr },
    });
  } else if ((lower.includes('note') || lower.includes('search') || lower.includes('list') || lower.includes('mcp')) && searchTool) {
    proposedCalls.push({
      id: `demo_call_${Date.now()}`,
      name: searchTool.qualifiedName,
      rawArguments: JSON.stringify({ query: '' }),
      parsedArguments: { query: '' },
    });
  }

  if (proposedCalls.length > 0) {
    if (effort === 'high') {
      await streamText(
        'Planning step: I will invoke the matching MCP tool and verify its output before answering.\n\n',
        (delta) => onEvent({ type: 'reasoning_delta', delta }),
        signal
      );
    } else if (effort === 'medium') {
      await streamText(
        'Checking connected MCP server tools...\n\n',
        (delta) => onEvent({ type: 'text_delta', delta }),
        signal
      );
    }
    onEvent({ type: 'tool_calls', calls: proposedCalls });
    onEvent({ type: 'done' });
    return;
  }

  const toolCount = tools.length;
  const fallbackReply =
    `I am running in **Local Sandbox Simulator** mode with **${toolCount}** enabled MCP tool${toolCount === 1 ? '' : 's'} at **${effort}** effort.\n\n` +
    `Try asking me to:\n` +
    `- **"Search my workspace notes"** (read-only tool call)\n` +
    `- **"Calculate (24 * 7) + 12"** (read-only math tool)\n` +
    `- **"Create a note titled \\"Release Plan\\""** (triggers write-action confirmation)\n\n` +
    `To connect a live cloud LLM (Gemini, Groq, or OpenRouter), add a free API key in **Settings**.`;

  await streamText(fallbackReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
  onEvent({ type: 'done' });
}
