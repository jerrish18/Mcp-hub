import { nvidiaGlmFlashOptions } from './nvidiaOptions';
import { streamSseData } from './sse';
import { PROVIDER_INFO } from '../../config/models';
import { providerEndpoint } from './freeRegistry';
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
  if (!apiKey && model.provider !== 'kilo') {
    throw new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} API key is not configured.`);
  }

  const route = model.routes?.[0];
  const baseUrl = model.provider === 'local' || model.provider === 'demo'
    ? PROVIDER_INFO[model.provider].baseUrl : providerEndpoint(model.provider, req.credentials?.cloudflareAccountId);
  if (!baseUrl) throw new ProviderAuthError('A valid Cloudflare account ID is required.');
  const webRelay = typeof window !== 'undefined' && /^https?:$/.test(window.location?.protocol)
    && ['cloudflare', 'nvidia', 'kilo'].includes(model.provider) && fetchFn === fetch;
  const url = webRelay ? `/api/free-ai/${model.provider}/chat/completions` : `${baseUrl}/chat/completions`;
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
      const imgBlocks = (msg.mediaBlocks ?? []).filter((b) => b.type === 'image' && b.data);
      if (imgBlocks.length > 0) {
        formattedMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: `[Visual output from tool ${msg.toolName}]` },
            ...imgBlocks.map((b) => ({
              type: 'image_url',
              image_url: {
                url: `data:${b.mimeType || 'image/png'};base64,${b.data}`,
              },
            })),
          ],
        });
      }
    }
  }

  const upstreamModelId = model.provider === 'local' ? model.id.replace(/^local:/, '') : route?.modelId ?? model.id;
  const glmOptions = model.provider === 'nvidia' ? nvidiaGlmFlashOptions(upstreamModelId, effort) : undefined;
  const body: Record<string, unknown> = {
    model: upstreamModelId,
    messages: formattedMessages,
    stream: true,
  };

  if (route?.maxOutput) body.max_tokens = Math.min(route.maxOutput, 24576);
  if (model.supportsReasoningEffort && model.provider !== 'openrouter') {
    body.reasoning_effort = effort;
  }
  if (glmOptions) Object.assign(body, glmOptions);

  if (model.provider !== 'local' && tools.length > 0) {
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
    ...(glmOptions ? { Accept: 'text/event-stream' } : {}),
    ...(model.provider !== 'local' && model.provider !== 'kilo' ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(webRelay ? { 'X-MCPHub-UI': '1' } : {}),
  };
  if (model.provider === 'openrouter') {
    body.provider = { max_price: { prompt: 0, completion: 0, request: 0, image: 0 }, require_parameters: true };
    if (model.supportsReasoningEffort) body.reasoning = { effort };
    headers['HTTP-Referer'] = 'https://mcphub.app';
    headers['X-Title'] = 'MCP Hub';
  }

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (model.provider === 'local' || signal?.aborted || !(error instanceof TypeError)) throw error;
      if (attempt === 0) {
        await sleep(650, signal);
        continue;
      }
      throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} could not be reached.`, 503, { cause: error });
    }
    if (res.status === 503 && attempt === 0) {
      await sleep(650, signal);
      continue;
    }
    if (res.status === 400 && attempt === 0 && !glmOptions && 'reasoning_effort' in body) {
      const errPreview = (await res.clone().text().catch(() => '')).toLowerCase();
      if (errPreview.includes('reasoning')) {
        delete body.reasoning_effort;
        continue;
      }
    }
    break;
  }

  if (!res) {
    throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} failed to respond.`, 503);
  }

  req.onQuota?.(res.headers);
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    const delay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
    const errText = extractReadableApiError(await res.text());
    throw new RateLimitError(`${PROVIDER_INFO[model.provider].name} rate limit (429): ${redactSecrets(errText, [apiKey])}`, delay);
  }
  if (res.status === 401 || res.status === 403) {
    const errText = extractReadableApiError(await res.text());
    throw new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} auth failed (${res.status}): ${redactSecrets(errText, [apiKey])}`, res.status);
  }
  if (res.status === 402 || res.status === 404 || res.status === 502 || res.status === 503 || res.status === 504) {
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

  const toolAcc = new Map<number, { id: string; name: string; rawArgs: string }>();

  let finished = false;
  const readable = streamSseData(res.body, () => { finished = true; });
  try {
    for await (const raw of readable) {
      let chunk: {
        error?: { message?: string; code?: number | string; status?: number };
        choices?: Array<{
          finish_reason?: string;
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

      const choice = chunk.choices?.[0];
      const delta = choice?.delta ?? {};

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
      if (choice?.finish_reason) finished = true;
      if (choice?.finish_reason === 'error') {
        throw new Error(`${PROVIDER_INFO[model.provider].name} stopped generating. Any received source is kept below.`);
      }
      if (choice?.finish_reason === 'length') {
        throw new Error('The model reached its output limit. Try a model with a larger output limit or generate the project in smaller parts.');
      }
    }
  } catch (error) {
    if (model.provider !== 'local' && !signal?.aborted && error instanceof TypeError) {
      throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} disconnected while generating the reply. Any received source is kept.`, 503, { cause: error });
    }
    throw error;
  }
  if (model.provider !== 'local' && !finished) {
    throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} ended the response before completion. Any received source is kept.`);
  }

  if (model.provider !== 'local' && toolAcc.size > 0) {
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
