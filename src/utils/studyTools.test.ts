import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatReadableModelSlug,
  FREE_MODELS,
  getShortModelName,
} from '../config/models';
import { mergeModelCatalog } from '../services/llm/provider';
import {
  parseInlineTokens,
  parseMarkdownBlocks,
  stripMarkdownForSpeech,
} from './markdownParser';
import {
  extractFlashcardsFromMarkdown,
  extractQuizFromMarkdown,
} from './studyTools';

test('parseMarkdownBlocks parses GFM tables with alignments cleanly', () => {
  const md = [
    '## Comparison',
    '',
    '| Feature | TCP | UDP |',
    '| :--- | :---: | ---: |',
    '| Reliability | Guaranteed | Best effort |',
    '| Ordering | Ordered | Unordered |',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'table');
  if (blocks[1].type === 'table') {
    assert.deepEqual(blocks[1].headers, ['Feature', 'TCP', 'UDP']);
    assert.deepEqual(blocks[1].alignments, ['left', 'center', 'right']);
    assert.equal(blocks[1].rows.length, 2);
    assert.deepEqual(blocks[1].rows[0], ['Reliability', 'Guaranteed', 'Best effort']);
  }
});

test('parseMarkdownBlocks handles unclosed streaming code fences without crashing', () => {
  const md = 'Here is code:\n```python\ndef attention(q, k, v):\n    return q';
  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[1].type, 'code');
  if (blocks[1].type === 'code') {
    assert.equal(blocks[1].language, 'python');
    assert.ok(blocks[1].code.includes('def attention'));
  }
});

test('parseMarkdownBlocks parses task checklists, hr, and blockquotes', () => {
  const md = [
    '- [x] Read intuition',
    '- [ ] Complete quiz',
    '',
    '---',
    '',
    '> Key takeaway: Attention weights sum to 1.',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'ul');
  if (blocks[0].type === 'ul') {
    assert.equal(blocks[0].items[0].checked, true);
    assert.equal(blocks[0].items[1].checked, false);
  }
  assert.equal(blocks[1].type, 'hr');
  assert.equal(blocks[2].type, 'blockquote');
});

test('parseInlineTokens tokenizes links, math, code, bold, italic, and strikethrough', () => {
  const tokens = parseInlineTokens(
    'Compute **softmax** of $QK^T$ using `numpy` and see [Docs](https://example.com) (~not~ ~~old~~).'
  );
  assert.ok(tokens.some((t) => t.type === 'bold' && t.text === 'softmax'));
  assert.ok(tokens.some((t) => t.type === 'math' && t.text === 'QK^T'));
  assert.ok(tokens.some((t) => t.type === 'code' && t.text === 'numpy'));
  assert.ok(
    tokens.some((t) => t.type === 'link' && t.label === 'Docs' && t.url === 'https://example.com')
  );
  assert.ok(tokens.some((t) => t.type === 'strike' && t.text === 'old'));
});

test('stripMarkdownForSpeech removes markdown syntax cleanly for TTS', () => {
  const speech = stripMarkdownForSpeech(
    '# Topic\n**Bold** and `inline`\n| Col1 | Col2 |\n|---|---|\n| A | B |\n```study-quiz\n[]\n```'
  );
  assert.ok(!speech.includes('```'));
  assert.ok(!speech.includes('|'));
  assert.ok(speech.includes('Bold and inline'));
});

test('extractFlashcardsFromMarkdown extracts study-flashcards JSON fences and tables', () => {
  const fromJson = extractFlashcardsFromMarkdown(
    '```study-flashcards\n[{"front":"What is Q?","back":"Query vector","memoryHook":"Asking a question"}]\n```'
  );
  assert.equal(fromJson.length, 1);
  assert.equal(fromJson[0].front, 'What is Q?');
  assert.equal(fromJson[0].memoryHook, 'Asking a question');

  const fromTable = extractFlashcardsFromMarkdown(
    '| Step | Action | Output |\n|---|---|---|\n| 1 | Tokenize | IDs |\n| 2 | Embed | Vectors |'
  );
  assert.equal(fromTable.length, 2);
  assert.ok(fromTable[0].front.includes('Tokenize'));
});

test('extractQuizFromMarkdown extracts study-quiz JSON fences cleanly', () => {
  const md = [
    '```study-quiz',
    JSON.stringify([
      {
        question: 'Why scale by sqrt(d_k)?',
        options: ['A', 'Prevent vanishing softmax gradients', 'C', 'D'],
        correctIndex: 1,
        explanation: 'Keeps dot-product variance near 1.',
      },
    ]),
    '```',
  ].join('\n');

  const questions = extractQuizFromMarkdown(md);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].correctIndex, 1);
  assert.equal(questions[0].options[1], 'Prevent vanishing softmax gradients');
});

test('getShortModelName and mergeModelCatalog preserve clean friendly labels instead of raw slugs', () => {
  assert.equal(
    formatReadableModelSlug('openai/gpt-oss-120b'),
    'GPT OSS 120B'
  );

  const merged = mergeModelCatalog([
    {
      id: 'openai/gpt-oss-120b',
      provider: 'groq',
      label: 'openai/gpt-oss-120b (Groq Live)',
      description: 'Groq model',
      contextWindow: 131_072,
      supportsReasoningEffort: true,
      isFreeTier: true,
    },
  ]);

  const gptOss = merged.find((m) => m.id === 'openai/gpt-oss-120b');
  assert.ok(gptOss);
  assert.equal(gptOss.label, 'GPT-OSS 120B (Groq)');
  assert.equal(getShortModelName(gptOss), 'GPT-OSS 120B');

  const gemini = FREE_MODELS.find((m) => m.id === 'gemini-4-hydrogen');
  assert.ok(gemini);
  assert.equal(getShortModelName(gemini), 'Gemini 4 Flash');
});
