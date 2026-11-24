import type { ChatAttachment } from '../types';
import type { LlmConversationItem } from '../services/llm/types';

export interface DocumentChunk {
  id: string;
  filename: string;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface RetrievedChunk {
  chunk: DocumentChunk;
  score: number;
  citationTag: string;
}

export interface RagResult {
  messages: LlmConversationItem[];
  usedRag: boolean;
  totalSourceChars: number;
  retrievedCount: number;
  citationTags: string[];
}

export function chunkDocumentText(
  filename: string,
  text: string,
  chunkSize = 900,
  overlap = 150
): DocumentChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const safeSize = Math.max(200, chunkSize);
  const safeOverlap = Math.max(0, Math.min(Math.floor(safeSize / 2), overlap));
  const step = Math.max(100, safeSize - safeOverlap);

  if (normalized.length <= safeSize) {
    return [
      {
        id: `${filename}#chunk-1`,
        filename,
        chunkIndex: 1,
        text: normalized,
        startOffset: 0,
        endOffset: normalized.length,
      },
    ];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 1;

  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + safeSize);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
      if (breakAt > safeSize * 0.55) {
        end = start + breakAt + 1;
      }
    }

    const chunkText = normalized.slice(start, end).trim();
    if (chunkText) {
      chunks.push({
        id: `${filename}#chunk-${index}`,
        filename,
        chunkIndex: index,
        text: chunkText,
        startOffset: start,
        endOffset: end,
      });
      index++;
    }

    if (end >= normalized.length) break;
    start = Math.max(start + 100, end - safeOverlap);
    if (start <= chunks[chunks.length - 1]?.startOffset) {
      start = chunks[chunks.length - 1].startOffset + step;
    }
  }

  return chunks;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'what', 'when', 'where', 'which', 'who',
  'how', 'can', 'will', 'would', 'should', 'could', 'into', 'about', 'your',
  'you', 'our', 'their', 'they', 'its', 'than', 'then', 'also', 'been',
]);

function tokenizeWords(input: string): string[] {
  return (input.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

function buildCharTrigrams(input: string): Map<string, number> {
  const cleaned = input.toLowerCase().replace(/\s+/g, ' ').trim();
  const counts = new Map<string, number>();
  if (cleaned.length < 3) return counts;
  for (let i = 0; i <= cleaned.length - 3; i++) {
    const tri = cleaned.slice(i, i + 3);
    counts.set(tri, (counts.get(tri) ?? 0) + 1);
  }
  return counts;
}

function cosineSimilarityMaps(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [k, va] of a.entries()) {
    normA += va * va;
    const vb = b.get(k);
    if (vb !== undefined) dot += va * vb;
  }
  for (const vb of b.values()) {
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function retrieveRelevantChunks(
  query: string,
  attachments: ChatAttachment[],
  options: {
    topK?: number;
    maxTotalChars?: number;
    chunkSize?: number;
    overlap?: number;
  } = {}
): RetrievedChunk[] {
  const topK = options.topK ?? 6;
  const maxTotalChars = options.maxTotalChars ?? 5500;
  const chunkSize = options.chunkSize ?? 900;
  const overlap = options.overlap ?? 150;

  const allChunks: DocumentChunk[] = [];
  for (const att of attachments) {
    if (!att.textContent?.trim()) continue;
    allChunks.push(...chunkDocumentText(att.name, att.textContent, chunkSize, overlap));
  }
  if (allChunks.length === 0) return [];

  const queryTerms = tokenizeWords(query);
  const queryTrigrams = buildCharTrigrams(query);
  const trimmedQueryLower = query.trim().toLowerCase();

  if (queryTerms.length === 0) {
    const fallback: RetrievedChunk[] = [];
    let used = 0;
    for (const chunk of allChunks.slice(0, topK)) {
      if (used + chunk.text.length > maxTotalChars && fallback.length > 0) break;
      fallback.push({
        chunk,
        score: 1 / chunk.chunkIndex,
        citationTag: `[Source: ${chunk.filename} #chunk-${chunk.chunkIndex}]`,
      });
      used += chunk.text.length;
    }
    return fallback;
  }

  // Compute corpus DF & average chunk length for BM25
  const docTokenLists = allChunks.map((c) => tokenizeWords(c.text));
  const avgLen =
    docTokenLists.reduce((sum, list) => sum + list.length, 0) / Math.max(1, docTokenLists.length);
  const docFreq = new Map<string, number>();
  for (const tokens of docTokenLists) {
    const uniq = new Set(tokens);
    for (const t of uniq) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }

  const N = allChunks.length;
  const k1 = 1.5;
  const b = 0.75;

  const rawScores = allChunks.map((chunk, i) => {
    const tokens = docTokenLists[i];
    const tfMap = new Map<string, number>();
    for (const t of tokens) {
      tfMap.set(t, (tfMap.get(t) ?? 0) + 1);
    }

    let bm25 = 0;
    for (const qt of queryTerms) {
      const df = docFreq.get(qt) ?? 0;
      if (df === 0) continue;
      const tf = tfMap.get(qt) ?? 0;
      if (tf === 0) continue;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const denom = tf + k1 * (1 - b + (b * tokens.length) / Math.max(1, avgLen));
      bm25 += idf * ((tf * (k1 + 1)) / denom);
    }

    const trigramSim = cosineSimilarityMaps(queryTrigrams, buildCharTrigrams(chunk.text));
    const phraseBonus =
      trimmedQueryLower.length >= 6 && chunk.text.toLowerCase().includes(trimmedQueryLower)
        ? 0.25
        : 0;

    return {
      chunk,
      bm25,
      trigramSim,
      phraseBonus,
    };
  });

  const maxBm25 = Math.max(1e-6, ...rawScores.map((r) => r.bm25));
  const scored: RetrievedChunk[] = rawScores
    .map((r) => {
      const normBm25 = r.bm25 > 0 ? r.bm25 / maxBm25 : 0;
      const score = 0.65 * normBm25 + 0.35 * r.trigramSim + r.phraseBonus;
      return {
        chunk: r.chunk,
        score,
        citationTag: `[Source: ${r.chunk.filename} #chunk-${r.chunk.chunkIndex}]`,
      };
    })
    .sort((aItem, bItem) => bItem.score - aItem.score || aItem.chunk.chunkIndex - bItem.chunk.chunkIndex);

  const selected: RetrievedChunk[] = [];
  let totalChars = 0;
  for (const item of scored) {
    if (selected.length >= topK) break;
    if (totalChars + item.chunk.text.length > maxTotalChars && selected.length > 0) continue;
    selected.push(item);
    totalChars += item.chunk.text.length;
  }

  return selected;
}

export function buildRagContextBlock(
  query: string,
  attachments: ChatAttachment[],
  options?: { topK?: number; maxTotalChars?: number }
): { contextText: string; citations: RetrievedChunk[] } {
  const citations = retrieveRelevantChunks(query, attachments, options);
  if (citations.length === 0) {
    return { contextText: '', citations: [] };
  }

  const lines = [
    '[LOCAL RAG RETRIEVED EXCERPTS — Cite matching [Source: filename #chunk-N] tags when referencing facts below]',
  ];
  for (const item of citations) {
    lines.push(`${item.citationTag}\n${item.chunk.text}`);
  }
  return {
    contextText: lines.join('\n\n'),
    citations,
  };
}

export function applyLocalRagToMessages(
  messages: LlmConversationItem[],
  thresholdChars = 3000
): RagResult {
  const textAttachments: ChatAttachment[] = [];
  let totalSourceChars = 0;

  for (const msg of messages) {
    if (msg.role !== 'user' || !msg.attachments) continue;
    for (const att of msg.attachments) {
      if (att.textContent?.trim()) {
        textAttachments.push(att);
        totalSourceChars += att.textContent.length;
      }
    }
  }

  if (textAttachments.length === 0 || totalSourceChars <= thresholdChars) {
    return {
      messages,
      usedRag: false,
      totalSourceChars,
      retrievedCount: 0,
      citationTags: [],
    };
  }

  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  const lastUserItem = lastUserIdx >= 0 ? messages[lastUserIdx] : undefined;
  const query = lastUserItem && lastUserItem.role === 'user' ? lastUserItem.text : '';
  const { contextText, citations } = buildRagContextBlock(query, textAttachments, {
    topK: 6,
    maxTotalChars: 5500,
  });

  if (!contextText) {
    return {
      messages,
      usedRag: false,
      totalSourceChars,
      retrievedCount: 0,
      citationTags: [],
    };
  }

  const nextMessages: LlmConversationItem[] = messages.map((msg, idx) => {
    if (msg.role !== 'user') return msg;
    const nextAtts = msg.attachments?.map((att) => {
      if (!att.textContent?.trim()) return att;
      return {
        ...att,
        textContent: `[Indexed via Local RAG (${att.textContent.length} chars) — relevant excerpts injected below]`,
      };
    });
    if (idx === lastUserIdx) {
      return {
        ...msg,
        attachments: nextAtts,
        text: `${msg.text}\n\n${contextText}`,
      };
    }
    return {
      ...msg,
      attachments: nextAtts,
    };
  });

  return {
    messages: nextMessages,
    usedRag: true,
    totalSourceChars,
    retrievedCount: citations.length,
    citationTags: citations.map((c) => c.citationTag),
  };
}
