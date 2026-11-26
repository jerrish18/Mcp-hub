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
];
