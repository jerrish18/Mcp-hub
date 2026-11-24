import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishCanvasRevision, validateCanvasPublish, type CanvasPublishRequest } from './canvasPublish';
import { handleGithubVirtualMcp } from './virtualConnectors';

const authored = '<h1>Résumé 🍃</h1>\r\n';
const sha = 'a'.repeat(40);
const makeRequest = (): CanvasPublishRequest => ({
  repository: 'sample-project', branch: 'release/1', message: 'Publish reviewed files',
  createRepository: true, privateRepository: true,
  files: [
    { path: 'index.html', content: authored, language: 'html' },
    { path: 'assets/names.txt', content: 'One\n', language: 'text' },
  ],
});

test('Canvas publishing freezes the exact files and does nothing when approval is declined', async () => {
  const request = makeRequest();
  const result = await publishCanvasRevision({ ...request, repository: 'account/project', createRepository: false }, {
    getLogin: async () => assert.fail('the owner was selected explicitly'),
    approve: async (tool, args) => {
      assert.equal(tool, 'github_push_files_batch');
      assert.equal(args.owner, 'account');
      assert.equal(args.branch, 'release/1');
      assert.equal(Object.isFrozen(args.files), true);
      request.files[0].content = 'later edit';
      assert.equal((args.files as typeof request.files)[0].content, authored);
      return false;
    },
    call: async () => assert.fail('a declined write must never be called'),
  });
  assert.equal(result.cancelled, true);
  assert.throws(() => validateCanvasPublish({ ...request, branch: 'bad..branch' }), /valid Git branch/);
  assert.throws(() => validateCanvasPublish({ ...request, files: [{ ...request.files[0], path: '../escape' }] }), /Invalid project file/);
});

test('failed publication can retry against the created repository with a fresh approval', async () => {
  const request = makeRequest();
  const calls: string[] = [];
  const approved: string[] = [];
  let fail = true;
  const operations = {
    getLogin: async () => 'owner',
    approve: async (tool: string) => { approved.push(tool); return true; },
    call: async (tool: string, args: Record<string, unknown>) => {
      calls.push(tool);
      if (tool === 'github_create_repo') {
        assert.equal(args.expectedOwner, 'owner');
        assert.equal(args.private, true);
        return { text: '{"repo":"owner/sample-project"}', isError: false };
      }
      assert.equal((args.files as typeof request.files)[0].content, authored);
      return fail ? { text: 'GitHub 409', isError: true } : { text: JSON.stringify({ commitSha: sha }), isError: false };
    },
  };
  const result = await publishCanvasRevision(request, operations);
  assert.equal(result.error, 'GitHub 409');
  assert.equal(result.createdRepository, true);
  fail = false;
  const retried = await publishCanvasRevision({ ...request, repository: result.repository!, createRepository: false }, operations);
  assert.equal(retried.commitUrl, `https://github.com/owner/sample-project/commit/${sha}`);
  assert.deepEqual(calls, ['github_create_repo', 'github_push_files_batch', 'github_push_files_batch']);
  assert.deepEqual(calls, approved);
});

test('GitHub creates a missing branch only after it builds one commit from the approved blobs', async () => {
  const request = makeRequest();
  const calls: Array<[string, string]> = [];
  const contents: string[] = [];
  let rejectBlob = true;
  const fetchFn: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    calls.push([method, path]);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith('/sample-project')) return Response.json({ default_branch: 'main' });
    if (path.endsWith('/git/ref/heads/release%2F1')) return new Response('', { status: 404 });
    if (path.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'base' } });
    if (path.endsWith('/git/commits/base')) return Response.json({ tree: { sha: 'base-tree' } });
    if (path.endsWith('/git/blobs')) {
      contents.push(body.content);
      return rejectBlob ? new Response('blob rejected', { status: 409 }) : Response.json({ sha: `blob-${contents.length}` });
    }
    if (path.endsWith('/git/trees')) {
      assert.equal(body.base_tree, 'base-tree');
      assert.deepEqual(body.tree.map((file: { path: string }) => file.path), request.files.map((file) => file.path));
      return Response.json({ sha: 'tree' });
    }
    if (path.endsWith('/git/commits')) {
      assert.deepEqual(body.parents, ['base']);
      return Response.json({ sha });
    }
    if (path.endsWith('/git/refs')) {
      assert.equal(method, 'POST');
      assert.deepEqual(body, { ref: 'refs/heads/release/1', sha });
      return Response.json({ object: { sha } });
    }
    return assert.fail(`Unexpected GitHub call ${method} ${path}`);
  };
  const send = () => handleGithubVirtualMcp({
    method: 'tools/call', secrets: { bearerToken: 'fixture-only' }, fetchFn,
    rpcParams: { name: 'github_push_files_batch', arguments: {
      owner: 'owner', repo: request.repository, branch: request.branch, files: request.files, atomic: true,
    } },
  });
  assert.match(JSON.stringify(await send()), /blob rejected/);
  assert.equal(calls.some(([, path]) => path.endsWith('/git/refs')), false);
  rejectBlob = false;
  contents.length = 0;
  const result = await send();
  assert.match(JSON.stringify(result), new RegExp(sha));
  assert.deepEqual(contents, request.files.map((file) => file.content));
  assert.deepEqual(calls.at(-1), ['POST', '/repos/owner/sample-project/git/refs']);
});
