import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { openRemoteHome } from '../../src/remote-factory.js';

/**
 * An in-memory GitHub repository (one commit per write) behind a `fetch` stand-in; `extra` adds files to the starting tree.
 * `hexIds` gives objects Git-shaped ids, which history and version records require.
 */
export function githubFixture(extra: Record<string, string> = {}, options: { hexIds?: boolean; } = {}) {
  const id = (prefix: string, n: number) => options.hexIds ? createHash('sha1').update(`${prefix}${n}`).digest('hex') : `${prefix}${n}`;
  const raw: Record<string, string> = { '.github-notes.yaml': 'schema_version: 1\nworkspace:\n  title: Shell QA\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n', 'notes/ex/a.md': '---\ncustom: retained\n---\n# Alpha\nhello world\n', 'notes/ex/work/_dir.yml': 'title: Work\n', 'notes/ex/work/b.md': '# Beta\nhello again\n', 'notes/ex/assets/private.txt': 'not a note', ...extra };
  const objects = new Map<string, string>();
  let files = new Map<string, string>();
  let counter = 0;
  let head = id('head', 0);
  let treeId = id('tree', 0);
  for (const [file, text] of Object.entries(raw)) {
    const blob = id('blob', counter++);
    objects.set(blob, text);
    files.set(file, blob);
  }
  const trees = new Map<string, Map<string, string>>([[treeId, new Map(files)]]);
  const commits = new Map<string, string>([[head, treeId]]);
  const parents = new Map<string, string[]>();
  const messages = new Map<string, { message: string; date: string; }>([[head, { message: 'Start', date: '2026-01-01T00:00:00Z' }]]);
  /** The files whose blob differs between a commit and its first parent. */
  const changed = (sha: string) => {
    const tree = trees.get(commits.get(sha)!)!, parent = parents.get(sha)?.[0], before = parent ? trees.get(commits.get(parent)!)! : new Map<string, string>();
    return [...new Set([...tree.keys(), ...before.keys()])].filter(file => tree.get(file) !== before.get(file)).map(file => ({ filename: file, status: tree.has(file) ? before.has(file) ? 'modified' : 'added' : 'removed' }));
  };
  const listed = (sha: string) => ({ sha, parents: (parents.get(sha) ?? []).map(parent => ({ sha: parent })), commit: { tree: { sha: commits.get(sha) }, message: messages.get(sha)?.message ?? '', author: { name: 'Tester', date: messages.get(sha)?.date ?? '2026-01-01T00:00:00Z' } } });
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
      if (!commits.has(sha)) return new Response('{}', { status: 404 });
      result = { ...listed(sha), files: changed(sha) };
    } else if (endpoint.startsWith('/commits?')) {
      // A file's history from a commit along first parents: the commits that changed it.
      const query = new URL(`https://api.github.com${endpoint}`).searchParams;
      const file = query.get('path')!, perPage = Number(query.get('per_page')), page = Number(query.get('page'));
      const all: string[] = [];
      for (let sha: string | undefined = query.get('sha')!; sha; sha = parents.get(sha)?.[0]) if (changed(sha).some(entry => entry.filename === file)) all.push(sha);
      result = all.slice((page - 1) * perPage, page * perPage).map(listed);
    } else if (endpoint.startsWith('/contents/')) {
      const url = new URL(`https://api.github.com${endpoint}`);
      const file = decodeURIComponent(url.pathname.slice('/contents/'.length));
      const blob = trees.get(commits.get(url.searchParams.get('ref')!)!)?.get(file);
      if (!blob) return new Response('{}', { status: 404 });
      result = { type: 'file', sha: blob, size: objects.get(blob)!.length };
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
      const sha = id('blob', counter++);
      objects.set(sha, body.encoding === 'base64' ? Buffer.from(body.content, 'base64').toString('utf8') : body.content);
      result = { sha };
    } else if (endpoint === '/git/trees') {
      const next = new Map(trees.get(body.base_tree));
      for (const change of body.tree) {
        if (change.sha === null) next.delete(change.path);
        else {
          let blob = change.sha;
          if (change.content !== undefined) {
            blob = id('blob', counter++);
            objects.set(blob, change.content);
          }
          next.set(change.path, blob);
        }
      }
      const sha = id('tree', counter++);
      trees.set(sha, next);
      result = { sha };
    } else if (endpoint === '/git/commits') {
      const sha = id('head', counter++);
      commits.set(sha, body.tree);
      parents.set(sha, body.parents);
      messages.set(sha, { message: body.message, date: new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString() });
      result = { sha };
    } else if (endpoint.startsWith('/git/refs/heads/')) {
      expect(body.force).toBe(false);
      if (!parents.get(body.sha)?.includes(head)) return new Response(JSON.stringify({ message: 'Update is not a fast forward' }), { status: 422 });
      head = body.sha;
      treeId = commits.get(head)!;
      files = new Map(trees.get(treeId));
      result = { object: { sha: head } };
    } else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(result));
  };
  return { request, reader: () => openRemoteHome({ type: 'github', repository: 'owner/repo', branch: 'main' }, 'test-token', request).reader, calls, head: () => head, text: (file: string) => objects.get(files.get(file)!), files: () => [...files.keys()], message: (sha: string) => messages.get(sha)?.message };
}
