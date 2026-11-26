import { catalogRoute, cloudCredential, readProviderCatalog } from '../src/services/llm/freeRegistry';
import { streamOpenAiCompatibleCompletion } from '../src/services/llm/openaiCompatible';
import type { LlmConversationItem, LlmToolCall, LlmToolDefinition } from '../src/services/llm/types';
import type { CloudProvider, ProviderKeys } from '../src/types';

const keys: ProviderKeys = {
  openrouter: process.env.OPENROUTER_API_KEY,
  nvidia: process.env.NVIDIA_API_KEY,
};

const tool: LlmToolDefinition = {
  qualifiedName: 'fixture__read_value',
  originalName: 'read_value',
  serverId: 'fixture',
  serverName: 'Verification fixture',
  description: 'Read the fixture value for the specified key.',
  parameters: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
    additionalProperties: false,
  },
  isReadOnly: true,
  isDestructive: false,
};

async function verify(provider: CloudProvider, modelId: string) {
  let phase = 'catalog';
  try {
    const entries = await readProviderCatalog(provider, keys, fetch, AbortSignal.timeout(20_000));
    const entry = entries.find((row) => row.id === modelId);
    const route = entry && catalogRoute(provider, entry);
    if (!route) throw new Error('Route is absent, paid, or lacks a documented no-charge path.');
    const run = async (messages: LlmConversationItem[], tools: LlmToolDefinition[] = []) => {
      let text = '';
      let parts = 0;
      let reasoning = '';
      let done = false;
      let calls: LlmToolCall[] = [];
      await streamOpenAiCompatibleCompletion({
        apiKey: cloudCredential(provider, keys),
        model: {
          id: modelId, label: modelId, description: 'Live verification fixture', provider, isFreeTier: true,
          contextWindow: route.contextWindow, routes: [{ ...route, maxOutput: Math.min(route.maxOutput ?? 4096, 4096) }],
        },
        systemPrompt: 'Follow the requested answer format exactly.',
        effort: 'low', messages, tools, signal: AbortSignal.timeout(75_000),
        onEvent: (event) => {
          if (event.type === 'text_delta') {
            text += event.delta;
            parts++;
          }
          if (event.type === 'reasoning_delta') reasoning += event.delta;
          if (event.type === 'tool_calls') calls = event.calls;
          if (event.type === 'done') done = true;
        },
      });
      if (!done) throw new Error('Stream did not terminate cleanly.');
      return { text: text.trim(), parts, reasoning, calls };
    };
    const prompt = (text: string): LlmConversationItem => ({ role: 'user', text });
    phase = 'coding and streaming';
    const code = await run([prompt('Write a TypeScript function named groupById that takes an array of { id: string } and returns a Map from each id to all records with that id in input order. Use Map<string, ...>. Output only the function.')]);
    if (code.parts < 2 || !/function\s+groupById/.test(code.text) || !/new Map/.test(code.text)
      || !/\.id\b/.test(code.text) || !/\.push\(/.test(code.text)) throw new Error('Coding or streaming check failed.');
    phase = 'reasoning';
    const logic = await run([prompt('Two printers print two invoices in two minutes. How many minutes do eight identical printers take to print eight invoices? Reason first, then give only the integer as your final answer.')]);
    if (!/^2(?: minutes?)?\.?$/i.test(logic.text)) throw new Error('Reasoning check failed.');
    phase = 'tool calling';
    if (route.tools) {
      const request = prompt('Call fixture__read_value with key "required". Then return only the returned value.');
      const proposed = await run([request], [tool]);
      const call = proposed.calls[0];
      if (proposed.calls.length !== 1 || call?.name !== tool.qualifiedName || call.parsedArguments?.key !== 'required') {
        throw new Error('Tool call did not match the fixture.');
      }
      const reply = await run([
        request, { role: 'assistant', text: proposed.text, toolCalls: [call] },
        { role: 'tool', toolCallId: call.id, toolName: tool.qualifiedName, content: 'mcp-fixture-63' },
      ], [tool]);
      if (reply.text !== 'mcp-fixture-63') throw new Error('Model did not use the tool result.');
    }
    phase = 'image input';
    if (route.images) {
      const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC';
      const vision = await run([{
        role: 'user', text: 'Name the dominant color in this image. Reply with only the color.',
        attachments: [{ id: 'image', name: 'pixel.png', size: 69, kind: 'image', mimeType: 'image/png', dataBase64: image }],
      }]);
      if (!/^red\.?$/i.test(vision.text)) throw new Error('Image check failed.');
    }
    console.log(JSON.stringify({
      provider, modelId, testedAt: new Date().toISOString(), passed: true,
      tools: route.tools, images: route.images, reasoning: Boolean(logic.reasoning || code.reasoning),
      results: 'Free hosted catalog, streamed coding, and reasoning passed. Advertised tools and image input tested when available.',
    }));
  } catch {
    console.error(JSON.stringify({ provider, modelId, passed: false, phase }));
    process.exitCode = 1;
  }
}

const [, , provider, modelId] = process.argv;
if ((provider !== 'openrouter' && provider !== 'nvidia' && provider !== 'kilo') || !modelId || !/^[\w./:@-]{1,180}$/.test(modelId)) {
  console.error('Usage: npm run verify:free-route -- <openrouter|nvidia|kilo> <exact-model-id>');
  process.exitCode = 1;
} else {
  await verify(provider, modelId);
}
