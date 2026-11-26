import assert from 'node:assert/strict';
import { providerEndpoint } from '../src/services/llm/freeRegistry';
import { getFallbackModelCandidates, streamWithRateLimitFallback, syncLiveProviderModels } from '../src/services/llm/provider';
import type { ProviderKeys } from '../src/types';

const modelId = process.argv[2];
const keys: ProviderKeys = {
  openrouter: process.env.OPENROUTER_API_KEY,
  nvidia: process.env.NVIDIA_API_KEY,
};

async function verify() {
  assert.ok(modelId && /^[\w./:@-]{1,180}$/.test(modelId));
  const { models } = await syncLiveProviderModels(keys);
  const candidates = getFallbackModelCandidates(modelId, keys, models);
  const primary = candidates[0]?.routes?.[0];
  assert.ok(primary && candidates.some((candidate) => candidate.provider !== primary.provider));
  const simulatedEndpoint = providerEndpoint(primary.provider);
  assert.ok(simulatedEndpoint);

  let attempts = 0;
  let fallbacks = 0;
  let streamed = false;
  const result = await streamWithRateLimitFallback({
    primaryModelId: modelId,
    keys,
    dynamicModels: models,
    systemPrompt: 'Reply concisely.',
    effort: 'low',
    messages: [{ role: 'user', text: 'Write one sentence about testing TypeScript code.' }],
    tools: [],
    signal: AbortSignal.timeout(90_000),
    fetchFn: (input, init) => {
      if (String(input) === `${simulatedEndpoint}/chat/completions` && init?.method === 'POST') {
        attempts++;
        return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
      }
      return fetch(input, init);
    },
    onModelFallback: (from, to) => {
      assert.equal(from.id, modelId);
      assert.equal(to.id, modelId);
      fallbacks++;
    },
    onEvent: (event) => {
      if (event.type === 'text_delta' && event.delta.trim()) streamed = true;
    },
  });

  assert.equal(attempts, 1);
  assert.ok(fallbacks >= 1 && streamed);
  assert.equal(result.usedModel.id, modelId);
  assert.notEqual(result.usedModel.provider, primary.provider);
  console.log(JSON.stringify({ modelId, from: primary.provider, to: result.usedModel.provider,
    trigger: 'simulated HTTP 429', liveFallback: true }));
}

try {
  await verify();
} catch {
  console.error('Live same-model fallback did not complete with the current verified routes.');
  process.exitCode = 1;
}
