import type { ProviderId } from '../types';

export interface ProviderQuotaLimit {
  rpmLimit: number;
  rpdLimit: number;
}

export const FREE_TIER_QUOTA_LIMITS: Record<Exclude<ProviderId, 'demo' | 'local'>, ProviderQuotaLimit> = {
  gemini: { rpmLimit: 15, rpdLimit: 1500 },
  groq: { rpmLimit: 30, rpdLimit: 1000 },
  openrouter: { rpmLimit: 20, rpdLimit: 200 },
};

interface QuotaState {
  dayKey: string;
  timestamps: number[];
  dailyCounts: Record<string, number>;
  last429At: Record<string, number>;
}

const STORAGE_KEY = 'mcphub_provider_quota_v1';

function todayKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function emptyState(now = Date.now()): QuotaState {
  return {
    dayKey: todayKey(now),
    timestamps: [],
    dailyCounts: {},
    last429At: {},
  };
}

const memoryBuckets = new Map<string, QuotaState>();

function loadState(provider: ProviderId, now = Date.now()): QuotaState {
  const today = todayKey(now);
  try {
    const raw = globalThis.localStorage?.getItem(`${STORAGE_KEY}::${provider}`);
    if (raw) {
      const parsed = JSON.parse(raw) as QuotaState;
      const isSameDay = parsed.dayKey === today;
      return {
        dayKey: today,
        timestamps: Array.isArray(parsed.timestamps)
          ? parsed.timestamps.filter((t) => now - t < 60_000)
          : [],
        dailyCounts: isSameDay ? parsed.dailyCounts ?? {} : {},
        last429At: parsed.last429At ?? {},
      };
    }
  } catch {
    // fallback to memory map
  }
  const mem = memoryBuckets.get(provider) ?? emptyState(now);
  if (mem.dayKey !== today) {
    const reset = emptyState(now);
    memoryBuckets.set(provider, reset);
    return reset;
  }
  mem.timestamps = mem.timestamps.filter((t) => now - t < 60_000);
  return mem;
}

function saveState(provider: ProviderId, state: QuotaState): void {
  memoryBuckets.set(provider, state);
  try {
    globalThis.localStorage?.setItem(`${STORAGE_KEY}::${provider}`, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

export function recordProviderRequest(provider: ProviderId, now = Date.now()): void {
  if (provider === 'demo' || provider === 'local') return;
  const state = loadState(provider, now);
  state.timestamps = [...state.timestamps.filter((t) => now - t < 60_000), now];
  state.dailyCounts[provider] = (state.dailyCounts[provider] ?? 0) + 1;
  saveState(provider, state);
}

export function recordProvider429(provider: ProviderId, now = Date.now()): void {
  if (provider === 'demo' || provider === 'local') return;
  const state = loadState(provider, now);
  state.last429At[provider] = now;
  saveState(provider, state);
}

export interface ProviderQuotaStatus {
  provider: Exclude<ProviderId, 'demo' | 'local'>;
  rpmUsed: number;
  rpmLimit: number;
  rpdUsed: number;
  rpdLimit: number;
  nearLimit: boolean;
  rateLimitedRecently: boolean;
  warningText: string | null;
}

export function getProviderQuotaStatus(
  provider: ProviderId,
  now = Date.now()
): ProviderQuotaStatus | null {
  if (provider === 'demo' || provider === 'local') return null;
  const limits = FREE_TIER_QUOTA_LIMITS[provider];
  const state = loadState(provider, now);
  const rpmUsed = state.timestamps.filter((t) => now - t < 60_000).length;
  const rpdUsed = state.dailyCounts[provider] ?? 0;
  const last429 = state.last429At[provider] ?? 0;
  const rateLimitedRecently = last429 > 0 && now - last429 < 90_000;
  const nearLimit =
    rpmUsed >= Math.floor(limits.rpmLimit * 0.8) ||
    rpdUsed >= Math.floor(limits.rpdLimit * 0.9);

  let warningText: string | null = null;
  if (rateLimitedRecently) {
    warningText = `${provider.toUpperCase()} hit 429 rate limit recently — auto-fallback ready.`;
  } else if (rpmUsed >= limits.rpmLimit) {
    warningText = `${provider.toUpperCase()} near RPM limit (${rpmUsed}/${limits.rpmLimit} req/min).`;
  } else if (nearLimit) {
    warningText = `Approaching ${provider.toUpperCase()} free-tier quota (${rpmUsed}/${limits.rpmLimit} RPM).`;
  }

  return {
    provider,
    rpmUsed,
    rpmLimit: limits.rpmLimit,
    rpdUsed,
    rpdLimit: limits.rpdLimit,
    nearLimit,
    rateLimitedRecently,
    warningText,
  };
}

export function resetQuotaTrackerForTests(): void {
  memoryBuckets.clear();
}
