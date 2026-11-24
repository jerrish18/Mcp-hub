import { canvasFilePathError } from '../../utils/canvasArtifacts';
import type { AppFileEntry } from '../../utils/appArtifact';

export interface CanvasPublishRequest {
  repository: string;
  branch: string;
  message: string;
  description?: string;
  createRepository: boolean;
  privateRepository: boolean;
  files: readonly AppFileEntry[];
}

export interface CanvasPublishResult {
  repository?: string;
  branch?: string;
  commitUrl?: string;
  createdRepository?: boolean;
  cancelled?: boolean;
  error?: string;
}

interface CanvasPublishOperations {
  getLogin: () => Promise<string>;
  check?: (tool: string, args: Record<string, unknown>) => void;
  approve: (tool: string, args: Record<string, unknown>, description: string) => Promise<boolean>;
  call: (tool: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
}

const loginPattern = /^[a-z\d][a-z\d-]{0,38}$/i;
const repoPattern = /^[a-z\d_.-]{1,100}$/i;

export function validateCanvasPublish(request: CanvasPublishRequest): void {
  const pieces = request.repository.trim().split('/');
  const name = pieces.at(-1) ?? '';
  if (pieces.length > (request.createRepository ? 1 : 2) || !repoPattern.test(name) || ['.', '..', '.git'].includes(name.toLowerCase()) ||
    (pieces.length === 2 && !loginPattern.test(pieces[0]))) {
    throw new Error(request.createRepository ? 'Enter a valid GitHub repository name.' : 'Enter a GitHub repository as owner/name or name.');
  }
  const branch = request.branch.trim();
  if (!branch || branch === '@' || branch.startsWith('-') || branch.endsWith('.') || branch.includes('..') ||
    branch.includes('@{') || /[~^:?*[\\]/.test(branch) || [...branch].some((char) => char <= ' ' || char === '\x7f') ||
    branch.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))) {
    throw new Error('Enter a valid Git branch name.');
  }
  if (!request.message.trim()) throw new Error('Enter a commit message.');
  if (!request.files.length) throw new Error('The project has no files.');
  const paths = new Set<string>();
  for (const { path } of request.files) {
    const error = canvasFilePathError(path);
    if (error) throw new Error(error);
    const key = path.toLowerCase();
    if (paths.has(key)) throw new Error(`Duplicate project file path: ${path}`);
    paths.add(key);
  }
}

export async function publishCanvasRevision(request: CanvasPublishRequest, operations: CanvasPublishOperations): Promise<CanvasPublishResult> {
  const snapshot = {
    ...request,
    files: request.files.map(({ path, content }) => Object.freeze({ path, content })),
  };
  Object.freeze(snapshot.files);
  let destination: CanvasPublishResult = {};
  try {
    validateCanvasPublish({ ...request, files: snapshot.files.map((file) => ({ ...file, language: '' })) });
    const [ownerInput, name] = snapshot.repository.trim().includes('/') ? snapshot.repository.trim().split('/') : ['', snapshot.repository.trim()];
    const owner = ownerInput || await operations.getLogin();
    if (!loginPattern.test(owner)) throw new Error('GitHub did not return a valid account name.');
    const repository = `${owner}/${name}`;
    const branch = snapshot.branch.trim();
    destination = { repository, branch };
    const pushArgs = Object.freeze({ owner, repo: name, branch, message: snapshot.message.trim(), files: snapshot.files, atomic: true });
    operations.check?.('github_push_files_batch', pushArgs);
    if (snapshot.createRepository) {
      const args = Object.freeze({
        name, expectedOwner: owner, description: snapshot.description, private: snapshot.privateRepository, autoInit: true,
      });
      if (!(await operations.approve('github_create_repo', args, `Create the ${snapshot.privateRepository ? 'private' : 'public'} repository ${repository}.`))) {
        return { ...destination, cancelled: true };
      }
      const result = await operations.call('github_create_repo', args);
      if (result.isError) throw new Error(result.text);
      destination.createdRepository = true;
      const created = JSON.parse(result.text) as { repo?: string };
      if (created.repo?.toLowerCase() !== repository.toLowerCase()) throw new Error('GitHub returned a different repository.');
    }
    if (!(await operations.approve('github_push_files_batch', pushArgs, `Publish ${snapshot.files.length} reviewed files to ${repository} on ${branch}.`))) {
      return { ...destination, cancelled: true };
    }
    const result = await operations.call('github_push_files_batch', pushArgs);
    if (result.isError) throw new Error(result.text);
    const { commitSha } = JSON.parse(result.text) as { commitSha?: string };
    if (!commitSha || !/^[\da-f]{40,64}$/i.test(commitSha)) throw new Error('GitHub did not return a commit SHA.');
    return { ...destination, commitUrl: `https://github.com/${repository}/commit/${commitSha}` };
  } catch (error) {
    return { ...destination, error: error instanceof Error ? error.message : 'Could not publish the Canvas revision.' };
  }
}
