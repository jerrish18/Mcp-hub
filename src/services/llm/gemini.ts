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
  if (clone.type === 'object' && (!clone.properties || Object.keys(clone.properties as object).length === 0)) {
    clone.properties = { _placeholder: { type: 'string', description: 'Optional unused parameter' } };
  }
  return clone;
}

function mapEffortToGeminiThinkingLevel(effort: 'low' | 'medium' | 'high'): string {
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
  const { model, apiKey, systemPrompt, effort, messages, tools, signal, onEvent, fetchFn = fetch } = req;
  if (!apiKey) {
    throw new ProviderAuthError('Google Gemini API key is not configured.');
  }

  const contents: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: msg.text }] });
    } else if (msg.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.text) parts.push({ text: msg.text });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.parsedArguments ?? {},
            },
          });
        }
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (msg.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: msg.toolName,
              response: {
                result: msg.content,
                isError: Boolean(msg.isError),
              },
            },
          },
        ],
      });
    }
  }

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      ...(model.supportsThinkingLevel
        ? { thinkingConfig: { thinkingLevel: mapEffortToGeminiThinkingLevel(effort) } }
        : {}),
    },
  };

  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.qualifiedName,
          description: t.description,
          parameters: sanitizeGeminiSchema(t.parameters),
        })),
      },
    ];
  }

  const endpoint = `${PROVIDER_INFO.gemini.baseUrl}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const collectedCalls: LlmToolCall[] = [];

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
      try {
        const chunk = JSON.parse(raw) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                text?: string;
                thought?: boolean;
                functionCall?: { name: string; args?: Record<string, unknown> };
              }>;
            };
          }>;
        };

        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.thought && part.text) {
            onEvent({ type: 'reasoning_delta', delta: part.text });
          } else if (part.text) {
            onEvent({ type: 'text_delta', delta: part.text });
          }
          if (part.functionCall) {
            const argsObj = part.functionCall.args ?? {};
            collectedCalls.push({
              id: `call_${Date.now()}_${collectedCalls.length}`,
              name: part.functionCall.name,
              rawArguments: JSON.stringify(argsObj),
              parsedArguments: argsObj,
            });
          }
        }
      } catch {
        // ignore partial SSE JSON frames
      }
    }
  }

  if (collectedCalls.length > 0) {
    onEvent({ type: 'tool_calls', calls: collectedCalls });
  }
  onEvent({ type: 'done' });
}
