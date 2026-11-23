import type { KnowledgeSourceMode } from '../types';

export interface StudyWebImage {
  title: string;
  imageUrl: string;
  pageUrl: string;
  source: string;
  caption?: string;
}

const VISUAL_INTENT_REGEX =
  /\b(image|images|photo|photos|picture|pictures|pic|pics|illustration|illustrations|anatomy|structure|map|maps|specimen|look like|looks like|show me|visual|visuals)\b/i;

const FILLER_WORDS_REGEX =
  /\b(?:please|can you|could you|show me|find|fetch|display|give me|explain|explaining|teach me|describe|illustrate|real|web|images?|photos?|pictures?|pics?|illustrations?|diagrams?|flowcharts?|visuals?|with|of|for|about|showing|using)\b/gi;

/**
 * Determines whether a Study Mode query is asking for visual web images and extracts
 * a clean educational search topic. Strictly returns null when knowledgeSource === 'uploaded'.
 */
export function detectStudyVisualQuery(
  userText: string,
  knowledgeSource: KnowledgeSourceMode = 'auto'
): string | null {
  if (knowledgeSource === 'uploaded') return null;
  const trimmed = userText.trim();
  if (!trimmed) return null;

  const explicitlyVisual = VISUAL_INTENT_REGEX.test(trimmed);
  const webModeConceptual = knowledgeSource === 'web' && trimmed.length >= 6;
  if (!explicitlyVisual && !webModeConceptual) return null;

  let cleaned = trimmed
    .replace(FILLER_WORDS_REGEX, ' ')
    .replace(/\b(?:and|or|the|a|an)\b/gi, ' ')
    .replace(/[?!.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 3) {
    cleaned = trimmed.replace(/[?!.]+$/g, '').trim();
  }
  return cleaned.slice(0, 100) || null;
}

export async function fetchStudyWebImages(
  query: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch
): Promise<StudyWebImage[]> {
  const clean = query.trim();
  if (!clean) return [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetchFn(
        `/api/study-images?q=${encodeURIComponent(clean)}&limit=3`,
        { signal: controller.signal }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { images?: StudyWebImage[] };
      if (!Array.isArray(payload.images)) return [];
      return payload.images.filter(
        (img) =>
          img &&
          typeof img.imageUrl === 'string' &&
          (img.imageUrl.startsWith('https://') || img.imageUrl.startsWith('http://'))
      );
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  } catch {
    return [];
  }
}
