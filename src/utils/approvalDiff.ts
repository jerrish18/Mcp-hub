import { canvasFilePathError } from './canvasArtifacts';
import { diffLines } from 'diff';
import type { PendingApproval } from '../types';

type Args = Record<string, unknown>;
type FileChange = { path: string; content: string };

export function approvalFiles(args: Args): FileChange[] {
  if (Array.isArray(args.files)) return args.files.flatMap((file) =>
    file && typeof file === 'object' && typeof file.path === 'string' && typeof file.content === 'string'
      ? [{ path: file.path, content: file.content }] : []);
  if (typeof args.path === 'string' && typeof args.content === 'string') return [{ path: args.path, content: args.content }];
  return [];
}

export function githubApprovalReads(approval: PendingApproval, args: Args): Args[] {
  if (approval.toolName !== 'github_push_file' && approval.toolName !== 'github_push_files_batch') return [];
  const repository = typeof args.repo === 'string' ? args.repo.split('/') : [];
  const owner = typeof args.owner === 'string' ? args.owner : repository.length === 2 ? repository[0] : undefined;
  const repo = repository.at(-1);
  if (!owner || !repo || !/^[a-z\d-]+$/i.test(owner) || !/^[a-z\d._-]+$/i.test(repo) || repo === '.' || repo === '..') return [];
  const branch = typeof args.branch === 'string' ? args.branch : undefined;
  return approvalFiles(args).filter(({ path }) => !canvasFilePathError(path)).slice(0, 12).map(({ path }) => ({ owner, repo, path, branch }));
}

const DISPLAY_LIMIT = 12000;

export function approvalChanges(original: Args, draft: Args, previous: Record<string, string> = {}) {
  const makeChange = (name: string, after: string, before?: string) => {
    const next = after.slice(0, DISPLAY_LIMIT);
    return {
      name, next, hasBefore: before !== undefined,
      truncated: after.length > DISPLAY_LIMIT || (before?.length ?? 0) > DISPLAY_LIMIT,
      parts: before !== undefined ? diffLines(before.slice(0, DISPLAY_LIMIT), next, { timeout: 100 }) : undefined,
    };
  };
  const proposedFiles = approvalFiles(draft);
  if (proposedFiles.length) {
    return proposedFiles.map(({ path, content }) =>
      makeChange(path, content, Object.hasOwn(previous, path) ? previous[path] : undefined));
  }
  const before = draft.before ?? draft.oldContent ?? draft.previousContent;
  const after = draft.after ?? draft.newContent ?? draft.content;
  if ((typeof before === 'string' || typeof after === 'string') && typeof after === 'string') {
    return [makeChange('Content', after, typeof before === 'string' ? before : undefined)];
  }
  const originalJson = JSON.stringify(original, null, 2);
  const draftJson = JSON.stringify(draft, null, 2);
  return [makeChange('Tool arguments', draftJson, originalJson !== draftJson ? originalJson : undefined)];
}
