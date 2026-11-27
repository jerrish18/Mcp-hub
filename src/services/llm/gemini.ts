import { streamSseData } from './sse';
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
import type { GroundingCitation } from '../../types';

function sanitizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === 'additionalProperties') continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        if (pv && typeof pv === 'object') {
          props[pk] = sanitizeGeminiSchema(pv as Record<string, unknown>);
        }
      }
      clone.properties = props;
    } else if (k === 'items' && v && typeof v === 'object') {
      clone.items = sanitizeGeminiSchema(v as Record<string, unknown>);
    } else {
      clone[k] = v;
    }
  }
  if (!clone.type) {
    clone.type = 'object';
  }
  if (clone.type === 'object') {
    if (!clone.properties || Object.keys(clone.properties as object).length === 0) {
      clone.properties = { _placeholder: { type: 'string', description: 'Optional unused parameter' } };
      delete clone.required;
    } else if (Array.isArray(clone.required)) {
      const propKeys = new Set(Object.keys(clone.properties as object));
      const validRequired = (clone.required as unknown[]).filter(
        (key): key is string => typeof key === 'string' && propKeys.has(key)
      );
      if (validRequired.length > 0) {
        clone.required = validRequired;
      } else {
        delete clone.required;
      }
    }
  }
  return clone;
}

function mapEffortToGeminiThinkingLevel(
  effort: 'low' | 'medium' | 'high',
  modelId: string
): string {
  const lower = modelId.toLowerCase();
  const isFastTier =
    lower.includes('hydrogen') || lower.includes('flash') || lower.includes('lite');
  if (isFastTier) {
    switch (effort) {
      case 'low':
        return 'MINIMAL';
      case 'medium':
        return 'LOW';
      case 'high':
        return 'MEDIUM';
    }
  }
  switch (effort) {
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
      return 'HIGH';
  }
}

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

export async function streamGeminiCompletion(req: StreamCompletionRequest): Promise<void> {
  const {
    model,
    apiKey,
    systemPrompt,
    effort,
    knowledgeSource,
    messages,
    tools,
    signal,
    onEvent,
    fetchFn = fetch,
  } = req;
  if (!apiKey) {
    throw new ProviderAuthError('Google Gemini API key is not configured.');
  }

  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      const parts: Array<Record<string, unknown>> = [];
      let composedText = msg.text;
      if (msg.attachments && msg.attachments.length > 0) {
        const textAttachBlocks: string[] = [];
        for (const att of msg.attachments) {
          if (att.textContent) {
            textAttachBlocks.push(`\n\n[Attached File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\``);
          } else if (att.dataBase64 && (att.kind === 'image' || att.mimeType === 'application/pdf')) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType || 'image/png',
                data: att.dataBase64,
              },
            });
          } else {
            textAttachBlocks.push(`\n\n[Attached File: ${att.name} (${att.mimeType})]`);
          }
        }
        if (textAttachBlocks.length > 0) {
          composedText += textAttachBlocks.join('');
        }
      }
      parts.push({ text: composedText });
      contents.push({ role: 'user', parts });
    } else if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.text) parts.push({ text: msg.text });
      if (msg.toolCalls) {
        msg.toolCalls.forEach((tc, tcIdx) => {
          const sig =
            tc.thoughtSignature ||
            (tcIdx === 0 ? 'skip_thought_signature_validator' : undefined);
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.parsedArguments ?? {},
            },
            ...(sig ? { thoughtSignature: sig } : {}),
          });
        });
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (msg.role === 'tool') {
      const responsePart: Record<string, unknown> = {
        functionResponse: {
          name: msg.toolName,
          response: {
            result: msg.content,
            isError: Boolean(msg.isError),
          },
        },
      };
      const mediaParts: Array<Record<string, unknown>> = [];
      for (const mb of msg.mediaBlocks ?? []) {
        if (mb.type === 'image' && mb.data) {
          mediaParts.push({
            inlineData: {
              mimeType: mb.mimeType || 'image/png',
              data: mb.data,
            },
          });
        }
      }
      // Coalesce consecutive tool responses into a single 'user' turn for parallel function calls
      const prev = contents[contents.length - 1];
      if (prev && prev.role === 'user' && prev.parts.some((p) => 'functionResponse' in p)) {
        prev.parts.push(responsePart, ...mediaParts);
      } else {
        contents.push({ role: 'user', parts: [responsePart, ...mediaParts] });
      }
    }
  }

  const isProbe = Boolean(req.isProbe);
  const thinkingLevel =
    !isProbe && model.supportsThinkingLevel
      ? mapEffortToGeminiThinkingLevel(effort, model.id)
      : undefined;

  const generationConfig: Record<string, unknown> = thinkingLevel
    ? {
        thinkingConfig: {
          thinkingLevel,
          ...(thinkingLevel !== 'MINIMAL' ? { includeThoughts: true } : {}),
        },
      }
    : {};

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
  };

  const geminiTools: Array<Record<string, unknown>> = [];
  if (knowledgeSource === 'web') {
    geminiTools.push({ googleSearch: {} });
  }
  if (tools.length > 0) {
    geminiTools.push({
      functionDeclarations: tools.map((t) => ({
        name: t.qualifiedName,
        description: t.description,
        parameters: sanitizeGeminiSchema(t.parameters),
      })),
    });
  }
  if (geminiTools.length > 0) {
    body.tools = geminiTools;
    if (knowledgeSource === 'web' && tools.length > 0) {
      body.toolConfig = { includeServerSideToolInvocations: true };
    }
  }

  let endpoint = `${PROVIDER_INFO.gemini.baseUrl}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;
  let usingProxy = false;
  const isBrowser = typeof window !== 'undefined' && /^https?:$/.test(window.location?.protocol) && fetchFn === fetch;

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          ...(usingProxy ? { 'X-MCPHub-UI': '1' } : {}),
          ...(usingProxy && req.manualOverride ? { 'X-MCPHub-Manual-Override': '1' } : {}),
        },
        body: JSON.stringify(
          usingProxy ? { model: model.id, payload: body } : body
        ),
        signal,
      });
    } catch (err) {
      if (!usingProxy && isBrowser && err instanceof TypeError && !signal?.aborted) {
        usingProxy = true;
        endpoint = '/api/free-ai/gemini/chat/completions';
        continue;
      }
      throw err;
    }
    if (res.status === 503 && attempt === 0) {
      await sleep(650, signal);
      continue;
    }
    if (res.status === 400 && attempt === 0 && 'thinkingConfig' in generationConfig) {
      const errPreview = (await res.clone().text().catch(() => '')).toLowerCase();
      if (errPreview.includes('thinking') || errPreview.includes('unknown')) {
        delete generationConfig.thinkingConfig;
        continue;
      }
    }
    break;
  }

  if (!res) {
    throw new ModelUnavailableError('Gemini failed to respond.', 503);
  }

  if (res.status === 429) {
    const errText = extractReadableApiError(await res.text());
    throw new RateLimitError(`Gemini rate limit (429): ${redactSecrets(errText, [apiKey])}`);
  }
  if (res.status === 401 || res.status === 403) {
    const errText = extractReadableApiError(await res.text());
    throw new ProviderAuthError(`Gemini auth failed (${res.status}): ${redactSecrets(errText, [apiKey])}`, res.status);
  }
  if (res.status === 400) {
    const errText = extractReadableApiError(await res.text());
    if (errText.toLowerCase().includes('api key not valid') || errText.toLowerCase().includes('api_key_invalid')) {
      throw new ProviderAuthError(`Gemini auth failed (400): ${redactSecrets(errText, [apiKey])}`, 401);
    }
    throw new ModelUnavailableError(`Gemini rejected request parameter (400): ${redactSecrets(errText, [apiKey])}`, 400);
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
    throw new Error(`Gemini API error (${res.status}): ${redactSecrets(errText, [apiKey])}`);
  }

  if (!res.body) {
    throw new Error('Gemini API returned an empty response stream.');
  }

  const collectedCalls: LlmToolCall[] = [];
  const collectedCitations = new Map<string, GroundingCitation>();
  let pendingThoughtSignature: string | undefined;

  for await (const raw of streamSseData(res.body)) {
    let chunk: {
      error?: { message?: string; code?: number; status?: string };
      candidates?: Array<{
        finishReason?: string;
        content?: {
          parts?: Array<{
            text?: string;
            thought?: boolean;
            thoughtSignature?: string;
            thought_signature?: string;
            functionCall?: { name: string; args?: Record<string, unknown> };
          }>;
        };
        groundingMetadata?: {
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
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
      const code = Number(chunk.error.code ?? 0);
      const msg = redactSecrets(chunk.error.message ?? 'Gemini streaming error', [apiKey]);
      if (code === 429) {
        throw new RateLimitError(`Gemini rate limit (429): ${msg}`);
      }
      if (code === 401 || code === 403) {
        throw new ProviderAuthError(`Gemini auth failed (${code}): ${msg}`, code);
      }
      if (code === 404 || code === 502 || code === 503 || code === 504 || chunk.error.status === 'UNAVAILABLE') {
        throw new ModelUnavailableError(`${model.label} unavailable (${code || 503}): ${msg}`, code || 503);
      }
      throw new Error(`Gemini stream error: ${msg}`);
    }

    const candidate = chunk.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    for (const part of parts) {
      const partSig = part.thoughtSignature ?? part.thought_signature;
      if (part.thought && part.text) {
        onEvent({ type: 'reasoning_delta', delta: part.text });
      } else if (part.text) {
        onEvent({ type: 'text_delta', delta: part.text });
      }
      if (partSig && !part.functionCall) {
        const firstUnsigned = collectedCalls.find((c) => !c.thoughtSignature);
        if (firstUnsigned) {
          firstUnsigned.thoughtSignature = partSig;
        } else {
          pendingThoughtSignature = partSig;
        }
      }
      if (part.functionCall) {
        const argsObj = part.functionCall.args ?? {};
        const sig = partSig ?? pendingThoughtSignature;
        pendingThoughtSignature = undefined;
        collectedCalls.push({
          id: `call_${Date.now()}_${collectedCalls.length}`,
          name: part.functionCall.name,
          rawArguments: JSON.stringify(argsObj),
          parsedArguments: argsObj,
          ...(sig ? { thoughtSignature: sig } : {}),
        });
      }
    }

    const groundingChunks = candidate?.groundingMetadata?.groundingChunks ?? [];
    for (const gc of groundingChunks) {
      if (gc.web?.uri) {
        collectedCitations.set(gc.web.uri, {
          title: gc.web.title || gc.web.uri,
          url: gc.web.uri,
        });
      }
    }
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('The model reached its output limit. Try a model with a larger output limit or generate the project in smaller parts.');
    }
  }

  if (collectedCitations.size > 0) {
    onEvent({ type: 'citations', citations: Array.from(collectedCitations.values()) });
  }
  if (collectedCalls.length > 0) {
    onEvent({ type: 'tool_calls', calls: collectedCalls });
  }
  onEvent({ type: 'done' });
}
