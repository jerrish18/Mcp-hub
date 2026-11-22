import { parseMarkdownBlocks } from './markdownParser';

export interface StudyFlashcard {
  id: string;
  front: string;
  back: string;
  memoryHook?: string;
}

export interface StudyQuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface SavedStudyNote {
  id: string;
  title: string;
  content: string;
  modelLabel?: string;
  messageId?: string;
  createdAt: number;
}

function cleanCardText(text: string): string {
  return text
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Extracts interactive flashcards from a study response using multiple formats:
 * 1) Explicit JSON blocks (`study-flashcards` or JSON array of { front, back })
 * 2) Heading cards (`### Card 1` with Question / Answer)
 * 3) Markdown table rows (`| Term | Meaning | ... |`)
 * 4) Numbered / Q&A lines or bold `- **Concept:** Explanation` bullets
 */
export function extractFlashcardsFromMarkdown(markdown: string): StudyFlashcard[] {
  if (!markdown.trim()) return [];

  // 1. Structured JSON fence (`study-flashcards` or json array of front/back)
  const jsonFenceRegex = /```(?:study-flashcards|flashcards|json)?\n([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = jsonFenceRegex.exec(markdown)) !== null) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim()) as unknown;
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { flashcards?: unknown[] }).flashcards)
          ? (parsed as { flashcards: unknown[] }).flashcards
          : null;
      if (arr && arr.length > 0) {
        const cards: StudyFlashcard[] = [];
        for (let idx = 0; idx < arr.length; idx++) {
          const item = arr[idx] as Record<string, unknown>;
          const front = String(item.front ?? item.question ?? item.term ?? '').trim();
          const back = String(item.back ?? item.answer ?? item.definition ?? '').trim();
          const hook = item.memoryHook ?? item.hook ?? item.hint;
          if (front && back) {
            cards.push({
              id: `fc_json_${idx}`,
              front,
              back,
              memoryHook: hook ? String(hook).trim() : undefined,
            });
          }
        }
        if (cards.length > 0) return cards;
      }
    } catch {
      // Fall through to markdown extraction heuristics
    }
  }

  const cards: StudyFlashcard[] = [];

  // 2. Card headings / Q&A pairs
  const cardBlocks = markdown.split(/\n(?=###\s+Card\s+\d+|\*\*Question(?:\s+\d+)?[:*])/i);
  for (let i = 0; i < cardBlocks.length; i++) {
    const block = cardBlocks[i];
    const qMatch = /\*\*(?:Question|Front|Prompt)(?:\s+\d+)?:\*\*\s*([\s\S]*?)(?=\n\s*\*\*(?:Answer|Back):|\n\s*$)/i.exec(
      block
    );
    const aMatch = /\*\*(?:Answer|Back):\*\*\s*([\s\S]*?)(?=\n\s*\*\*(?:Memory Hook|Hint):|\n###|\n\s*$)/i.exec(
      block
    );
    const hookMatch = /\*\*(?:Memory Hook|Hint):\*\*\s*([^\n]+)/i.exec(block);
    if (qMatch && aMatch) {
      const front = cleanCardText(qMatch[1]);
      const back = cleanCardText(aMatch[1]);
      if (front && back) {
        cards.push({
          id: `fc_qa_${cards.length}`,
          front,
          back,
          memoryHook: hookMatch ? cleanCardText(hookMatch[1]) : undefined,
        });
      }
    }
  }
  if (cards.length >= 2) return cards;

  // 3. Extract from Markdown tables (Term/Step -> Description/Takeaway)
  const blocks = parseMarkdownBlocks(markdown);
  for (const b of blocks) {
    if (b.type === 'table' && b.headers.length >= 2 && b.rows.length > 0) {
      for (const row of b.rows) {
        const frontCol = row.length >= 3 && /^\d+$/.test(row[0].trim()) ? row[1] : row[0];
        const restStart = row.length >= 3 && /^\d+$/.test(row[0].trim()) ? 2 : 1;
        const backParts = row
          .slice(restStart)
          .map((cell, idx) => {
            const hdr = b.headers[restStart + idx];
            const cleanCell = cleanCardText(cell);
            return cleanCell ? (hdr ? `${cleanCardText(hdr)}: ${cleanCell}` : cleanCell) : '';
          })
          .filter(Boolean);
        const front = cleanCardText(frontCol);
        const back = backParts.join(' · ');
        if (front && back && !cards.some((c) => c.front === front)) {
          cards.push({
            id: `fc_tbl_${cards.length}`,
            front: `What does "${front}" mean / do?`,
            back,
          });
        }
      }
    }
  }

  // 4. Bold definition bullets (- **Concept:** Explanation)
  for (const b of blocks) {
    if (b.type === 'ul') {
      for (const item of b.items) {
        const defMatch = /^\*\*([^*\n]{2,80}?)(?::)?\*\*[:\s-]+(.+)$/.exec(item.text.trim());
        if (defMatch) {
          const term = cleanCardText(defMatch[1]);
          const explanation = cleanCardText(defMatch[2]);
          if (term && explanation && !cards.some((c) => c.front.includes(term))) {
            cards.push({
              id: `fc_ul_${cards.length}`,
              front: term,
              back: explanation,
            });
          }
        }
      }
    }
  }

  // 5. Fallback: turn numbered self-check questions into flashcards
  if (cards.length === 0) {
    for (const b of blocks) {
      if (b.type === 'ol') {
        for (const item of b.items) {
          const cleaned = cleanCardText(item);
          if (cleaned.length > 10) {
            cards.push({
              id: `fc_ol_${cards.length}`,
              front: cleaned,
              back: 'Review the worked example and core concepts in the Study Note to verify your answer.',
            });
          }
        }
      }
    }
  }

  return cards.slice(0, 12);
}

/**
 * Extracts multiple-choice practice questions from a `study-quiz` JSON fence
 * or numbered A/B/C/D quiz sections in Markdown.
 */
export function extractQuizFromMarkdown(markdown: string): StudyQuizQuestion[] {
  if (!markdown.trim()) return [];

  const jsonFenceRegex = /```(?:study-quiz|quiz|json)?\n([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = jsonFenceRegex.exec(markdown)) !== null) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim()) as unknown;
      const arr = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown[] }).questions)
          ? (parsed as { questions: unknown[] }).questions
          : null;
      if (arr && arr.length > 0) {
        const questions: StudyQuizQuestion[] = [];
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i] as Record<string, unknown>;
          const question = String(item.question ?? item.prompt ?? '').trim();
          const options = Array.isArray(item.options)
            ? item.options.map((o) => String(o).trim()).filter(Boolean)
            : [];
          const rawIdx = Number(item.correctIndex ?? item.answerIndex ?? 0);
          const correctIndex = Number.isFinite(rawIdx)
            ? Math.max(0, Math.min(options.length - 1, rawIdx))
            : 0;
          const explanation = String(item.explanation ?? item.rationale ?? 'Review this concept in your notes.').trim();
          if (question && options.length >= 2) {
            questions.push({
              id: `quiz_json_${i}`,
              question,
              options,
              correctIndex,
              explanation,
            });
          }
        }
        if (questions.length > 0) return questions;
      }
    } catch {
      // Fallback to text parser
    }
  }

  // Fallback: Parse numbered A/B/C/D markdown questions
  const questions: StudyQuizQuestion[] = [];
  const chunks = markdown.split(/\n(?=(?:#{1,4}\s*)?(?:Q(?:uestion)?\s*)?\d+[.)]\s+)/i);
  for (const chunk of chunks) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 4) continue;
    const qLine = lines[0].replace(/^(?:#{1,4}\s*)?(?:Q(?:uestion)?\s*)?\d+[.)]\s+/i, '');
    const opts: string[] = [];
    let answerLetter = '';
    let explanation = '';
    for (let li = 1; li < lines.length; li++) {
      const optMatch = /^([A-D])[.)]\s+(.+)$/i.exec(lines[li]);
      if (optMatch) {
        opts.push(cleanCardText(optMatch[2]));
        continue;
      }
      const ansMatch = /^(?:\*\*)?(?:Answer|Correct)(?:\*\*)?:\s*([A-D])(?:\s*[-—–:]\s*(.+))?$/i.exec(lines[li]);
      if (ansMatch) {
        answerLetter = ansMatch[1].toUpperCase();
        if (ansMatch[2]) explanation = cleanCardText(ansMatch[2]);
      }
    }
    if (qLine && opts.length >= 2) {
      const letterIdx = ['A', 'B', 'C', 'D'].indexOf(answerLetter);
      questions.push({
        id: `quiz_md_${questions.length}`,
        question: cleanCardText(qLine),
        options: opts,
        correctIndex: letterIdx >= 0 && letterIdx < opts.length ? letterIdx : 0,
        explanation: explanation || 'Check the matching explanation in the study guide above.',
      });
    }
  }

  return questions.slice(0, 10);
}

export function buildFlashcardsGenerationPrompt(topicOrExcerpt: string): string {
  const excerpt = topicOrExcerpt.slice(0, 1400).trim();
  return (
    'Create 6 high-yield study flashcards based on our current study topic/notes below.\n' +
    'Return ONE valid JSON code block fenced with ```study-flashcards containing an array of objects with keys "front", "back", and "memoryHook".\n' +
    'Keep each front crisp (a focused question or concept) and each back clear and concise.\n\n' +
    `Context:\n${excerpt}`
  );
}

export function buildQuizGenerationPrompt(topicOrExcerpt: string): string {
  const excerpt = topicOrExcerpt.slice(0, 1400).trim();
  return (
    'Create a 4-question multiple-choice practice quiz testing real understanding (not trivial recall) on our study topic/notes below.\n' +
    'Return ONE valid JSON code block fenced with ```study-quiz containing an array of objects with keys: "question", "options" (4 strings), "correctIndex" (0-3), and "explanation".\n\n' +
    `Context:\n${excerpt}`
  );
}

export function buildQuickStudyActionPrompt(
  action: 'simplify' | 'analogy' | 'takeaways' | 'review_mistakes',
  contextExcerpt: string
): string {
  const snippet = contextExcerpt.slice(0, 1200).trim();
  switch (action) {
    case 'simplify':
      return `Explain the key concepts from your previous explanation much more simply — like I'm brand new to this, using everyday words and short steps.\n\nReference:\n${snippet}`;
    case 'analogy':
      return `Give me 2 vivid real-world analogies to build strong mental intuition for this topic, then tie each part of the analogy back to the real mechanism.\n\nReference:\n${snippet}`;
    case 'takeaways':
      return `Distill the topic into an ultra-clean 5-bullet cheat sheet + 1 quick comparison table for fast revision.\n\nReference:\n${snippet}`;
    case 'review_mistakes':
      return `Help me review and deeply understand the missed quiz concepts below. Explain why each wrong option is a common trap and how to remember the right principle:\n\n${snippet}`;
  }
}
