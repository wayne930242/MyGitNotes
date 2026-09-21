import { describe, expect, it, vi } from 'vitest';
import { GitHubSource } from '../src/github-source.js';
import { callNoteShell, matchNoteGlob, replaceNoteLines } from '../src/note-shell.js';
import { agentSystemHint, callAgentSystem } from '../src/agent-system.js';
import { SCREEN_PAGE_FILE } from '../src/screen-page.js';
import { FOCUS_PAGE_FILE } from '../src/focus-page.js';

vi.setConfig({ testTimeout: 30000 }); // Real GitHub write pacing applies to multi-commit scenarios too.

function fixture(extra: Record<string, string> = {}) {
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
  return { reader: () => new GitHubSource('owner/repo', 'main', 'test-token', request), calls, head: () => head, text: (file: string) => objects.get(files.get(file)!), files: () => [...files.keys()] };
}

describe('shell-shaped note operations', () => {
  it('commits Screen and selected notes together, while rejecting a stale Screen base', async () => {
    const f = fixture();
    const base = { version: 2, rows: [] };
    const page = { version: 2, rows: [{ id: 'reading', kind: 'custom', name: 'Reading', view: 'small', notebookId: 'ex', items: [] }] };
    await f.reader().commitNotes([{ path: 'notes/ex/a.md', content: '# Updated', metadata: {} }], f.head(), 'Update reading workspace', [{ path: SCREEN_PAGE_FILE, page, base }]);
    expect(f.text('.github-notes-screen.yaml')).toContain('name: Reading');
    expect(f.text('notes/ex/a.md')).toContain('# Updated');
    expect(f.calls.filter(call => call.endpoint === '/git/commits')).toHaveLength(1);
    await expect(f.reader().commitNotes([], f.head(), 'Stale screen', [{ path: SCREEN_PAGE_FILE, page: base, base }])).rejects.toMatchObject({ status: 409 });
    expect(f.calls.filter(call => call.endpoint === '/git/commits')).toHaveLength(1);
    await f.reader().commitNotes([], f.head(), 'Clear screen', [{ path: SCREEN_PAGE_FILE, page: base, base: page }]);
    expect(f.text('.github-notes-screen.yaml')).toContain('rows: []');
    expect(f.calls.filter(call => call.endpoint === '/git/commits')).toHaveLength(2);
    const foreign = { version: 2, rows: [{ ...page.rows[0], items: [{ id: 'x', kind: 'note', notebookId: 'other', path: 'notes/other/x.md' }] }] };
    await expect(f.reader().commitNotes([], f.head(), 'Foreign item', [{ path: SCREEN_PAGE_FILE, page: foreign, base }])).rejects.toThrow('Invalid Screen configuration.');
  });
  it('commits Screen and Focus drafts in one commit and rejects a path outside the registry', async () => {
    const f = fixture();
    const screen = { version: 2, rows: [{ id: 'reading', kind: 'custom', name: 'Reading', view: 'small', notebookId: 'ex', items: [] }] };
    const focus = { version: 1, focuses: [{ id: 'weekly', notebookId: 'ex', name: 'Weekly', division: 'columns-2', panes: [{ tabs: [{ kind: 'note', path: 'notes/ex/a.md' }] }, { tabs: [{ kind: 'lane', id: 'reading' }] }] }] };
    await f.reader().commitNotes([], f.head(), 'Save layouts', [{ path: SCREEN_PAGE_FILE, page: screen, base: { version: 2, rows: [] } }, { path: FOCUS_PAGE_FILE, page: focus, base: { version: 1, focuses: [] } }]);
    expect(f.text(FOCUS_PAGE_FILE)).toContain('name: Weekly');
    expect(f.text(SCREEN_PAGE_FILE)).toContain('name: Reading');
    expect(f.calls.filter(call => call.endpoint === '/git/commits')).toHaveLength(1);
    await expect(f.reader().commitNotes([], f.head(), 'Stale focus', [{ path: FOCUS_PAGE_FILE, page: focus, base: { version: 1, focuses: [] } }])).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([], f.head(), 'Escape', [{ path: '.github-notes.yaml', page: {}, base: {} }])).rejects.toMatchObject({ status: 403 });
  });
  it('compares a Screen draft against the migrated version 1 file', async () => {
    const f = fixture({ '.github-notes-screen.yaml': 'version: 1\nrows:\n  - id: reading\n    name: Reading\n    view: small\n    kind: custom\n    items: []\n' });
    const base = { version: 2, rows: [{ id: 'reading', kind: 'custom', name: 'Reading', view: 'small', notebookId: 'ex', items: [] }] };
    await f.reader().commitNotes([], f.head(), 'Rename lane', [{ path: SCREEN_PAGE_FILE, page: { version: 2, rows: [{ ...base.rows[0], name: 'Later' }] }, base }]);
    expect(f.text('.github-notes-screen.yaml')).toContain('version: 2');
    expect(f.text('.github-notes-screen.yaml')).toContain('notebookId: ex');
  });
  it('commits selected browser notes atomically and rejects invalid batches before writing', async () => {
    const f = fixture();
    const baseline = f.head();
    const result = await f.reader().commitNotes([{ path: 'notes/ex/a.md', content: '# Alpha changed\n', metadata: { custom: 'retained', status: 'working' } }, { path: 'notes/ex/new.md', content: '# New\n', metadata: { status: 'inbox' }, createOnly: true }], baseline, 'docs(notes): review two notes');
    expect(result.commit.message).toBe('docs(notes): review two notes');
    expect(f.text('notes/ex/a.md')).toContain('custom: retained');
    expect(f.text('notes/ex/new.md')).toContain('# New');
    expect(f.calls.filter(call => call.endpoint === '/git/commits')).toHaveLength(1);
    expect(f.calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
    const writes = () => f.calls.filter(call => call.method).length;
    const before = writes();
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'stale', metadata: {} }], baseline, 'stale')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'collision', metadata: {}, createOnly: true }], f.head(), 'collision')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/missing.md', content: 'lost', metadata: {} }], f.head(), 'missing')).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'valid', metadata: {} }, { path: 'notes/ex/../../.env', content: 'bad', metadata: {}, createOnly: true }], f.head(), 'bad')).rejects.toThrow();
    expect(writes()).toBe(before);
  });
  it('uploads, moves and deletes remote assets with stable references and one commit per operation', async () => {
    const f = fixture();
    const upload = await f.reader().mutateAsset('upload', { notebookId: 'ex', filename: 'new.txt', directory: 'images', base64Content: Buffer.from('original bytes').toString('base64'), revision: f.head() });
    expect(f.text(upload.path)).toBe('original bytes');
    const asset = (await f.reader().assets('ex')).find(a => a.path === upload.path)!;
    const moved = await f.reader().mutateAsset('move', { path: upload.path, directory: 'archive', revision: f.head() });
    expect(f.text(moved.path)).toBe('original bytes');
    expect((await f.reader().assets('ex')).find(a => a.path === moved.path)?.rawUrl).toBe(asset.rawUrl);
    await expect(f.reader().mutateAsset('delete', { path: moved.path, revision: 'head0' })).rejects.toMatchObject({ status: 409 });
    await expect(f.reader().mutateAsset('delete', { path: 'notes/ex/a.md', revision: f.head() })).rejects.toMatchObject({ status: 403 });
    await f.reader().mutateAsset('delete', { path: moved.path, revision: f.head() });
    expect(f.files()).not.toContain(moved.path);
    expect(f.calls.filter(c => c.endpoint === '/git/commits')).toHaveLength(3);
    expect(f.calls.filter(c => c.method === 'PATCH')).toHaveLength(3);
  });
  it('lists, globs, reads raw line ranges and finds bounded literal matches', async () => {
    const f = fixture();
    const ls = await callNoteShell(f.reader(), 'ls', {}, false);
    expect(ls.entries).toEqual([{ path: 'notes/ex', type: 'directory' }]);
    const glob = await callNoteShell(f.reader(), 'glob', { pattern: 'notes/ex/**/*.{md,txt}', limit: 1 }, false);
    expect(glob.paths).toEqual(['notes/ex/a.md']);
    expect(glob.total).toBe(2);
    expect(glob.nextOffset).toBe(1);
    const read = await callNoteShell(f.reader(), 'read', { path: 'notes/ex/a.md', startLine: 2, maxLines: 3 }, false);
    expect(read.content).toBe('custom: retained\n---\n# Alpha\n');
    expect(read.nextLine).toBe(5);
    const found = await callNoteShell(f.reader(), 'find', { query: 'HELLO', pattern: '**/*.md' }, false);
    expect(found.matches).toEqual([{ path: 'notes/ex/a.md', line: 5, text: 'hello world' }, { path: 'notes/ex/work/b.md', line: 2, text: 'hello again' }]);
    expect(f.calls.some(c => c.method)).toBe(false);
  });
  it('edits exact raw lines, preserves frontmatter and returns a generated remote commit receipt', async () => {
    const f = fixture();
    const result: any = await callNoteShell(f.reader(), 'edit', { path: 'notes/ex/a.md', startLine: 5, endLine: 5, content: 'changed', revision: f.head() }, true);
    expect(f.text('notes/ex/a.md')).toBe('---\ncustom: retained\n---\n# Alpha\nchanged\n');
    expect(result.pushed).toBe(true);
    expect(result.commit.message).toBe('docs(notes): edit a.md');
    expect(result.revision).toBe(f.head());
    expect(f.calls.filter(c => c.endpoint === '/git/commits')).toHaveLength(1);
    expect(f.calls.filter(c => c.method === 'PATCH')).toHaveLength(1);
    await expect(callNoteShell(f.reader(), 'write', { path: 'notes/ex/a.md', content: 'stale', revision: 'head0' }, true)).rejects.toMatchObject({ status: 409 });
    expect(f.calls.filter(c => c.endpoint === '/git/commits')).toHaveLength(1);
  });
  it('copies, moves, removes directories atomically and creates persistent folder metadata', async () => {
    const f = fixture();
    await callNoteShell(f.reader(), 'cp', { source: 'notes/ex/work', destination: 'notes/ex/copied', recursive: true, revision: f.head() }, true);
    expect(f.text('notes/ex/copied/b.md')).toBe(f.text('notes/ex/work/b.md'));
    await callNoteShell(f.reader(), 'mv', { source: 'notes/ex/copied', destination: 'notes/ex/moved', recursive: true, revision: f.head() }, true);
    expect(f.files()).not.toContain('notes/ex/copied/b.md');
    expect(f.files()).toContain('notes/ex/moved/_dir.yml');
    await callNoteShell(f.reader(), 'rm', { paths: ['notes/ex/moved'], recursive: true, revision: f.head() }, true);
    expect(f.files().some(p => p.startsWith('notes/ex/moved/'))).toBe(false);
    await callNoteShell(f.reader(), 'mkdir', { path: 'notes/ex/new/deep', title: 'Deep', order: 3, description: 'Deep notes', revision: f.head() }, true);
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('title: Deep');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('order: 3');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('description: Deep notes');
    await callNoteShell(f.reader(), 'update_folder_metadata', { path: 'notes/ex/new/deep', order: 5, description: 'Updated deep notes', revision: f.head() }, true);
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('title: Deep');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('order: 5');
    expect(f.text('notes/ex/new/deep/_dir.yml')).toContain('description: Updated deep notes');
    expect(f.calls.filter(c => c.endpoint === '/git/commits')).toHaveLength(5);
    expect(f.calls.filter(c => c.method === 'PATCH')).toHaveLength(5);
    const move = f.calls.filter(c => c.endpoint === '/git/trees' && c.method)[1];
    expect(move.body.tree).toHaveLength(4);
    expect(move.body.tree.filter((c: any) => c.sha === null)).toHaveLength(2);
  });
  it('appends and creates notes with one commit each', async () => {
    const f = fixture();
    await callNoteShell(f.reader(), 'write', { path: 'notes/ex/new.md', content: '# New\n', createOnly: true, revision: f.head() }, true);
    await callNoteShell(f.reader(), 'append', { path: 'notes/ex/new.md', content: 'next\n', revision: f.head() }, true);
    expect(f.text('notes/ex/new.md')).toBe('# New\nnext\n');
    await expect(callNoteShell(f.reader(), 'write', { path: 'notes/ex/new.md', content: 'bad', createOnly: true, revision: f.head() }, true)).rejects.toMatchObject({ status: 409 });
    expect(f.calls.filter(c => c.endpoint === '/git/commits')).toHaveLength(2);
  });
  it('rejects readonly writes, traversal, protected roots, recursive ambiguity and destination collisions', async () => {
    const f = fixture();
    await expect(callNoteShell(f.reader(), 'rm', { paths: ['notes/ex/a.md'], revision: f.head() }, false)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(f.reader(), 'read', { path: '../.env' }, false)).rejects.toThrow(/relative/);
    await expect(callNoteShell(f.reader(), 'rm', { paths: ['notes/ex'], recursive: true, revision: f.head() }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(f.reader(), 'mv', { source: 'notes/ex/work', destination: 'notes/ex/other', revision: f.head() }, true)).rejects.toThrow(/recursive/);
    await expect(callNoteShell(f.reader(), 'cp', { source: 'notes/ex/a.md', destination: 'notes/ex/work/b.md', revision: f.head() }, true)).rejects.toMatchObject({ status: 409 });
    expect(f.calls.some(c => c.method)).toBe(false);
  });
  it('supports insertion and deletion with preserved CRLF and rejects invalid line ranges', () => {
    expect(replaceNoteLines('a\r\nb\r\n', 2, 1, 'new')).toBe('a\r\nnew\r\nb\r\n');
    expect(replaceNoteLines('a\nb\nc', 2, 2, '')).toBe('a\nc');
    expect(() => replaceNoteLines('a', 3, 3, 'x')).toThrow(/line range/);
    expect(() => matchNoteGlob('../*')).toThrow(/relative glob/);
  });
});

describe('agent system over the note tree', () => {
  const agentFiles = { 'AGENTS.md': '# Root\n', 'notes/AGENTS.md': '# Notes\n', 'notes/ex/AGENTS.md': '# Example\n', 'notes/ex/work/AGENTS.md': '# Work\n', '.agents/skills/shared/SKILL.md': '---\nname: shared\ndescription: Root shared\n---\n# Root shared\n', '.agents/skills/solo/SKILL.md': '---\ndescription: Solo\n---\nSolo body\n', '.agents/skills/empty/references/x.md': 'no entry file', 'notes/.agents/skills/shared/SKILL.md': '---\ndescription: Notes shared\n---\n# Notes shared body\n', 'notes/.agents/skills/shared/references/guide.md': 'guide', 'notes/.agents/skills/shared/agents/openai.yaml': 'interface: {}\n', 'notes/.agents/skills/shared/scripts/run.py': 'print(1)\n', '.claude/skills/claude-only/SKILL.md': '---\ndescription: Claude copy\n---\n', 'tools/.agents/skills/unrelated/SKILL.md': '---\ndescription: Unrelated\n---\n' };
  it('reads the AGENTS.md chain of a notebook, a note folder and a note that does not exist yet', async () => {
    const f = fixture(agentFiles);
    const notebook: any = await callAgentSystem(f.reader(), 'get_system_prompt', { notebookId: 'ex' });
    expect(notebook).toMatchObject({ revision: 'head0', target: 'notes/ex', content: '# Root\n\n# Notes\n\n# Example' });
    expect(notebook.files.map((file: any) => file.path)).toEqual(['AGENTS.md', 'notes/AGENTS.md', 'notes/ex/AGENTS.md']);
    const note: any = await callAgentSystem(f.reader(), 'get_system_prompt', { path: 'notes/ex/work/b.md' });
    expect(note.files.map((file: any) => file.path)).toEqual(['AGENTS.md', 'notes/AGENTS.md', 'notes/ex/AGENTS.md', 'notes/ex/work/AGENTS.md']);
    expect(await callAgentSystem(f.reader(), 'get_system_prompt', { path: 'notes/ex/work' })).toMatchObject({ target: 'notes/ex/work' });
    expect(await callAgentSystem(f.reader(), 'get_system_prompt', { path: 'notes/ex/work/' })).toMatchObject({ target: 'notes/ex/work' });
    expect(await callAgentSystem(f.reader(), 'get_system_prompt', { path: 'notes/ex/later.md' })).toMatchObject({ target: 'notes/ex' });
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', { path: 'notes/ex//work' })).rejects.toThrow(/traversal/);
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', { path: '/' })).rejects.toThrow(/traversal/);
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', { notebookId: 'ex', path: 'notes/ex/a.md' })).rejects.toThrow(/not both/);
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', { notebookId: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', { path: 'tools/x.md' })).rejects.toMatchObject({ status: 403 });
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', { path: 'notes/ex/../../x.md' })).rejects.toThrow(/traversal/);
    await expect(callAgentSystem(f.reader(), 'get_system_prompt', {})).rejects.toThrow(/notebookId or path/);
  });
  it('lists the nearest skills for a target and every allowed skill without one', async () => {
    const f = fixture(agentFiles);
    const scoped: any = await callAgentSystem(f.reader(), 'list_skills', { notebookId: 'ex' });
    expect(scoped.skills).toEqual([{ name: 'shared', description: 'Notes shared', path: 'notes/.agents/skills/shared/SKILL.md', directory: 'notes/.agents/skills/shared' }, { name: 'solo', description: 'Solo', path: '.agents/skills/solo/SKILL.md', directory: '.agents/skills/solo' }]);
    const all: any = await callAgentSystem(f.reader(), 'list_skills', {});
    expect(all.target).toBeNull();
    expect(all.skills.map((skill: any) => skill.path)).toEqual(['.agents/skills/shared/SKILL.md', '.agents/skills/solo/SKILL.md', 'notes/.agents/skills/shared/SKILL.md']);
  });
  it('invokes the nearest skill with its body and readable supporting files', async () => {
    const f = fixture(agentFiles);
    expect(await callAgentSystem(f.reader(), 'invoke_skill', { name: 'shared', path: 'notes/ex/a.md' })).toEqual({ revision: 'head0', name: 'shared', description: 'Notes shared', path: 'notes/.agents/skills/shared/SKILL.md', directory: 'notes/.agents/skills/shared', content: '# Notes shared body\n', files: ['notes/.agents/skills/shared/agents/openai.yaml', 'notes/.agents/skills/shared/references/guide.md'] });
    expect(await callAgentSystem(f.reader(), 'invoke_skill', { name: 'solo' })).toMatchObject({ content: 'Solo body\n', files: [] });
    await expect(callAgentSystem(f.reader(), 'invoke_skill', { name: 'shared' })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('.agents/skills/shared, notes/.agents/skills/shared') });
    await expect(callAgentSystem(f.reader(), 'invoke_skill', { name: 'empty' })).rejects.toMatchObject({ status: 404 });
    await expect(callAgentSystem(f.reader(), 'invoke_skill', { name: 'claude-only' })).rejects.toMatchObject({ status: 404 });
    await expect(callAgentSystem(f.reader(), 'invoke_skill', { name: 'unrelated' })).rejects.toMatchObject({ status: 404 });
  });
  it('creates, edits and removes skill files through the note shell with skills commits', async () => {
    const f = fixture(agentFiles);
    const created: any = await callNoteShell(f.reader(), 'write', { path: 'notes/ex/.agents/skills/local/SKILL.md', content: '---\ndescription: Local\n---\nLocal body\n', createOnly: true, revision: f.head() }, true);
    expect(created.commit.message).toBe('docs(skills): write SKILL.md');
    expect(await callAgentSystem(f.reader(), 'invoke_skill', { name: 'local', notebookId: 'ex' })).toMatchObject({ directory: 'notes/ex/.agents/skills/local', content: 'Local body\n' });
    const read: any = await callNoteShell(f.reader(), 'read', { path: 'notes/.agents/skills/shared/SKILL.md', startLine: 4 }, false);
    expect(read.content).toBe('# Notes shared body\n');
    await callNoteShell(f.reader(), 'edit', { path: 'notes/.agents/skills/shared/SKILL.md', startLine: 4, endLine: 4, content: '# Edited', revision: f.head() }, true);
    await callNoteShell(f.reader(), 'append', { path: 'notes/.agents/skills/shared/references/guide.md', content: '\nmore', revision: f.head() }, true);
    expect(f.text('notes/.agents/skills/shared/SKILL.md')).toContain('# Edited\n');
    expect(f.text('notes/.agents/skills/shared/references/guide.md')).toBe('guide\nmore');
    await callNoteShell(f.reader(), 'rm', { paths: ['notes/ex/.agents/skills/local'], recursive: true, revision: f.head() }, true);
    expect(f.files()).not.toContain('notes/ex/.agents/skills/local/SKILL.md');
    expect(f.calls.filter(c => c.endpoint === '/git/commits').map(c => c.body.message)).toEqual(['docs(skills): write SKILL.md', 'docs(skills): edit SKILL.md', 'docs(skills): append guide.md', 'docs(skills): rm SKILL.md']);
  });
  it('rejects skill writes outside allowed skill files, mixed removals and read-only grants', async () => {
    const f = fixture(agentFiles);
    const write = (file: string) => callNoteShell(f.reader(), 'write', { path: file, content: 'x', revision: f.head() }, true);
    await expect(write('.claude/skills/claude-only/SKILL.md')).rejects.toMatchObject({ status: 403 });
    await expect(write('tools/.agents/skills/unrelated/SKILL.md')).rejects.toMatchObject({ status: 403 });
    await expect(write('notes/.agents/skills/shared/scripts/run.py')).rejects.toMatchObject({ status: 403 });
    await expect(write('notes/.agents/skills/shared/.hidden/x.md')).rejects.toMatchObject({ status: 403 });
    await expect(write('notes/ex/assets/.agents/skills/x/SKILL.md')).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(f.reader(), 'rm', { paths: ['notes/.agents/skills/shared'], recursive: true, revision: f.head() }, true)).rejects.toMatchObject({ status: 403 });
    await expect(callNoteShell(f.reader(), 'rm', { paths: ['notes/ex/a.md', '.agents/skills/solo/SKILL.md'], revision: f.head() }, true)).rejects.toThrow(/separate calls/);
    await expect(callNoteShell(f.reader(), 'write', { path: '.agents/skills/solo/SKILL.md', content: 'x', revision: f.head() }, false)).rejects.toMatchObject({ status: 403 });
    await expect(f.reader().commitChanges([{ path: 'notes/ex/a.md', content: 'x' }], f.head(), 'write', 'skills')).rejects.toMatchObject({ status: 403 });
    expect(f.calls.some(c => c.method)).toBe(false);
  });
  it('hints at the agent system only when a note has one', async () => {
    expect(await agentSystemHint(fixture(agentFiles).reader(), 'notes/ex/a.md')).toBe('Before creating or editing notes here, read the agent system: call get_system_prompt and list_skills with path "notes/ex/a.md".');
    expect(await agentSystemHint(fixture({ 'notes/.agents/skills/solo/SKILL.md': '---\ndescription: Solo\n---\n' }).reader(), 'notes/ex/a.md')).toContain('get_system_prompt');
    expect(await agentSystemHint(fixture().reader(), 'notes/ex/a.md')).toBeUndefined();
  });
});
