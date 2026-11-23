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
import { detectStudyVisualQuery } from './studyImages';
import { searchEducationalWebImages } from '../server/studyImagesRouter';

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

test('parseMarkdownBlocks parses mermaid fences, display math_block, and study callouts including collapsible hints', () => {
  const md = [
    '> [!DEFINITION] Attention Mechanism',
    '> Computes weighted combinations of values based on query-key similarity.',
    '',
    '$$',
    '\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V',
    '$$',
    '',
    '```mermaid',
    'flowchart LR',
    '  Q[Query] --> Dot[Dot Product]',
    '```',
    '',
    '> [!HINT]- Check intuition',
    '> Dividing by sqrt(d_k) keeps variance at 1.',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'blockquote');
  if (blocks[0].type === 'blockquote') {
    assert.equal(blocks[0].calloutKind, 'definition');
    assert.equal(blocks[0].calloutTitle, 'Attention Mechanism');
    assert.equal(blocks[0].isCollapsible, false);
  }

  assert.equal(blocks[1].type, 'math_block');
  if (blocks[1].type === 'math_block') {
    assert.ok(blocks[1].latex.includes('\\text{softmax}'));
  }

  assert.equal(blocks[2].type, 'code');
  if (blocks[2].type === 'code') {
    assert.equal(blocks[2].language, 'mermaid');
    assert.ok(blocks[2].code.includes('flowchart LR'));
  }

  assert.equal(blocks[3].type, 'blockquote');
  if (blocks[3].type === 'blockquote') {
    assert.equal(blocks[3].calloutKind, 'hint');
    assert.equal(blocks[3].calloutTitle, 'Check intuition');
    assert.equal(blocks[3].isCollapsible, true);
  }
});

test('parseInlineTokens treats currency prices as plain text while tokenizing $E=mc^2$ math', () => {
  const currency = parseInlineTokens('Tier A costs $5 and Tier B costs $10 per seat.');
  assert.equal(currency.some((t) => t.type === 'math'), false);

  const equation = parseInlineTokens('Energy satisfies $E=mc^2$ and $x$ is positive.');
  assert.ok(equation.some((t) => t.type === 'math' && t.text === 'E=mc^2'));
  assert.ok(equation.some((t) => t.type === 'math' && t.text === 'x'));
});

test('parseMarkdownBlocks parses standalone Markdown web images with captions and blocks unsafe protocols', () => {
  const md = [
    '![Human Heart Diagram](https://upload.wikimedia.org/wikipedia/commons/heart.png "Pulmonary and systemic circulation")',
    '',
    '![Unsafe](javascript:alert(1))',
  ].join('\n');

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks[0].type, 'image');
  if (blocks[0].type === 'image') {
    assert.equal(blocks[0].alt, 'Human Heart Diagram');
    assert.equal(blocks[0].url, 'https://upload.wikimedia.org/wikipedia/commons/heart.png');
    assert.equal(blocks[0].caption, 'Pulmonary and systemic circulation');
  }
  // javascript: URL must NOT be parsed as an image block
  assert.notEqual(blocks[1].type, 'image');

  const inlineTokens = parseInlineTokens('See ![Atom](https://example.org/atom.png) for structure.');
  assert.ok(inlineTokens.some((t) => t.type === 'image' && t.alt === 'Atom'));
});

test('detectStudyVisualQuery extracts educational image search topic and respects uploaded source', () => {
  assert.equal(
    detectStudyVisualQuery('Show me real web images and a flowchart explaining human heart anatomy.', 'auto'),
    'human heart anatomy'
  );
  assert.equal(
    detectStudyVisualQuery('Show me images of solar system planets', 'uploaded'),
    null
  );
  assert.equal(detectStudyVisualQuery('Photosynthesis light reactions', 'web'), 'Photosynthesis light reactions');
});

test('searchEducationalWebImages queries Wikipedia API cleanly and filters decorative icons', async () => {
  const mockFetch = (async () =>
    new Response(
      JSON.stringify({
        query: {
          pages: {
            '1': {
              index: 1,
              title: 'Commons-logo',
              thumbnail: { source: 'https://upload.wikimedia.org/commons-logo.svg' },
            },
            '2': {
              index: 2,
              title: 'Heart',
              fullurl: 'https://en.wikipedia.org/wiki/Heart',
              extract: 'The heart is a muscular organ in most animals.',
              thumbnail: { source: 'https://upload.wikimedia.org/heart.jpg' },
            },
          },
        },
      }),
      { status: 200 }
    )) as typeof fetch;

  const images = await searchEducationalWebImages('human heart', 2, mockFetch);
  assert.equal(images.length, 1);
  assert.equal(images[0].title, 'Heart');
  assert.equal(images[0].imageUrl, 'https://upload.wikimedia.org/heart.jpg');
  assert.equal(images[0].source, 'Wikipedia');
});


