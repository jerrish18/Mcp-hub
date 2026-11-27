import { nvidiaRequestOptions } from './nvidiaOptions';
import { streamSseData } from './sse';
import { PROVIDER_INFO } from '../../config/models';
import { isBrowserHttpRuntime, providerEndpoint, usesFreeAiRelay } from './freeRegistry';
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

function isUnavailableStatus(status: number): boolean {
  return (
    status === 402 ||
    status === 404 ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    (status >= 520 && status <= 529)
  );
}

function suffixPrefixLength(lowerText: string, tag: string): number {
  const maxCheck = Math.min(lowerText.length, tag.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    if (tag.startsWith(lowerText.slice(-len))) {
      return len;
    }
  }
  return 0;
}

export function createThinkTagParser(
  onReasoning: (delta: string) => void,
  onText: (delta: string) => void
) {
  const OPEN_TAG = '<think>';
  const CLOSE_TAG = '</think>';
  let inThink = false;
  let buffer = '';
  let trimLeadingNewlines = false;

  const emitText = (chunk: string) => {
    let text = chunk;
    if (trimLeadingNewlines) {
      text = text.replace(/^[\r\n]+/, '');
      if (!text) return;
      trimLeadingNewlines = false;
    }
    if (text) onText(text);
  };

  const push = (chunk: string) => {
    if (!chunk) return;
    buffer += chunk;
    while (buffer.length > 0) {
      const lower = buffer.toLowerCase();
      if (inThink) {
        const closeIdx = lower.indexOf(CLOSE_TAG);
        if (closeIdx !== -1) {
          const thought = buffer.slice(0, closeIdx);
          if (thought) onReasoning(thought);
          buffer = buffer.slice(closeIdx + CLOSE_TAG.length);
          inThink = false;
          trimLeadingNewlines = true;
          continue;
        }
        const hold = suffixPrefixLength(lower, CLOSE_TAG);
        const safeLen = buffer.length - hold;
        if (safeLen > 0) {
          onReasoning(buffer.slice(0, safeLen));
          buffer = buffer.slice(safeLen);
        }
        break;
      } else {
        const openIdx = lower.indexOf(OPEN_TAG);
        if (openIdx !== -1) {
          const text = buffer.slice(0, openIdx);
          if (text) emitText(text);
          buffer = buffer.slice(openIdx + OPEN_TAG.length);
          inThink = true;
          continue;
        }
        const hold = suffixPrefixLength(lower, OPEN_TAG);
        const safeLen = buffer.length - hold;
        if (safeLen > 0) {
          emitText(buffer.slice(0, safeLen));
          buffer = buffer.slice(safeLen);
        }
        break;
      }
    }
  };

  const flush = () => {
    if (!buffer) return;
    const remainder = buffer;
    buffer = '';
    if (inThink) {
      onReasoning(remainder);
    } else {
      emitText(remainder);
    }
  };

  return { push, flush };
}

export async function streamOpenAiCompatibleCompletion(req: StreamCompletionRequest): Promise<void> {
  const { model, apiKey, systemPrompt, effort, messages, tools, signal, onEvent, fetchFn = fetch } = req;
  if (!apiKey && model.provider !== 'kilo') {
    throw new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} API key is not configured.`);
  }

  const isProbe = Boolean(req.isProbe);
  const route = model.routes?.[0];
  const baseUrl = model.provider === 'local' || model.provider === 'demo'
    ? PROVIDER_INFO[model.provider].baseUrl : providerEndpoint(model.provider, req.credentials?.cloudflareAccountId);
  if (!baseUrl) throw new ProviderAuthError('A valid Cloudflare account ID is required.');
  const webRelay = model.provider !== 'local' && model.provider !== 'demo' && usesFreeAiRelay(model.provider, fetchFn);
  let targetUrl = webRelay ? `/api/free-ai/${model.provider}/chat/completions` : `${baseUrl}/chat/completions`;
  let usingProxyFallback = webRelay;
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
        if (model.provider === 'nvidia' && (route?.modelId ?? model.id) === 'moonshotai/kimi-k3.1-pro'
          && msg.providerReasoning?.provider === model.provider) {
          entry.reasoning_content = msg.providerReasoning.text;
        }
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

  const upstreamModelId =
    model.provider === 'local'
      ? model.id.replace(/^local:/, '')
      : route?.modelId ?? model.upstreamModelId ?? model.id;
  const allowReasoningFields = !isProbe && model.supportsReasoningEffort !== false;
  const nvidiaOptions =
    allowReasoningFields && model.provider === 'nvidia'
      ? nvidiaRequestOptions(upstreamModelId, effort)
      : undefined;
  const body: Record<string, unknown> = {
    model: upstreamModelId,
    messages: formattedMessages,
    stream: true,
  };

  if (route?.maxOutput) body.max_tokens = Math.min(route.maxOutput, 24576);
  if (
    !isProbe &&
    model.supportsReasoningEffort === true &&
    model.provider !== 'openrouter' &&
    model.provider !== 'nvidia'
  ) {
    body.reasoning_effort = effort;
  }
  if (nvidiaOptions) Object.assign(body, nvidiaOptions);

  if ((model.provider !== 'local' || req.allowLocalTools) && tools.length > 0) {
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
    ...(nvidiaOptions ? { Accept: 'text/event-stream' } : {}),
    ...(model.provider !== 'local' && model.provider !== 'kilo' ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(model.provider === 'cloudflare' && req.credentials?.cloudflareAccountId
      ? { 'X-MCPHub-Account': req.credentials.cloudflareAccountId }
      : {}),
    ...(webRelay ? { 'X-MCPHub-UI': '1' } : {}),
    ...(webRelay && req.manualOverride ? { 'X-MCPHub-Manual-Override': '1' } : {}),
  };
  if (model.provider === 'openrouter') {
    if (!req.manualOverride) {
      body.provider = { max_price: { prompt: 0, completion: 0, request: 0, image: 0 }, require_parameters: true };
    }
    if (!isProbe && model.supportsReasoningEffort === true) body.reasoning = { effort };
    headers['HTTP-Referer'] = 'https://mcphub.app';
    headers['X-Title'] = 'MCP Hub';
  }

  let res: Response | null = null;
  let usedTransientRetry = false;
  let strippedReasoning = false;
  let strippedMaxTokens = false;
  let strippedToolChoice = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetchFn(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (model.provider === 'local' || signal?.aborted || !(error instanceof TypeError)) throw error;
      if (!usingProxyFallback && model.provider !== 'demo' && isBrowserHttpRuntime(fetchFn)) {
        usingProxyFallback = true;
        targetUrl = `/api/free-ai/${model.provider}/chat/completions`;
        headers['X-MCPHub-UI'] = '1';
        if (req.manualOverride) headers['X-MCPHub-Manual-Override'] = '1';
        continue;
      }
      if (!usedTransientRetry) {
        usedTransientRetry = true;
        await sleep(650, signal);
        continue;
      }
      throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} could not be reached.`, 503, { cause: error });
    }
    if (!usedTransientRetry && (res.status === 408 || res.status === 502 || res.status === 503 || res.status === 504)) {
      usedTransientRetry = true;
      await sleep(650, signal);
      continue;
    }
    if (res.status === 400 || res.status === 422) {
      const errPreview = (await res.clone().text().catch(() => '')).toLowerCase();
      if (
        !strippedReasoning &&
        ('reasoning_effort' in body || 'chat_template_kwargs' in body || 'reasoning' in body) &&
        (errPreview.includes('reasoning') ||
          errPreview.includes('chat_template_kwargs') ||
          errPreview.includes('clear_thinking') ||
          errPreview.includes('unknown') ||
          errPreview.includes('extra_forbidden') ||
          errPreview.includes('unrecognized') ||
          errPreview.includes('unsupported') ||
          errPreview.includes('not permitted'))
      ) {
        strippedReasoning = true;
        delete body.reasoning_effort;
        delete body.chat_template_kwargs;
        delete body.reasoning;
        continue;
      }
      if (
        !strippedMaxTokens &&
        'max_tokens' in body &&
        (errPreview.includes('max_tokens') ||
          errPreview.includes('max_completion_tokens') ||
          errPreview.includes('range') ||
          errPreview.includes('exceeds') ||
          errPreview.includes('less than'))
      ) {
        strippedMaxTokens = true;
        delete body.max_tokens;
        continue;
      }
      if (!strippedToolChoice && 'tool_choice' in body && errPreview.includes('tool_choice')) {
        strippedToolChoice = true;
        delete body.tool_choice;
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
  if (res.status === 400 || res.status === 422) {
    const errText = extractReadableApiError(await res.text());
    throw new ModelUnavailableError(
      `${PROVIDER_INFO[model.provider].name} rejected request parameter (${res.status}): ${redactSecrets(errText, [apiKey])}`,
      res.status
    );
  }
  if (isUnavailableStatus(res.status)) {
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

  let emittedText = false;
  const thinkParser = createThinkTagParser(
    (delta) => onEvent({ type: 'reasoning_delta', delta }),
    (delta) => {
      emittedText = true;
      onEvent({ type: 'text_delta', delta });
    }
  );

  const mapRawError = (errObj: { message?: string; code?: number | string; status?: number }): Error => {
    const code = Number(errObj.code ?? errObj.status ?? 0);
    const msg = redactSecrets(errObj.message ?? 'Upstream streaming error', [apiKey]);
    if (code === 429) {
      return new RateLimitError(`${PROVIDER_INFO[model.provider].name} rate limit (429): ${msg}`);
    }
    if (code === 401 || code === 403) {
      return new ProviderAuthError(`${PROVIDER_INFO[model.provider].name} auth failed (${code}): ${msg}`, code);
    }
    if (isUnavailableStatus(code) || code === 400 || code === 422) {
      return new ModelUnavailableError(`${model.label} unavailable (${code}): ${msg}`, code);
    }
    return new Error(`${PROVIDER_INFO[model.provider].name} stream error: ${msg}`);
  };

  const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    const rawJson = await res.text();
    let payload: {
      error?: { message?: string; code?: number | string; status?: number };
      choices?: Array<{
        finish_reason?: string;
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
        };
      }>;
    };
    try {
      payload = JSON.parse(rawJson) as typeof payload;
    } catch {
      throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} returned malformed JSON.`, 502);
    }
    if (payload.error) {
      throw mapRawError(payload.error);
    }
    const choice = payload.choices?.[0];
    const message = choice?.message ?? choice?.delta ?? {};
    const reasoning = message.reasoning_content ?? message.reasoning;
    if (reasoning) {
      onEvent({ type: 'reasoning_delta', delta: reasoning });
    }
    if (message.content) {
      thinkParser.push(message.content);
    }
    thinkParser.flush();
    const rawCalls = choice && 'message' in choice ? choice.message?.tool_calls : undefined;
    let hasToolCalls = false;
    if ((model.provider !== 'local' || req.allowLocalTools) && Array.isArray(rawCalls) && rawCalls.length > 0) {
      hasToolCalls = true;
      const calls: LlmToolCall[] = rawCalls.map((tc, i) => {
        const trimmedArgs = (tc.function?.arguments ?? '').trim();
        let parsedArguments: Record<string, unknown> | undefined;
        let parseError: string | undefined;
        try {
          parsedArguments = trimmedArgs ? (JSON.parse(trimmedArgs) as Record<string, unknown>) : {};
        } catch (e) {
          parseError = e instanceof Error ? e.message : 'Malformed JSON tool arguments';
        }
        return {
          id: tc.id || `call_${Date.now()}_${i}`,
          name: (tc.function?.name ?? '').trim(),
          rawArguments: trimmedArgs,
          parsedArguments,
          parseError,
        };
      });
      onEvent({ type: 'tool_calls', calls });
    }
    if (choice?.finish_reason === 'error') {
      throw new Error(`${PROVIDER_INFO[model.provider].name} stopped generating. Any received source is kept below.`);
    }
    if (choice?.finish_reason === 'length') {
      throw new Error('The model reached its output limit. Try a model with a larger output limit or generate the project in smaller parts.');
    }
    if (choice?.finish_reason === 'content_filter' && !emittedText && !hasToolCalls) {
      throw new Error(`${PROVIDER_INFO[model.provider].name} blocked the response due to a content filter.`);
    }
    onEvent({ type: 'done' });
    return;
  }

  if (!res.body) {
    throw new Error(`${PROVIDER_INFO[model.provider].name} returned an empty stream.`);
  }

  const toolSlots: Array<{ id: string; explicitId?: string; name: string; rawArgs: string }> = [];
  const indexToSlot = new Map<number, number>();

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
        throw mapRawError(chunk.error);
      }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta ?? {};

      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (reasoning) {
        onEvent({ type: 'reasoning_delta', delta: reasoning });
      }
      if (delta.content) {
        thinkParser.push(delta.content);
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let slotIdx = indexToSlot.get(idx);
          if (slotIdx !== undefined) {
            const currentSlot = toolSlots[slotIdx];
            if (tc.id && currentSlot.explicitId && tc.id !== currentSlot.explicitId && currentSlot.name.length > 0) {
              slotIdx = undefined;
            }
          }
          if (slotIdx === undefined) {
            slotIdx = toolSlots.length;
            toolSlots.push({
              id: tc.id || `call_${Date.now()}_${slotIdx}`,
              explicitId: tc.id || undefined,
              name: '',
              rawArgs: '',
            });
            indexToSlot.set(idx, slotIdx);
          }
          const slot = toolSlots[slotIdx];
          if (tc.id && !slot.explicitId) {
            slot.id = tc.id;
            slot.explicitId = tc.id;
          }
          if (tc.function?.name) slot.name += tc.function.name;
          if (typeof tc.function?.arguments === 'string') slot.rawArgs += tc.function.arguments;
        }
      }
      if (choice?.finish_reason) finished = true;
      if (choice?.finish_reason === 'error') {
        thinkParser.flush();
        throw new Error(`${PROVIDER_INFO[model.provider].name} stopped generating. Any received source is kept below.`);
      }
      if (choice?.finish_reason === 'length') {
        thinkParser.flush();
        throw new Error('The model reached its output limit. Try a model with a larger output limit or generate the project in smaller parts.');
      }
      if (choice?.finish_reason === 'content_filter') {
        thinkParser.flush();
        if (!emittedText && toolSlots.length === 0) {
          throw new Error(`${PROVIDER_INFO[model.provider].name} blocked the response due to a content filter.`);
        }
      }
    }
  } catch (error) {
    if (model.provider !== 'local' && !signal?.aborted && error instanceof TypeError) {
      throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} disconnected while generating the reply. Any received source is kept.`, 503, { cause: error });
    }
    throw error;
  }
  thinkParser.flush();
  if (model.provider !== 'local' && !finished) {
    throw new ModelUnavailableError(`${PROVIDER_INFO[model.provider].name} ended the response before completion. Any received source is kept.`);
  }

  if ((model.provider !== 'local' || req.allowLocalTools) && toolSlots.length > 0) {
    const calls: LlmToolCall[] = toolSlots.map((v) => {
      const trimmedArgs = v.rawArgs.trim();
      let parsedArguments: Record<string, unknown> | undefined;
      let parseError: string | undefined;
      try {
        parsedArguments = trimmedArgs ? (JSON.parse(trimmedArgs) as Record<string, unknown>) : {};
      } catch (e) {
        parseError = e instanceof Error ? e.message : 'Malformed JSON tool arguments';
      }
      return {
        id: v.id,
        name: v.name.trim(),
        rawArguments: trimmedArgs,
        parsedArguments,
        parseError,
      };
    });
    onEvent({ type: 'tool_calls', calls });
  }
  onEvent({ type: 'done' });
}
