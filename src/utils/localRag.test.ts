import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatAttachment } from '../types';
import {
  applyLocalRagToMessages,
  buildRagContextBlock,
  chunkDocumentText,
  retrieveRelevantChunks,
} from './localRag';

test('chunkDocumentText splits long text into overlapping numbered chunks', () => {
  const longText = Array.from({ length: 12 }, (_, i) =>
    `Section ${i + 1}: Detailed notes about topic ${i + 1}. `.repeat(6)
  ).join('\n\n');

  const chunks = chunkDocumentText('architecture.md', longText, 500, 100);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks[0].chunkIndex, 1);
  assert.equal(chunks[0].filename, 'architecture.md');
  assert.equal(chunks[1].chunkIndex, 2);
  assert.ok(chunks[0].text.length <= 520);
});

test('retrieveRelevantChunks ranks sections matching query above unrelated sections with source citations', () => {
  const docA = [
    'Chapter 1: Cooking Pasta. Boil water with salt and stir spaghetti for 9 minutes.',
    'Chapter 2: Gardening Tomatoes. Water deeply twice weekly under full sunlight.',
    'Chapter 3: Kubernetes Pod Scheduling. Kube-scheduler binds pods to nodes using affinity rules, taints, and tolerations.',
    'Chapter 4: Financial Audit Summary. Q4 cloud spend decreased by 18 percent after autoscaling.',
  ]
    .map((s) => `${s} ${'Filler context line. '.repeat(25)}`)
    .join('\n\n');

  const attachment: ChatAttachment = {
    id: 'att_1',
    name: 'handbook.txt',
    mimeType: 'text/plain',
    kind: 'file',
    size: docA.length,
    textContent: docA,
  };

  const hits = retrieveRelevantChunks(
    'How does Kubernetes kube-scheduler handle taints and tolerations?',
    [attachment],
    { topK: 2, chunkSize: 600, overlap: 80 }
  );

  assert.ok(hits.length >= 1);
  assert.ok(hits[0].chunk.text.includes('Kube-scheduler'));
  assert.match(hits[0].citationTag, /^\[Source: handbook\.txt #chunk-\d+\]$/);
});

test('applyLocalRagToMessages compresses large text attachments while preserving small ones and images', () => {
  const bigBody = [
    'Overview section with general project notes. '.repeat(50),
    'Rate limiting policy uses token bucket at 120 requests per minute per tenant key. '.repeat(15),
    'Footer legal notice and archive table. '.repeat(60),
  ].join('\n\n');

  const largeFile: ChatAttachment = {
    id: 'big_1',
    name: 'policy.md',
    mimeType: 'text/markdown',
    kind: 'file',
    size: bigBody.length,
    textContent: bigBody,
  };
  const imageAtt: ChatAttachment = {
    id: 'img_1',
    name: 'diagram.png',
    mimeType: 'image/png',
    kind: 'image',
    size: 1024,
    dataBase64: 'AAAA',
  };

  const smallRes = applyLocalRagToMessages(
    [{ role: 'user', text: 'Summarize', attachments: [{ ...largeFile, textContent: 'Short note.' }] }],
    3000
  );
  assert.equal(smallRes.usedRag, false);

  const ragRes = applyLocalRagToMessages(
    [
      {
        role: 'user',
        text: 'What is the token bucket rate limiting policy?',
        attachments: [largeFile, imageAtt],
      },
    ],
    3000
  );

  assert.equal(ragRes.usedRag, true);
  assert.ok(ragRes.retrievedCount >= 1);
  const lastMsg = ragRes.messages[0];
  assert.equal(lastMsg.role, 'user');
  if (lastMsg.role === 'user') {
    assert.ok(lastMsg.text.includes('[Source: policy.md #chunk-'));
    assert.ok(lastMsg.text.includes('token bucket'));
    assert.equal(lastMsg.attachments?.[1].dataBase64, 'AAAA');
    assert.ok((lastMsg.attachments?.[0].textContent?.length ?? 9999) < 200);
  }

  const block = buildRagContextBlock('rate limiting', [largeFile]);
  assert.ok(block.contextText.includes('[Source: policy.md #chunk-'));
});
