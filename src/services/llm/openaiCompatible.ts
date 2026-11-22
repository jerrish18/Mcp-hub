import { PROVIDER_INFO } from '../../config/models';
import { redactSecrets } from '../../utils/redact';
import {
  extractReadableApiError,
  type LlmToolCall,
  ModelUnavailableError,
  ProviderAuthError,
  RateLimitError,
  type StreamCompletionRequest,
} from './types';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

export async function streamOpenAiCompatibleCompletion(req: StreamCompletionRequest): Promise<void> {
  const { model, apiKey, systemPrompt, effort, messages, tools, signal, onEvent, fetchFn = fetch } = req;
  if (!apiKey) {
    throw new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} API key is not configured.`);
  }

  const baseUrl = PROVIDER_INFO[model.provider].baseUrl;
  const formattedMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === 'user') {
      const hasImages = Boolean(msg.attachments?.some((a) => a.kind === 'image' && a.dataBase64));
      let composedText = msg.text;
      const imageParts: Array<Record<string, unknown>> = [];

      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.textContent) {
            composedText += `\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``;
          } else if (att.kind === 'image' && att.dataBase64) {
            imageParts.push({
              type: 'image_url',
              image_url: {
                url: `data:${att.mimeType || 'image/png'};base64,${att.dataBase64}`,
              },
            });
          } else {
            composedText += `\n\n[Attached File: ${att.name} (${att.mimeType})]`;
          }
        }
      }

      if (hasImages && imageParts.length > 0) {
        formattedMessages.push({
          role: 'user',
          content: [{ type: 'text', text: composedText }, ...imageParts],
        });
      } else {
        formattedMessages.push({ role: 'user', content: composedText });
      }
    } else if (msg.role === 'assistant') {
      const entry: Record<string, unknown> = {
        role: 'assistant',
        content: msg.text || null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        entry.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.rawArguments || JSON.stringify(tc.parsedArguments ?? {}),
          },
        }));
      }
      formattedMessages.push(entry);
    } else if (msg.role === 'tool') {
      formattedMessages.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        name: msg.toolName,
        content: msg.content,
      });
    }
  }

  const body: Record<string, unknown> = {
    model: model.id,
    messages: formattedMessages,
    stream: true,
  };

  if (model.supportsReasoningEffort) {
    body.reasoning_effort = effort;
  }

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.qualifiedName,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (model.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://mcphub.app';
    headers['X-Title'] = 'MCP Hub';
  }

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 503 && attempt === 0) {
      await sleep(650, signal);
      continue;
    }
    break;
  }

  if (!res) {
    throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} failed to respond.`, 503);
  }

  if (res.status === 429) {
    const errText = extractReadableApiError(await res.text());
    throw new RateLimitError(`${PROVIDER_INFO[model.provider].name} rate limit (429): ${redactSecrets(errText, [apiKey])}`);
  }
  if (res.status === 401 || res.status === 403) {
    const errText = extractReadableApiError(await res.text());
    throw new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} auth failed (${res.status}): ${redactSecrets(errText, [apiKey])}`, res.status);
  }
  if (res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
    const errText = extractReadableApiError(await res.text());
    throw new ModelUnavailableError(
      `${model.label} unavailable (${res.status}): ${redactSecrets(errText, [apiKey])}`,
      res.status
    );
  }
  if (!res.ok) {
    const errText = extractReadableApiError(await res.text());
    throw new Error(`${PROVIDER_INFO[model.provider].name} API error (${res.status}): ${redactSecrets(errText, [apiKey])}`);
  }
  if (!res.body) {
    throw new Error(`${PROVIDER_INFO[model.provider].name} returned an empty stream.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolAcc = new Map<number, { id: string; name: string; rawArgs: string }>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let chunk: {
        error?: { message?: string; code?: number | string; status?: number };
        choices?: Array<{
          delta?: {
            content?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        chunk = JSON.parse(raw) as typeof chunk;
      } catch {
        continue;
      }

      if (chunk.error) {
        const code = Number(chunk.error.code ?? chunk.error.status ?? 0);
        const msg = redactSecrets(chunk.error.message ?? 'Upstream streaming error', [apiKey]);
        if (code === 429) {
          throw new RateLimitError(`${PROVIDER_INFO[model.provider].name} rate limit (429): ${msg}`);
        }
        if (code === 401 || code === 403) {
          throw new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} auth failed (${code}): ${msg}`, code);
        }
        if (code === 404 || code === 502 || code === 503 || code === 504) {
          throw new ModelUnavailableError(`${model.label} unavailable (${code}): ${msg}`, code);
        }
        throw new Error(`${PROVIDER_INFO[model.provider].name} stream error: ${msg}`);
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) {
        onEvent({ type: 'reasoning_delta', delta: reasoning });
      }
      if (delta.content) {
        onEvent({ type: 'text_delta', delta: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const prev = toolAcc.get(idx) ?? {
            id: tc.id ?? `call_${Date.now()}_${idx}`,
            name: '',
            rawArgs: '',
          };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.rawArgs += tc.function.arguments;
          toolAcc.set(idx, prev);
        }
      }
    }
  }

  if (toolAcc.size > 0) {
    const calls: LlmToolCall[] = Array.from(toolAcc.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => {
        let parsedArguments: Record<string, unknown> | undefined;
        let parseError: string | undefined;
        try {
          parsedArguments = v.rawArgs ? (JSON.parse(v.rawArgs) as Record<string, unknown>) : {};
        } catch (e) {
          parseError = e instanceof Error ? e.message : 'Malformed JSON tool arguments';
        }
        return {
          id: v.id,
          name: v.name,
          rawArguments: v.rawArgs,
          parsedArguments,
          parseError,
        };
      });
    onEvent({ type: 'tool_calls', calls });
  }
  onEvent({ type: 'done' });
}
