import type { CloudProvider } from '../types/index.ts';

export interface FreeRouteEvidence {
  provider: CloudProvider;
  modelId: string;
  canonicalId: string;
  testedAt: string;
  codingScore: number;
  images: boolean;
  tools: boolean;
  reasoning: boolean;
  results: string;
}

// Add an entry only after the live verification suite passes. These public records contain no credentials.
export const FREE_ROUTE_EVIDENCE: readonly FreeRouteEvidence[] = [
  {
    provider: 'kilo', modelId: 'reflection/beam-free', canonicalId: 'reflection/beam',
    testedAt: '2026-11-26T03:17:24.555Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Anonymous live inference, streamed coding, reasoning output and tool round trip passed.',
  },
  {
    provider: 'kilo', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', canonicalId: 'nvidia/nemotron-3-ultra-550b-a55b',
    testedAt: '2026-11-26T03:18:29.235Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Anonymous live inference, streamed coding, reasoning output and tool round trip passed.',
  },
  {
    provider: 'openrouter', modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free', canonicalId: 'nvidia/nemotron-3-ultra-550b-a55b',
    testedAt: '2026-11-26T16:05:12.545Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Zero-price hosted inference, streamed TypeScript, reasoning output and tool round trip passed.',
  },
  {
    provider: 'openrouter', modelId: 'nvidia/nemotron-3.5-lightning:free', canonicalId: 'nvidia/nemotron-3.5-lightning-30b-a3b',
    testedAt: '2026-11-26T16:08:57.140Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Free-tier account, streamed TypeScript, reasoning output and tool round trip passed.',
  },
  {
    provider: 'openrouter', modelId: 'nvidia/nemotron-3.5-super-vl:free', canonicalId: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    testedAt: '2026-11-26T16:09:14.641Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Free-tier account, streamed TypeScript, reasoning output, tool round trip and image input passed.',
  },
  {
    provider: 'nvidia', modelId: 'nvidia/nemotron-3-ultra-550b-a55b', canonicalId: 'nvidia/nemotron-3-ultra-550b-a55b',
    testedAt: '2026-11-26T16:16:43.740Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output and tool round trip on the hosted NVIDIA Build endpoint.',
  },
  {
    provider: 'nvidia', modelId: 'nvidia/nemotron-3.5-super-vl-120b-a12b', canonicalId: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    testedAt: '2026-11-26T16:17:02.067Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output, tool round trip and image input on NVIDIA Build.',
  },
  {
    provider: 'nvidia', modelId: 'moonshotai/kimi-k3.1-pro', canonicalId: 'moonshotai/kimi-k3.1-pro',
    testedAt: '2026-11-26T17:05:18.984Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Passed hosted streaming, TypeScript, reasoning output, tool round trip and image input on NVIDIA Build.',
  },
  {
    provider: 'nvidia', modelId: 'minimaxai/minimax-m3.1-flash', canonicalId: 'minimax/minimax-m3.1-flash',
    testedAt: '2026-11-26T17:18:59.602Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Passed hosted streaming, TypeScript, reasoning output, tool round trip and image input on NVIDIA Build.',
  },
  {
    provider: 'modelscope', modelId: 'zai-org/GLM-4.7-Flash', canonicalId: 'z-ai/glm-4.7-flash',
    testedAt: '2026-11-26T17:45:34.984Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output, and a tool round trip on ModelScope direct free inference.',
  },
  {
    provider: 'modelscope', modelId: 'zai-org/GLM-5.2', canonicalId: 'z-ai/glm-5.2',
    testedAt: '2026-11-26T17:45:54.685Z', codingScore: 1,
    images: false, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output, and a tool round trip on ModelScope direct free inference.',
  },
  {
    provider: 'modelscope', modelId: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', canonicalId: 'deepseek-ai/deepseek-v4.1-flash-1017',
    testedAt: '2026-11-26T17:46:08.255Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output, and a tool round trip plus image input on ModelScope direct free inference.',
  },
  {
    provider: 'modelscope', modelId: 'Qwen/Qwen3.8-27B', canonicalId: 'qwen/qwen3.8-27b',
    testedAt: '2026-11-26T18:26:33.163Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output, tool round trip and image input on ModelScope free inference.',
  },
  {
    provider: 'modelscope', modelId: 'Qwen/Qwen3.5-35B-A3B', canonicalId: 'qwen/qwen3.5-35b-a3b',
    testedAt: '2026-11-26T18:27:02.123Z', codingScore: 1,
    images: true, tools: true, reasoning: true,
    results: 'Passed streaming, TypeScript, reasoning output, tool round trip and image input on ModelScope free inference.',
  },
];
