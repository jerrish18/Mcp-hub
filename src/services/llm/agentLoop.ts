import type {
  AgentProfile,
  ApprovalDecision,
  ApprovalResolution,
  ChatMode,
  EffortLevel,
  GroundingCitation,
  KnowledgeSourceMode,
  McpServerConfig,
  ModelConfig,
  PendingApproval,
  ProviderKeys,
  ServerSecretPayload,
  ToolCallRecord,
} from '../../types';
import { safeErrorMessage } from '../../utils/redact';
import {
  detectStudyVisualQuery,
  fetchStudyWebImages,
  type StudyWebImage,
} from '../../utils/studyImages';
import { callMcpTool } from '../mcp/client';
import { streamWithRateLimitFallback } from './provider';
import type { LlmConversationItem, LlmToolCall, LlmToolDefinition } from './types';

export function buildAgentToolCatalog(
  agent: AgentProfile,
  servers: McpServerConfig[]
): { tools: LlmToolDefinition[]; lookup: Map<string, LlmToolDefinition> } {
  const tools: LlmToolDefinition[] = [];
  const lookup = new Map<string, LlmToolDefinition>();

  for (const server of servers) {
    if (!server.enabled || server.status !== 'connected') continue;
    if (agent.allowedServerIds && !agent.allowedServerIds.includes(server.id)) continue;

    for (const tool of server.tools) {
      if (server.disabledTools.includes(tool.name)) continue;
      if (agent.allowedToolNames && !agent.allowedToolNames.includes(tool.name)) continue;

      const safeServerPrefix = server.id.replace(/[^a-zA-Z0-9_]/g, '_');
      const safeToolSuffix = tool.name.replace(/[^a-zA-Z0-9_]/g, '_');
      let qualifiedName = `${safeServerPrefix}__${safeToolSuffix}`.slice(0, 64);
      if (lookup.has(qualifiedName)) {
        let suffixIdx = 2;
        while (lookup.has(qualifiedName)) {
          const suffix = `_${suffixIdx++}`;
          qualifiedName = `${safeServerPrefix}__${safeToolSuffix}`.slice(0, 64 - suffix.length) + suffix;
        }
      }

      const def: LlmToolDefinition = {
        qualifiedName,
        originalName: tool.name,
        serverId: server.id,
        serverName: server.name,
        description: `[${server.name}] ${tool.description || tool.name}`,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        isReadOnly: tool.annotations?.readOnlyHint === true,
        isDestructive: tool.annotations?.destructiveHint === true,
      };
      tools.push(def);
      lookup.set(qualifiedName, def);
    }
  }

  return { tools, lookup };
}

export function composeEffectiveSystemPrompt(params: {
  basePrompt: string;
  chatMode: ChatMode;
  studyInstructions?: string;
  knowledgeSource?: KnowledgeSourceMode;
}): string {
  const parts: string[] = [params.basePrompt.trim()];

  if (params.chatMode === 'study') {
    const customStructure = params.studyInstructions?.trim();
    parts.push(
      '[STUDY SESSION MODE — MCP TOOLS DISABLED]\n' +
        'You are helping the user learn and understand deeply. Do NOT attempt to invoke MCP servers.\n' +
        '[RICH STUDY FORMATS SUPPORTED BY UI]\n' +
        '- Always leave a blank line before and after headings (##, ###), lists, code fences, math blocks, and tables.\n' +
        '- Visual Flowcharts & Diagrams: When explaining processes, algorithms, architectures, lifecycles, or when asked for a flowchart/diagram/mindmap, emit a ```mermaid code fence (e.g. flowchart TD, sequenceDiagram, mindmap, erDiagram, timeline). Quote node labels that contain spaces or punctuation like A["Parse Input"] --> B["Validate"].\n' +
        '- Math Equations: Use $$...$$ for display equations and $...$ for inline formulas.\n' +
        '- Study Callout Boxes: Use Obsidian-style callouts such as > [!DEFINITION], > [!FORMULA], > [!TIP], > [!IMPORTANT], > [!WARNING], and collapsible > [!HINT]- for hints or hidden answers.\n' +
        '- Tables: Keep every Markdown table row on one single line with concise cells.\n' +
        (customStructure
          ? `[STUDY SESSION INSTRUCTIONS — STRICTLY FOLLOW THIS RESPONSE STRUCTURE]\nYou MUST organize and format your entire response strictly according to these user instructions:\n${customStructure}`
          : 'Format your explanation cleanly with Markdown headings, callout boxes, visual Mermaid flowcharts when helpful, clear examples, and scannable bullet points so it reads like a polished study guide.')
    );
  } else if (params.chatMode === 'general') {
    parts.push(
      '[GENERAL CHAT MODE — MCP TOOLS DISABLED]\nProvide a helpful, natural everyday response directly without calling external MCP tools.'
    );
  } else {
    parts.push(
      '[PRO WORKSPACE MODE — MCP TOOLS + APP BUILDER + DOCUMENT STUDIO + CODING CANVAS]\n' +
        'CRITICAL ROUTING RULE:\n' +
        '- NEVER call `workspace_create_note` (or save-note tools) when the user asks to generate a PDF, Word/DOCX, Excel/XLSX, PowerPoint/PPTX, software application, website, or coding artifact. Only invoke `workspace_create_note` when the user explicitly asks to save/create a note.\n' +
        '- Document Studio Formats (ALWAYS emit the exact fenced JSON block below so the UI renders a Canvas preview & real downloadable file):\n' +
        '  * PDF Report: ```artifact-pdf with {"title","subtitle","sections":[{"heading","callout","paragraphs":[],"bullets":[],"table":{"headers":[],"rows":[[]]}}]}\n' +
        '  * Word Document: ```artifact-docx with {"title","subtitle","sections":[{"heading","callout","paragraphs":[],"bullets":[],"table":{"headers":[],"rows":[[]]}}]}\n' +
        '  * Excel Workbook: ```artifact-xlsx with {"title","sheets":[{"name","headers":[],"rows":[[]]}]}\n' +
        '  * PowerPoint Deck: ```artifact-pptx with {"title","subtitle","themeColor":"0B57D0","slides":[{"layout":"title"|"metrics"|"two_col"|"table"|"bullets","title","subtitle","bullets","metrics":[{"label","value","note"}],"leftTitle","leftBullets","rightTitle","rightBullets","table":{"headers":[],"rows":[[]]},"speakerNotes"}]}\n' +
        '- Multi-File Web App & Software Engineering (Claude Artifacts / ChatGPT Canvas IDE):\n' +
        '  * When building a complete multi-file web app, dashboard, or project, emit a ```artifact-app JSON block: {"title","description","framework","entryFile":"index.html","files":[{"path":"index.html","language":"html","content":"..."},{"path":"styles.css","language":"css","content":"..."},{"path":"app.js","language":"javascript","content":"..."}]}. Use clean relative paths like "./styles.css" and "./app.js" inside index.html so the live sandboxed preview bundles and runs every file seamlessly.\n' +
        '  * For quick single-file widgets or diagrams, emit ```html, ```tsx, ```svg, ```mermaid, or ```python.\n' +
        '- GitHub Sync & Repo Engineering: When connected GitHub MCP tools (`github_list_repos`, `github_create_repo`, `github_list_repo_files`, `github_read_file`, `github_create_branch`, `github_push_file`, `github_push_files_batch`) are available and the user asks to inspect, push, or create a GitHub repository, call the appropriate GitHub MCP tools directly with clean commit messages and verified file contents.'
    );
  }

  switch (params.knowledgeSource) {
    case 'uploaded':
      parts.push(
        '[KNOWLEDGE SOURCE: UPLOADED FILES & IMAGES ONLY]\nAnswer strictly from the user’s attached files or images. Quote or cite relevant parts of the uploaded material. If no file or image has been attached yet or it lacks the answer, politely ask the user to attach or clarify rather than inventing facts.'
      );
      break;
    case 'web':
      parts.push(
        '[KNOWLEDGE SOURCE: WEB SEARCH]\nPrioritize up-to-date, verifiable web facts and cite sources clearly.'
      );
      break;
    case 'general':
      parts.push(
        '[KNOWLEDGE SOURCE: GENERAL AI KNOWLEDGE]\nAnswer using your broad general training knowledge clearly and directly.'
      );
      break;
    default:
      break;
  }

  return parts.join('\n\n');
}

export interface AgentLoopCallbacks {
  onTextDelta: (fullText: string) => void;
  onReasoningDelta: (fullReasoning: string) => void;
  onToolCallsUpdated: (toolCalls: ToolCallRecord[]) => void;
  onCitationsUpdated?: (citations: GroundingCitation[]) => void;
  onFallbackNotice: (fromModel: ModelConfig, toModel: ModelConfig, reason: string) => void;
  requestApproval: (
    approval: Omit<PendingApproval, 'resolve'>
  ) => Promise<ApprovalDecision | ApprovalResolution>;
  onAlwaysAllowTool: (qualifiedKey: string) => void;
  getServerSecrets: (serverId: string) => Promise<ServerSecretPayload>;
  saveServerSecrets: (serverId: string, updated: ServerSecretPayload) => Promise<void>;
}

export interface RunAgentLoopParams {
  agent: AgentProfile;
  modelId: string;
  effort: EffortLevel;
  chatMode?: ChatMode;
  studyInstructions?: string;
  knowledgeSource?: KnowledgeSourceMode;
  keys: ProviderKeys;
  dynamicModels?: ModelConfig[];
  servers: McpServerConfig[];
  history: LlmConversationItem[];
  maxSteps: number;
  confirmBeforeWrite: boolean;
  alwaysAllowedTools: string[];
  signal: AbortSignal;
  callbacks: AgentLoopCallbacks;
  fetchFn?: typeof fetch;
  fetchStudyImages?: (query: string, signal: AbortSignal) => Promise<StudyWebImage[]>;
}

export interface AgentLoopResult {
  finalText: string;
  finalReasoning: string;
  toolCalls: ToolCallRecord[];
  citations: GroundingCitation[];
  usedModelId: string;
  stoppedByUser: boolean;
  stepsExecuted: number;
}

export async function runAgentLoop(params: RunAgentLoopParams): Promise<AgentLoopResult> {
  const {
    agent,
    modelId,
    effort,
    chatMode = 'professional',
    studyInstructions,
    knowledgeSource = 'auto',
    keys,
    dynamicModels,
    servers,
    maxSteps,
    confirmBeforeWrite,
    signal,
    callbacks,
    fetchFn,
  } = params;

  const localAlwaysAllow = new Set(params.alwaysAllowedTools);
  // Only expose MCP tools in Professional mode; General and Study Session never invoke MCPs
  const built = buildAgentToolCatalog(agent, servers);
  const tools = chatMode === 'professional' ? built.tools : [];
  const lookup = chatMode === 'professional' ? built.lookup : new Map<string, LlmToolDefinition>();
  let effectiveSystemPrompt = composeEffectiveSystemPrompt({
    basePrompt: agent.systemPrompt,
    chatMode,
    studyInstructions,
    knowledgeSource,
  });

  const workingMessages: LlmConversationItem[] = [...params.history];
  const allToolRecords: ToolCallRecord[] = [];
  const allCitations = new Map<string, GroundingCitation>();

  // In Study mode, fetch verified educational web images when user asks for pictures/images/diagrams
  let studyImages: StudyWebImage[] = [];
  if (chatMode === 'study' && knowledgeSource !== 'uploaded') {
    const lastUserItem = [...workingMessages].reverse().find((m) => m.role === 'user');
    const visualQuery =
      lastUserItem?.role === 'user'
        ? detectStudyVisualQuery(lastUserItem.text, knowledgeSource)
        : null;
    if (visualQuery) {
      const imageFetcher =
        params.fetchStudyImages ??
        (typeof window !== 'undefined'
          ? (q: string, sig: AbortSignal) => fetchStudyWebImages(q, sig, fetchFn)
          : null);
      if (imageFetcher) {
        studyImages = await imageFetcher(visualQuery, signal).catch(() => []);
        if (studyImages.length > 0) {
          for (const img of studyImages) {
            allCitations.set(img.pageUrl, {
              title: `${img.title} (${img.source})`,
              url: img.pageUrl,
            });
          }
          callbacks.onCitationsUpdated?.(Array.from(allCitations.values()));

          const imageContext = studyImages
            .map(
              (img) =>
                `- ![${img.title}](${img.imageUrl}${img.caption ? ` "${img.caption.replace(/"/g, "'")}"` : ''}) (Source: ${img.pageUrl})`
            )
            .join('\n');
          effectiveSystemPrompt +=
            `\n\n[VERIFIED WEB IMAGES FOUND]\n` +
            `Embed relevant educational images below inline using exact Markdown image syntax ![Alt](url "caption"). Never invent unverified image URLs:\n` +
            imageContext;
        }
      }
    }
  }

  let activeModelId = modelId;
  let accumulatedText = '';
  let accumulatedReasoning = '';
  let stepsExecuted = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (signal.aborted) {
      return {
        finalText: accumulatedText,
        finalReasoning: accumulatedReasoning,
        toolCalls: allToolRecords,
        citations: Array.from(allCitations.values()),
        usedModelId: activeModelId,
        stoppedByUser: true,
        stepsExecuted,
      };
    }

    stepsExecuted++;
    let stepText = '';
    let stepReasoning = '';
    let proposedCalls: LlmToolCall[] = [];

    try {
      const { usedModel } = await streamWithRateLimitFallback({
        primaryModelId: activeModelId,
        keys,
        dynamicModels,
        systemPrompt: effectiveSystemPrompt,
        effort,
        chatMode,
        knowledgeSource,
        messages: workingMessages,
        tools,
        signal,
        fetchFn,
        onModelFallback: (from, to, reason) => {
          activeModelId = to.id;
          callbacks.onFallbackNotice(from, to, reason);
        },
        onEvent: (ev) => {
          if (ev.type === 'text_delta') {
            stepText += ev.delta;
            accumulatedText += ev.delta;
            callbacks.onTextDelta(accumulatedText);
          } else if (ev.type === 'reasoning_delta') {
            stepReasoning += ev.delta;
            accumulatedReasoning += ev.delta;
            callbacks.onReasoningDelta(accumulatedReasoning);
          } else if (ev.type === 'citations') {
            for (const c of ev.citations) {
              allCitations.set(c.url, c);
            }
            callbacks.onCitationsUpdated?.(Array.from(allCitations.values()));
          } else if (ev.type === 'tool_calls') {
            proposedCalls = ev.calls;
          }
        },
      });
      activeModelId = usedModel.id;
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return {
          finalText: accumulatedText,
          finalReasoning: accumulatedReasoning,
          toolCalls: allToolRecords,
          citations: Array.from(allCitations.values()),
          usedModelId: activeModelId,
          stoppedByUser: true,
          stepsExecuted,
        };
      }
      throw err;
    }

    workingMessages.push({
      role: 'assistant',
      text: stepText,
      toolCalls: proposedCalls.length > 0 ? proposedCalls : undefined,
    });

    if (proposedCalls.length === 0) {
      if (
        chatMode === 'study' &&
        studyImages.length > 0 &&
        !/!\[[^\]\n]*\]\(https?:\/\//.test(accumulatedText)
      ) {
        const imageMarkdown =
          `\n\n### Visual References from the Web\n\n` +
          studyImages
            .slice(0, 2)
            .map(
              (img) =>
                `![${img.title}](${img.imageUrl}${
                  img.caption ? ` "${img.caption.replace(/"/g, "'")}"` : ''
                })`
            )
            .join('\n\n');
        accumulatedText += imageMarkdown;
        callbacks.onTextDelta(accumulatedText);
      }

      return {
        finalText: accumulatedText,
        finalReasoning: accumulatedReasoning,
        toolCalls: allToolRecords,
        citations: Array.from(allCitations.values()),
        usedModelId: activeModelId,
        stoppedByUser: false,
        stepsExecuted,
      };
    }

    // Execute each proposed tool call
    for (const call of proposedCalls) {
      if (signal.aborted) {
        return {
          finalText: accumulatedText,
          finalReasoning: accumulatedReasoning,
          toolCalls: allToolRecords,
          citations: Array.from(allCitations.values()),
          usedModelId: activeModelId,
          stoppedByUser: true,
          stepsExecuted,
        };
      }

      const def = lookup.get(call.name);
      if (!def) {
        const record: ToolCallRecord = {
          id: call.id,
          toolName: call.name,
          serverId: 'unknown',
          serverName: 'Unknown Server',
          arguments: call.parsedArguments ?? {},
          result: `Tool "${call.name}" is unavailable or disabled.`,
          isError: true,
          durationMs: 0,
          status: 'error',
          isReadOnly: true,
          startedAt: Date.now(),
        };
        allToolRecords.push(record);
        callbacks.onToolCallsUpdated([...allToolRecords]);
        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: record.result!,
          isError: true,
        });
        continue;
      }

      if (call.parseError) {
        const record: ToolCallRecord = {
          id: call.id,
          toolName: def.originalName,
          serverId: def.serverId,
          serverName: def.serverName,
          arguments: {},
          result: `Malformed tool arguments JSON: ${call.parseError}`,
          isError: true,
          durationMs: 0,
          status: 'error',
          isReadOnly: def.isReadOnly,
          startedAt: Date.now(),
        };
        allToolRecords.push(record);
        callbacks.onToolCallsUpdated([...allToolRecords]);
        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: record.result!,
          isError: true,
        });
        continue;
      }

      const server = servers.find((s) => s.id === def.serverId);
      if (!server) continue;

      const qualifiedKey = `${server.id}:${def.originalName}`;
      const record: ToolCallRecord = {
        id: call.id,
        toolName: def.originalName,
        serverId: server.id,
        serverName: server.name,
        arguments: call.parsedArguments ?? {},
        status: 'running',
        isReadOnly: def.isReadOnly,
        startedAt: Date.now(),
      };
      allToolRecords.push(record);

      // Write-action confirmation check
      if (confirmBeforeWrite && !def.isReadOnly && !localAlwaysAllow.has(qualifiedKey)) {
        record.status = 'pending_approval';
        callbacks.onToolCallsUpdated([...allToolRecords]);

        const rawDecision = await new Promise<ApprovalDecision | ApprovalResolution>((resolve) => {
          if (signal.aborted) {
            resolve('deny');
            return;
          }
          let settled = false;
          const onAbort = () => {
            if (!settled) {
              settled = true;
              resolve('deny');
            }
          };
          signal.addEventListener('abort', onAbort, { once: true });
          callbacks
            .requestApproval({
              toolCallId: call.id,
              serverId: server.id,
              serverName: server.name,
              toolName: def.originalName,
              qualifiedKey,
              arguments: record.arguments,
              description: def.description,
              isDestructive: def.isDestructive,
            })
            .then((ans) => {
              signal.removeEventListener('abort', onAbort);
              if (!settled) {
                settled = true;
                resolve(ans);
              }
            })
            .catch(() => {
              signal.removeEventListener('abort', onAbort);
              if (!settled) {
                settled = true;
                resolve('deny');
              }
            });
        });

        if (signal.aborted) {
          record.status = 'cancelled';
          record.durationMs = Date.now() - record.startedAt;
          callbacks.onToolCallsUpdated([...allToolRecords]);
          return {
            finalText: accumulatedText,
            finalReasoning: accumulatedReasoning,
            toolCalls: allToolRecords,
            citations: Array.from(allCitations.values()),
            usedModelId: activeModelId,
            stoppedByUser: true,
            stepsExecuted,
          };
        }

        const resolution: ApprovalResolution =
          typeof rawDecision === 'string' ? { decision: rawDecision } : rawDecision;

        if (resolution.decision === 'deny') {
          record.status = 'denied';
          record.result = resolution.denyReason?.trim()
            ? `User denied this write action. User guidance: ${resolution.denyReason.trim()}`
            : 'User denied execution of this write action.';
          record.isError = true;
          record.durationMs = Date.now() - record.startedAt;
          callbacks.onToolCallsUpdated([...allToolRecords]);
          workingMessages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: record.result,
            isError: true,
          });
          continue;
        }

        if (resolution.editedArguments) {
          record.arguments = resolution.editedArguments;
        }

        if (resolution.decision === 'always_allow') {
          localAlwaysAllow.add(qualifiedKey);
          callbacks.onAlwaysAllowTool(qualifiedKey);
        }
      }

      record.status = 'running';
      record.startedAt = Date.now();
      callbacks.onToolCallsUpdated([...allToolRecords]);

      try {
        const secrets = await callbacks.getServerSecrets(server.id);
        const toolRes = await callMcpTool({
          server,
          secrets,
          saveUpdatedSecrets: (updated) => callbacks.saveServerSecrets(server.id, updated),
          toolName: def.originalName,
          args: record.arguments,
          signal,
          fetchFn,
        });

        record.durationMs = Date.now() - record.startedAt;
        record.result = toolRes.text;
        record.isError = toolRes.isError;
        record.status = toolRes.isError ? 'error' : 'success';
        callbacks.onToolCallsUpdated([...allToolRecords]);

        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: toolRes.text,
          isError: toolRes.isError,
        });
      } catch (err) {
        record.durationMs = Date.now() - record.startedAt;
        if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          record.status = 'cancelled';
          record.result = 'Tool execution aborted by user.';
          record.isError = true;
          callbacks.onToolCallsUpdated([...allToolRecords]);
          return {
            finalText: accumulatedText,
            finalReasoning: accumulatedReasoning,
            toolCalls: allToolRecords,
            citations: Array.from(allCitations.values()),
            usedModelId: activeModelId,
            stoppedByUser: true,
            stepsExecuted,
          };
        }

        const msg = safeErrorMessage(err);
        record.status = 'error';
        record.result = msg;
        record.isError = true;
        callbacks.onToolCallsUpdated([...allToolRecords]);
        workingMessages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: `Tool execution failed: ${msg}`,
          isError: true,
        });
      }
    }

    if (accumulatedText && !accumulatedText.endsWith('\n')) {
      accumulatedText += '\n\n';
    }
  }

  const notice = `\n\n_Reached maximum step limit (${maxSteps}). Tap Continue or increase max steps in Settings._`;
  accumulatedText += notice;
  callbacks.onTextDelta(accumulatedText);

  // Handle remaining abort/end returns cleanly with citations included
  return {
    finalText: accumulatedText,
    finalReasoning: accumulatedReasoning,
    toolCalls: allToolRecords,
    citations: Array.from(allCitations.values()),
    usedModelId: activeModelId,
    stoppedByUser: false,
    stepsExecuted,
  };
}
