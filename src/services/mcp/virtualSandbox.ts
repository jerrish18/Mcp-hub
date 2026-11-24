import type { McpPrompt, McpResource, McpTool } from '../../types/index.ts';

interface SandboxNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const sandboxNotes: SandboxNote[] = [
  {
    id: 'note-1',
    title: 'MCP Server Checklist',
    content: 'Verify Streamable HTTP endpoint, test OAuth 2.1 PKCE discovery, and confirm write-tool approval prompt.',
    updatedAt: '2026-11-20T08:00:00Z',
  },
  {
    id: 'note-2',
    title: 'Free Tier Model Quotas',
    content: 'Gemini 4 Flash handles 1M context on Google AI Studio free tier. Groq Llama 3.3 70B offers sub-second fallback.',
    updatedAt: '2026-11-20T09:15:00Z',
  },
];

let nextNoteSeq = 3;

const SANDBOX_TOOLS: McpTool[] = [
  {
    name: 'workspace_search_notes',
    description: 'Search saved local workspace notes by keyword or list all notes if query is empty.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search keyword' },
      },
    },
    annotations: {
      title: 'Search Workspace Notes',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'calculate_expression',
    description: 'Evaluate a safe arithmetic math expression (supports +, -, *, /, parentheses, decimals).',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Arithmetic expression such as (24 * 7) + 12' },
      },
      required: ['expression'],
    },
    annotations: {
      title: 'Calculate Math Expression',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'workspace_create_note',
    description: 'Create or update a workspace note in the sandbox store.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the note' },
        content: { type: 'string', description: 'Markdown body of the note' },
      },
      required: ['title', 'content'],
    },
    annotations: {
      title: 'Create Workspace Note',
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  {
    name: 'workspace_delete_note',
    description: 'Permanently delete a workspace note by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the note to delete (e.g. note-1)' },
      },
      required: ['id'],
    },
    annotations: {
      title: 'Delete Workspace Note',
      readOnlyHint: false,
      destructiveHint: true,
    },
  },
];

const SANDBOX_RESOURCES: McpResource[] = [
  {
    uri: 'sandbox://notes/index',
    name: 'Workspace Notes Index',
    description: 'Live JSON index of notes inside the local sandbox MCP server.',
    mimeType: 'application/json',
  },
];

const SANDBOX_PROMPTS: McpPrompt[] = [
  {
    name: 'summarize_workspace',
    description: 'Summarize all current notes and suggest follow-up action items.',
    arguments: [{ name: 'focus', description: 'Optional topic focus', required: false }],
  },
];

function safeEvalArithmetic(expr: string): number {
  const cleaned = expr.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(cleaned) || cleaned.length > 120) {
    throw new Error('Only basic arithmetic (+, -, *, /, parentheses) is permitted.');
  }
  let position = 0;
  const consume = (token: string) => {
    if (!cleaned.startsWith(token, position)) return false;
    position += token.length;
    return true;
  };
  const invalid = () => new Error('Invalid arithmetic expression.');

  function primary(): number {
    if (consume('(')) {
      const value = sum();
      if (!consume(')')) throw invalid();
      return value;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(cleaned.slice(position));
    if (!number) throw invalid();
    position += number[0].length;
    return Number(number[0]);
  }

  function factor(): number {
    if (consume('+')) return factor();
    if (consume('-')) return -factor();
    const value = primary();
    return consume('**') ? value ** factor() : value;
  }

  function product(): number {
    let value = factor();
    while (position < cleaned.length) {
      if (consume('*')) value *= factor();
      else if (consume('/')) value /= factor();
      else break;
    }
    return value;
  }

  function sum(): number {
    let value = product();
    while (position < cleaned.length) {
      if (consume('+')) value += product();
      else if (consume('-')) value -= product();
      else break;
    }
    return value;
  }

  const result = sum();
  if (position !== cleaned.length) throw invalid();
  if (!Number.isFinite(result)) throw new Error('Expression did not evaluate to a finite number.');
  return result;
}

export async function handleVirtualMcpRequest(payload: {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { id = 1, method, params = {} } = payload;

  switch (method) {
    case 'initialize': {
      const requestedVersion =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18';
      const negotiated =
        requestedVersion === '2025-06-18' || requestedVersion === '2025-03-26'
          ? requestedVersion
          : '2025-06-18';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } },
          serverInfo: { name: 'Workspace Sandbox MCP', version: '1.1.0' },
        },
      };
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: SANDBOX_TOOLS } };

    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: SANDBOX_RESOURCES } };

    case 'resources/read': {
      const uri = String(params.uri ?? '');
      if (uri === 'sandbox://notes/index') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(sandboxNotes, null, 2),
              },
            ],
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32002, message: `Resource not found: ${uri}` },
      };
    }

    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: SANDBOX_PROMPTS } };

    case 'prompts/get': {
      const promptName = String(params.name ?? '');
      const promptArgs = (params.arguments ?? {}) as Record<string, string>;
      if (promptName === 'summarize_workspace') {
        const focus = promptArgs.focus?.trim();
        const text = focus
          ? `Summarize all workspace notes with special focus on "${focus}", highlight open risks, and propose 3 next steps.`
          : 'Summarize all current workspace notes and suggest 3 concrete follow-up action items.';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Summarize workspace notes prompt',
            messages: [
              {
                role: 'user',
                content: { type: 'text', text },
              },
            ],
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Prompt not found: ${promptName}` },
      };
    }

    case 'tools/call': {
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      if (name === 'workspace_search_notes') {
        const q = String(args.query ?? '').toLowerCase();
        const matches = q
          ? sandboxNotes.filter(
              (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
            )
          : sandboxNotes;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }],
            isError: false,
          },
        };
      }

      if (name === 'calculate_expression') {
        try {
          const result = safeEvalArithmetic(String(args.expression ?? ''));
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `${args.expression} = ${result}` }],
              isError: false,
            },
          };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: err instanceof Error ? err.message : 'Math error' }],
              isError: true,
            },
          };
        }
      }

      if (name === 'workspace_create_note') {
        const title = String(args.title ?? '').trim();
        const content = String(args.content ?? '').trim();
        if (!title || !content) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'Both title and content are required.' }],
              isError: true,
            },
          };
        }
        const created: SandboxNote = {
          id: `note-${nextNoteSeq++}`,
          title,
          content,
          updatedAt: new Date().toISOString(),
        };
        sandboxNotes.unshift(created);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Created note ${created.id}: "${created.title}"` }],
            isError: false,
          },
        };
      }

      if (name === 'workspace_delete_note') {
        const noteId = String(args.id ?? '').trim();
        const idx = sandboxNotes.findIndex((n) => n.id === noteId);
        if (idx === -1) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Note "${noteId}" not found.` }],
              isError: true,
            },
          };
        }
        const [removed] = sandboxNotes.splice(idx, 1);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Deleted note "${removed.title}" (${removed.id}).` }],
            isError: false,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
