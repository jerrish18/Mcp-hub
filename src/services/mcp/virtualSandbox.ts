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
  const fn = new Function(`"use strict"; return (${cleaned});`) as () => unknown;
  const val = fn();
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error('Expression did not evaluate to a finite number.');
  }
  return val;
}

export async function handleVirtualMcpRequest(payload: {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { id = 1, method, params = {} } = payload;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'Workspace Sandbox MCP', version: '1.0.0' },
        },
      };

    case 'notifications/initialized':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: SANDBOX_TOOLS } };

    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources: SANDBOX_RESOURCES } };

    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts: SANDBOX_PROMPTS } };

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
