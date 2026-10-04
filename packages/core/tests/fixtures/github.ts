import { expect } from 'vitest';
import { openRemoteHome } from '../../src/remote-factory.js';

/** An in-memory GitHub repository (one commit per write) behind a `fetch` stand-in; `extra` adds files to the starting tree. */
export function githubFixture(extra: Record<string, string> = {}) {
  const raw: Record<string, string> = { '.github-notes.yaml': 'schema_version: 1\nworkspace:\n  title: Shell QA\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n', 'notes/ex/a.md': '---\ncustom: retained\n---\n# Alpha\nhello world\n', 'notes/ex/work/_dir.yml': 'title: Work\n', 'notes/ex/work/b.md': '# Beta\nhello again\n', 'notes/ex/assets/private.txt': 'not a note', ...extra };
  const objects = new Map<string, string>();
  let files = new Map<string, string>();
  let counter = 0;
  let head = 'head0';
  let treeId = 'tree0';
  for (const [file, text] of Object.entries(raw)) {
    const id = 'blob' + counter++;
    objects.set(id, text);
    files.set(file, id);
  }
  const trees = new Map<string, Map<string, string>>([[treeId, new Map(files)]]);
  const commits = new Map<string, string>([[head, treeId]]);
  const calls: { endpoint: string; method?: string; body: any; }[] = [];
  const request: typeof fetch = async (input, init) => {
    // Batched blob reads are optional: a failing GraphQL endpoint makes the reader fall back to single blob reads.
    if (String(input).endsWith('/graphql')) return new Response('{}', { status: 500 });
    const endpoint = String(input).replace('https://api.github.com/repos/owner/repo', '');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ endpoint, method: init?.method, body });
    let result: any;
    if (!endpoint) result = { private: true, permissions: { push: true } };
    else if (endpoint.startsWith('/commits/')) {
      const ref = endpoint.slice('/commits/'.length);
      const sha = ref === 'main' ? head : ref;
      result = { sha, commit: { tree: { sha: commits.get(sha) } } };
    } else if (endpoint.startsWith('/git/trees/') && !init?.method) {
      const id = endpoint.slice('/git/trees/'.length).split('?')[0];
      const entries = [];
      const dirs = new Set<string>();
      for (const [file, sha] of trees.get(id)!) {
        const parts = file.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        entries.push({ path: file, sha, type: 'blob', mode: '100644', size: objects.get(sha)!.length });
      }
      result = { truncated: false, tree: [...entries, ...[...dirs].map(path => ({ path, sha: path, type: 'tree', mode: '040000' }))] };
    } else if (endpoint.startsWith('/git/blobs/') && !init?.method) result = { encoding: 'base64', content: Buffer.from(objects.get(endpoint.slice('/git/blobs/'.length))!).toString('base64') };
    else if (endpoint === '/git/blobs') {
      const sha = 'blob' + counter++;
      objects.set(sha, body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content);
      result = { sha };
    } else if (endpoint === '/git/trees') {
      const next = new Map(trees.get(body.base_tree));
      for (const change of body.tree) {
        if (change.sha === null) next.delete(change.path);
        else {
          let blob = change.sha;
          if (change.content !== undefined) {
            blob = 'blob' + counter++;
            objects.set(blob, change.content);
          }
          next.set(change.path, blob);
        }
      }
      const sha = 'tree' + counter++;
      trees.set(sha, next);
      result = { sha };
    } else if (endpoint === '/git/commits') {
      const sha = 'head' + counter++;
      commits.set(sha, body.tree);
      result = { sha };
    } else if (endpoint.startsWith('/git/refs/heads/')) {
      expect(body.force).toBe(false);
      head = body.sha;
      treeId = commits.get(head)!;
      files = new Map(trees.get(treeId));
      result = { object: { sha: head } };
    } else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(result));
  };
  return { reader: () => openRemoteHome({ type: 'github', repository: 'owner/repo', branch: 'main' }, 'test-token', request).reader, calls, head: () => head, text: (file: string) => objects.get(files.get(file)!), files: () => [...files.keys()] };
}
