import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PendingApproval } from '../types';
import { approvalChanges, githubApprovalReads } from './approvalDiff';

test('GitHub approval diffs use validated read targets and known previous contents', () => {
  const original = { repo: 'owner/project', branch: 'main', files: [
    { path: 'index.html', content: 'new text' }, { path: 'extra.css', content: 'additional' },
  ] };
  assert.deepEqual(githubApprovalReads({ toolName: 'github_push_files_batch' } as PendingApproval, original), [
    { owner: 'owner', repo: 'project', path: 'index.html', branch: 'main' },
    { owner: 'owner', repo: 'project', path: 'extra.css', branch: 'main' },
  ]);
  assert.deepEqual(githubApprovalReads({ toolName: 'github_push_file' } as PendingApproval, { repo: 'owner/project', path: '../outside', content: 'text' }), []);
  const changes = approvalChanges(original, original, { 'index.html': 'old text' });
  assert.equal(changes[0].hasBefore, true);
  assert.ok(changes[0].parts?.some(({ removed, value }) => removed && value === 'old text'));
  assert.equal(changes[1].hasBefore, false);
});

test('generic approvals compare edited arguments and distinguish proposed-only values', () => {
  const original = { name: 'before' };
  const draft = { name: 'after' };
  assert.ok(approvalChanges(original, draft)[0].parts?.some(({ added }) => added));
  assert.equal(approvalChanges(original, original)[0].hasBefore, false);
  assert.equal(approvalChanges({}, { before: 'a', after: 'b' })[0].next, 'b');
});
