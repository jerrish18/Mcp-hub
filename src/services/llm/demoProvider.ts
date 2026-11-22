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
    await delay(12, signal);
  }
}

/**
 * Deterministic zero-key interactive sandbox model supporting General Chat,
 * Study Session structured guides, Uploaded attachments, and Professional MCP loops.
 */
export async function streamDemoCompletion(req: StreamCompletionRequest): Promise<void> {
  const { effort, chatMode = 'professional', knowledgeSource = 'auto', systemPrompt, messages, tools, signal, onEvent } = req;

  const lastMessage = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const userText = lastUser?.role === 'user' ? lastUser.text : '';
  const userAttachments = lastUser?.role === 'user' ? (lastUser.attachments ?? []) : [];
  const lower = userText.toLowerCase();

  // Study Session mode — never invokes MCP tools, formats strictly for learning
  if (chatMode === 'study') {
    if (lower.includes('```study-quiz') || lower.includes('4-question multiple-choice practice quiz')) {
      const quizJson = JSON.stringify(
        [
          {
            question: 'Why does Self-Attention compute Query, Key, and Value projections separately?',
            options: [
              'To allow each token to dynamically measure relevance to every other token regardless of distance',
              'To eliminate the need for matrix multiplication',
              'To restrict context strictly to adjacent words only',
              'To compress weights down to 1-bit integers during inference',
            ],
            correctIndex: 0,
            explanation:
              'Queries ask "what am I looking for?", Keys advertise "what do I contain?", and Values carry the information aggregated by the attention weights.',
          },
          {
            question: 'Why is the dot product Q·Kᵀ divided by √d_k before applying softmax?',
            options: [
              'To increase training learning rate automatically',
              'To prevent large dot products from pushing softmax into tiny-gradient saturation regions',
              'To convert causal attention into bidirectional attention',
              'To normalize token embeddings to zero length',
            ],
            correctIndex: 1,
            explanation:
              'As dimension d_k grows, raw dot products grow in variance, which makes softmax spiky and gradients vanish; scaling by √d_k keeps variance near 1.',
          },
          {
            question: 'Which matrix dimension captures how strongly token i attends to token j?',
            options: [
              'The Value projection bias vector',
              'The token vocabulary embedding table',
              'The normalized softmax(QKᵀ / √d_k) attention weight matrix',
              'The final linear layer output bias',
            ],
            correctIndex: 2,
            explanation:
              'Each row of softmax(QKᵀ / √d_k) forms a probability distribution over all source tokens.',
          },
          {
            question: 'When studying a complex system using Active Recall, what makes practice testing effective?',
            options: [
              'Re-reading highlighted notes five times in a row',
              'Retrieving answers from memory without peeking, then diagnosing mistakes immediately',
              'Skipping worked examples completely',
              'Memorizing variable names without understanding relationships',
            ],
            correctIndex: 1,
            explanation:
              'Testing yourself forces memory retrieval pathways to strengthen and immediately reveals blind spots.',
          },
        ],
        null,
        2
      );
      const quizReply =
        `## Practice Quiz\n\n` +
        `Test your understanding with these 4 interactive questions.\n\n` +
        `\`\`\`study-quiz\n${quizJson}\n\`\`\``;
      await streamText(quizReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
      onEvent({ type: 'done' });
      return;
    }

    if (lower.includes('```study-flashcards') || lower.includes('high-yield study flashcards')) {
      const cardsJson = JSON.stringify(
        [
          {
            front: 'Query (Q) Vector',
            back: 'Represents what the current token is searching for across the rest of the sequence.',
            memoryHook: 'Think of Q as your search bar query.',
          },
          {
            front: 'Key (K) Vector',
            back: 'Acts as an index label describing what information each token offers to others.',
            memoryHook: 'Keys match against Queries like tags on a library shelf.',
          },
          {
            front: 'Value (V) Vector',
            back: 'Holds the actual semantic content blended together using attention weights.',
            memoryHook: 'Once Q matches K, you retrieve V.',
          },
          {
            front: 'Scaling Factor (1 / √d_k)',
            back: 'Keeps dot-product variance stable so softmax gradients remain healthy during training.',
            memoryHook: 'Stops softmax from saturating.',
          },
          {
            front: 'Multi-Head Attention',
            back: 'Runs multiple attention heads in parallel so the model tracks syntax, meaning, and long-range links simultaneously.',
            memoryHook: 'Multiple spotlights reading different patterns at once.',
          },
        ],
        null,
        2
      );
      const cardsReply =
        `## Study Flashcards\n\n` +
        `Tap **Flashcards** below to practice active recall.\n\n` +
        `\`\`\`study-flashcards\n${cardsJson}\n\`\`\``;
      await streamText(cardsReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
      onEvent({ type: 'done' });
      return;
    }

    const attachmentSummary =
      userAttachments.length > 0
        ? `\n\n> **Study Source Used:** Referenced your ${userAttachments.length} uploaded file${userAttachments.length > 1 ? 's' : ''} (${userAttachments.map((a) => a.name).join(', ')}).`
        : knowledgeSource === 'web'
          ? '\n\n> **Source Mode:** Web Search guidance active (add a free Gemini API key in Settings for live Google Search citations).'
          : '';

    const snippetNote = userAttachments.find((a) => a.textContent)?.textContent?.slice(0, 260);
    const instructionPreview = systemPrompt.includes('[STUDY SESSION INSTRUCTIONS')
      ? 'Following your active Study Response Instructions'
      : 'Structured Study Guide';

    const cleanTopic = userText.replace(/[.?!]+$/, '').trim() || userText;
    const studyReply =
      `## Study Notes: ${cleanTopic.slice(0, 56)}${cleanTopic.length > 56 ? '…' : ''}\n\n` +
      `> **${instructionPreview}** · MCP servers stay paused in Study Mode so every tool stays focused on learning.\n\n` +
      `### 1. Clear Overview\n\n` +
      `You asked about **${cleanTopic}**. The fastest way to master any technical or conceptual topic is pairing **core mental models** with a **side-by-side breakdown** and immediate **active recall**.\n\n` +
      `### 2. Core Concepts at a Glance\n\n` +
      `| Component | Role in Practice | Key Question to Ask |\n` +
      `| :--- | :--- | :--- |\n` +
      `| **Query (Input)** | Defines what you are looking for right now | What relationship matters here? |\n` +
      `| **Mechanism (Key)** | Matches relevant signals across context | Which parts connect strongly? |\n` +
      `| **Synthesis (Value)** | Combines weighted evidence cleanly | What output does this produce? |\n\n` +
      `- **Intuitive Analogy:** Picture a research librarian scanning every bookshelf at once, scoring relevance, and handing you one focused summary.\n` +
      `- **Common Trap to Avoid:** Memorizing terminology without tracing how inputs change outputs step by step.\n` +
      (snippetNote ? `- **From Your Uploaded Source:** \`${snippetNote.replace(/\s+/g, ' ').trim()}…\`\n` : '') +
      `\n### 3. Worked Walkthrough\n\n` +
      `1. **Project** each input token into Query, Key, and Value vectors.\n` +
      `2. **Score** similarity via scaled dot product \`score = (Q · Kᵀ) / √d_k\`.\n` +
      `3. **Normalize** weights with softmax so every row sums to \`1.0\`.\n\n` +
      `\`\`\`python\nimport math\nscores = [q @ k.T / math.sqrt(d_k) for k in keys]\nweights = softmax(scores)\noutput = sum(w * v for w, v in zip(weights, values))\n\`\`\`\n\n` +
      `### 4. Quick Self-Check\n\n` +
      `1. Why do we scale dot products by \`√d_k\` before softmax?\n` +
      `2. What happens when two tokens share nearly identical Key vectors?\n\n` +
      `> **Tip:** Tap **Flashcards**, **Quiz Me**, or **Study Reader** below — or add a free Gemini/Groq/OpenRouter API key in **Settings** for full cloud tutoring & Google Search citations.` +
      attachmentSummary;

    await streamText(studyReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

  // General Chat mode — never invokes MCP tools
  if (chatMode === 'general') {
    const fileLine =
      userAttachments.length > 0
        ? `\n\nI received your attachment${userAttachments.length > 1 ? 's' : ''}: **${userAttachments.map((a) => a.name).join(', ')}**.`
        : '';
    const generalReply =
      `Here is a direct **General Chat** response (${effort} effort, MCP tools paused):${fileLine}\n\n` +
      `You asked: *"${userText}"*\n\n` +
      `Switch to **Professional** mode anytime to run actions across your connected MCP servers, or **Study Session** for structured learning notes and the distraction-free Reader view. Add a free Gemini/Groq/OpenRouter API key in **Settings** for live cloud answers.`;

    await streamText(generalReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
    onEvent({ type: 'done' });
    return;
  }

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
    `I am running in **Local Sandbox Simulator** mode (Professional MCP) with **${toolCount}** enabled MCP tool${toolCount === 1 ? '' : 's'} at **${effort}** effort.\n\n` +
    `Try asking me to:\n` +
    `- **"Search my workspace notes"** (read-only tool call)\n` +
    `- **"Calculate (24 * 7) + 12"** (read-only math tool)\n` +
    `- **"Create a note titled \\"Release Plan\\""** (triggers write-action confirmation)\n\n` +
    `To connect a live cloud LLM (Gemini, Groq, or OpenRouter), add a free API key in **Settings**.`;

  await streamText(fallbackReply, (delta) => onEvent({ type: 'text_delta', delta }), signal);
  onEvent({ type: 'done' });
}
