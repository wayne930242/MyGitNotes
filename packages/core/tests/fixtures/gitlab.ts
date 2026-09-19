import { createHash } from 'node:crypto';

export function gitlabFixture(site = 'https://gitlab.example.test/gitlab') {
  const manifest = 'schema_version: 1\nworkspace:\n  title: Test\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n';
  const files = new Map<string, string>([['notes/.github-notes.yaml', manifest], ['notes/ex/a.md', '---\ncustom: preserved\ntags: [work]\n---\n# Alpha\n'], ['notes/ex/folder/_dir.yml', 'title: Folder\n'], ['notes/ex/folder/b.md', '# Beta\n'], ['notes/ex/assets/picture.png', 'image bytes'], ['.github-notes-screen.yaml', 'version: 1\nrows: []\n'], ['AGENTS.md', '# Workspace\n']]);
  const sha = (text: string) => createHash('sha1').update(text).digest('hex');
  let head = 'a'.repeat(40), writes = 0;
  let canPush = true, privateRepo = true, rejectCommit = false;
  const calls: { url: string; init?: RequestInit; }[] = [];
  const blobs = new Map<string, string>();
  const last = new Map([...files.keys()].map(file => [file, 'b'.repeat(40)]));
  const prefix = `${site}/api/v4/projects/group%2Fsubgroup%2Fproject`;
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (!url.startsWith(prefix)) throw new Error(`Unexpected fixture endpoint: ${url}`);
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    if (privateRepo && !auth) return json({}, 404);
    const endpoint = url.slice(prefix.length);
    if (!endpoint) return json({ visibility: privateRepo ? 'private' : 'public', default_branch: 'main' });
    if (endpoint.startsWith('/repository/branches/')) return json({ commit: { id: head }, can_push: Boolean(auth && canPush) });
    if (endpoint.startsWith('/repository/tree?')) {
      const entries: { path: string; id: string; type: string; mode: string; }[] = [], dirs = new Set<string>();
      for (const [path, content] of files) {
        const id = sha(content);
        blobs.set(id, content);
        entries.push({ path, id, type: 'blob', mode: path.endsWith('symlink.md') ? '120000' : '100644' });
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
      }
      entries.push(...[...dirs].map(path => ({ path, id: sha(path), type: 'tree', mode: '040000' })));
      const page = Number(new URL(url).searchParams.get('page'));
      return json(entries.slice((page - 1) * 100, page * 100), 200, { 'x-next-page': page * 100 < entries.length ? String(page + 1) : '' });
    }
    if (endpoint.startsWith('/repository/blobs/')) {
      const value = blobs.get(decodeURIComponent(endpoint.slice('/repository/blobs/'.length)));
      return value === undefined ? json({}, 404) : json({ encoding: 'base64', content: Buffer.from(value).toString('base64'), size: Buffer.byteLength(value) });
    }
    if (endpoint.startsWith('/repository/files/')) {
      const file = decodeURIComponent(endpoint.slice('/repository/files/'.length).split('?')[0]);
      return files.has(file) ? json({ blob_id: sha(files.get(file)!), last_commit_id: last.get(file) }) : json({}, 404);
    }
    if (endpoint === '/repository/commits' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (rejectCommit || !canPush || body.force !== false) return json({ message: 'File changed' }, 400);
      for (const action of body.actions) if (action.action !== 'create' && action.last_commit_id !== last.get(action.file_path)) return json({}, 400);
      head = sha(`commit-${++writes}`);
      for (const action of body.actions) {
        if (action.action === 'delete') files.delete(action.file_path);
        else files.set(action.file_path, Buffer.from(action.content, 'base64').toString('utf8'));
        last.set(action.file_path, head);
      }
      return json({ id: head, parent_ids: ['a'.repeat(40)] }, 201);
    }
    return json({}, 404);
  };
  return {
    files,
    calls,
    request: request as typeof fetch,
    get head() {
      return head;
    },
    get writes() {
      return writes;
    },
    setHead(value: string) {
      head = value;
    },
    public() {
      privateRepo = false;
    },
    readOnly() {
      canPush = false;
    },
    conflict() {
      rejectCommit = true;
    },
  };
}
