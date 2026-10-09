import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { BOOKMARKS_FILE, deriveAlias, notebookKey, repositoryRef, serializeWorkspaceDocument, type WorkspaceConfigSource } from '@mygitnotes/core';
import { createApp } from '../src/app.js';

/** A worktree on main with the given files committed. */
function worktree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-notebook-repos-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  git('add', '.');
  git('commit', '-m', 'fixture');
  return root;
}

const manifest = `schema_version: 3
workspace:
  title: Two repositories
  default_notebook: life
notebooks:
  - id: life
    title: Life
    root: notes/life
  - id: trpg
    title: TRPG
    root: notes/life
    source: { type: github, repository: owner/trpg }
  - id: lost
    title: Lost
    root: notes/lost
    source: { type: github, repository: owner/lost }
`;

let roots: string[] = [];
/** The home worktree's alias, its directory's name; the notebook repositories are named `trpg` and `lost` after their repositories. */
let homeAlias = '';
const nb = (id: string) => notebookKey(homeAlias, id);
let server: Server;
let base: string;
beforeEach(() => {
  vi.stubEnv('APP_URL', '');
  vi.stubEnv('VERCEL', '');
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots = [];
  vi.unstubAllEnvs();
});

async function serve() {
  const home = worktree({ '.mygitnotes.yaml': manifest, 'notes/life/note.md': '# Home note\n' });
  const trpg = worktree({ 'notes/life/note.md': '# TRPG note\n' });
  roots = [home, trpg];
  homeAlias = deriveAlias(home, new Set());
  const configSource: WorkspaceConfigSource = { mode: 'local', settings: async () => ({ home: repositoryRef({ type: 'local', path: home }), localPath: ref => ref.id === 'github:owner/trpg@main' ? trpg : undefined, manifest: inHomeRepository => inHomeRepository() }) };
  server = createServer(createApp(home, { configSource }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number; }).port}`;
  return { home, trpg };
}
const get = (url: string) => fetch(`${base}${url}`).then(async response => ({ status: response.status, body: await response.json() }));

describe('notebooks in their own local repositories', () => {
  it('lists each repository, reports an unmapped one and keeps same-path notes apart', async () => {
    await serve();
    const workspace = (await get('/api/workspace')).body;
    expect(workspace.repositories.map((repository: { id: string; notebooks: string[]; }) => [repository.notebooks, repository.id.startsWith('local:') ? 'home' : repository.id])).toEqual([[[nb('life')], 'home'], [['trpg~trpg'], 'github:owner/trpg@main'], [['lost~lost'], 'github:owner/lost@main']]);
    expect(workspace.repositories[1]).toMatchObject({ repository: 'owner/trpg', branch: 'main', write: true });
    expect(workspace.repositories[2]).toMatchObject({ write: false, unavailable: { reason: 'unmapped' } });
    expect((await get(`/api/notes/read?path=notes/life/note.md&notebookId=${nb('life')}`)).body.note.content).toContain('Home note');
    expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=trpg~trpg')).body.note.content).toContain('TRPG note');
    expect((await get('/api/notes/read?path=notes/life/note.md')).status).toBe(400);
    const lost = await get('/api/notes/read?path=notes/lost/note.md&notebookId=lost~lost');
    expect(lost.status).toBe(503);
    expect(lost.body.error).toMatch(/^Lost: No worktree is mapped/);
    const all = (await get('/api/notes/query?notebookId=all&limit=10')).body;
    expect(all.notes.map((note: { notebookId: string; path: string; }) => `${note.notebookId}:${note.path}`).sort()).toEqual([`${nb('life')}:notes/life/note.md`, 'trpg~trpg:notes/life/note.md']);
  });

  it('writes and commits a note in its notebook repository only', async () => {
    const { home, trpg } = await serve();
    const saved = await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId: 'trpg~trpg', path: 'notes/life/new.md', content: '# New', metadata: { title: 'New' }, commitMessage: 'docs: add new' }) });
    expect(saved.status).toBe(200);
    expect(fs.existsSync(path.join(trpg, 'notes/life/new.md'))).toBe(true);
    expect(fs.existsSync(path.join(home, 'notes/life/new.md'))).toBe(false);
    expect(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: trpg, encoding: 'utf8' }).trim()).toBe('docs: add new');
    expect(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: home, encoding: 'utf8' }).trim()).toBe('fixture');
  });
});

describe("each repository's own manifest", () => {
  const trpgId = 'github:owner/trpg@main';
  const trpgManifest = (title: string, defaultNotebook = 'trpg', extra = '') => `schema_version: 3\nworkspace:\n  title: ${title}\n  default_notebook: ${defaultNotebook}\nnotebooks:\n  - id: trpg\n    title: TRPG\n    root: notes/life\n${extra}`;
  const put = (repository: string, configYaml: string, configRevision: string) => fetch(`${base}/api/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, configYaml, configRevision }) }).then(async response => ({ status: response.status, body: await response.json() }));
  const repository = async (id: string) => (await get('/api/workspace')).body.repositories.find((candidate: { id: string; }) => candidate.id === id);
  const log = (root: string) => execFileSync('git', ['log', '--format=%s'], { cwd: root, encoding: 'utf8' }).trim().split('\n');

  it('reports the title, default, preferences and revision of every repository', async () => {
    await serve();
    const [home, trpg, lost] = (await get('/api/workspace')).body.repositories;
    expect(home).toMatchObject({ title: 'Two repositories', defaultNotebook: nb('life'), preferences: { defaultShowLineNumbers: false }, config: { workspace: { title: 'Two repositories' } } });
    expect(home.configRevision).toMatch(/^sha256:/);
    // A repository without a manifest is named after itself and would create one with the notebooks it serves.
    expect(trpg).toMatchObject({ title: 'trpg', defaultNotebook: 'trpg~trpg', manifest: 'derived', configRevision: 'none', config: { workspace: { title: 'trpg', default_notebook: 'trpg' }, notebooks: [{ id: 'trpg', root: 'notes/life' }] } });
    expect(trpg.config.notebooks[0]).not.toHaveProperty('source');
    expect(lost).toMatchObject({ title: 'lost', defaultNotebook: 'lost~lost', config: null, configRevision: '', unavailable: { reason: 'unmapped' } });
  });

  it('commits a manifest to the repository it names, and refuses a revision that repository no longer has', async () => {
    const { home, trpg } = await serve();
    const created = await put(trpgId, trpgManifest('Campaign', 'trpg', 'preferences:\n  defaultShowLineNumbers: true\n'), 'none');
    expect(created.status).toBe(200);
    expect(fs.readFileSync(path.join(trpg, '.mygitnotes.yaml'), 'utf8')).toContain('title: Campaign');
    expect(log(trpg)[0]).toBe('chore(workspace): update configuration');
    expect(log(home)).toEqual(['fixture']);
    expect(await repository(trpgId)).toMatchObject({ title: 'Campaign', configRevision: created.body.configRevision, preferences: { defaultShowLineNumbers: true } });
    expect((await get('/api/workspace')).body.repositories[0]).toMatchObject({ title: 'Two repositories', preferences: { defaultShowLineNumbers: false } });

    // A save from before the file existed, or from an older text, is refused and leaves the file as it is.
    const stale = await put(trpgId, trpgManifest('Mine'), 'none');
    expect(stale.status).toBe(409);
    expect(fs.readFileSync(path.join(trpg, '.mygitnotes.yaml'), 'utf8')).toContain('title: Campaign');
    expect(log(trpg)).toHaveLength(2);
    expect((await put(trpgId, trpgManifest('Mine'), '')).status).toBe(409);
  });

  it('checks each repository against its own revision only', async () => {
    const { home, trpg } = await serve();
    const before = await repository(trpgId);
    const homeRevision = (await get('/api/workspace')).body.repositories[0].configRevision;
    // The home manifest changes elsewhere: its save is refused, the other repository's is not.
    fs.writeFileSync(path.join(home, '.mygitnotes.yaml'), manifest.replace('title: Two repositories', 'title: Edited elsewhere'));
    expect((await put((await get('/api/workspace')).body.home, manifest, homeRevision)).status).toBe(409);
    expect(fs.readFileSync(path.join(home, '.mygitnotes.yaml'), 'utf8')).toContain('Edited elsewhere');
    expect((await put(trpgId, trpgManifest('Campaign'), before.configRevision)).status).toBe(200);
    expect(fs.readFileSync(path.join(trpg, '.mygitnotes.yaml'), 'utf8')).toContain('title: Campaign');
  });

  it("opens at the repository's first notebook when its default names one it does not serve", async () => {
    const { trpg } = await serve();
    fs.writeFileSync(path.join(trpg, '.mygitnotes.yaml'), 'schema_version: 3\nworkspace:\n  title: Campaign\n  default_notebook: elsewhere\nnotebooks:\n  - id: elsewhere\n    title: Elsewhere\n    root: other\n');
    expect(await repository(trpgId)).toMatchObject({ title: 'Campaign', defaultNotebook: 'trpg~trpg', unservedDefault: 'elsewhere' });
    expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=trpg~trpg')).body.note.content).toContain('TRPG note');
  });

  it('keeps a repository whose manifest does not parse open, reporting the text so it can be fixed', async () => {
    const { trpg } = await serve();
    fs.writeFileSync(path.join(trpg, '.mygitnotes.yaml'), 'schema_version: 3\nworkspace: [broken\n');
    const broken = await repository(trpgId);
    expect(broken).toMatchObject({ title: 'trpg', config: null, manifestError: { text: 'schema_version: 3\nworkspace: [broken\n' } });
    expect(broken).not.toHaveProperty('unavailable');
    expect((await get('/api/notes/read?path=notes/life/note.md&notebookId=trpg~trpg')).body.note.content).toContain('TRPG note');
    expect((await put(trpgId, trpgManifest('Fixed'), broken.configRevision)).status).toBe(200);
    expect(await repository(trpgId)).toMatchObject({ title: 'Fixed' });
    expect(await repository(trpgId)).not.toHaveProperty('manifestError');
  });

  it('refuses a save that names no repository or one it cannot reach', async () => {
    await serve();
    expect((await fetch(`${base}/api/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configYaml: manifest, configRevision: '' }) })).status).toBe(400);
    expect((await put('github:owner/lost@main', trpgManifest('Lost'), '')).status).toBe(503);
    expect((await put('github:owner/none@main', trpgManifest('None'), '')).status).toBe(404);
  });
});

describe('workspace documents in notebook repositories', () => {
  it('reads and writes Focus in the repository a request names, the home repository by default', async () => {
    const { home, trpg } = await serve();
    const trpgId = 'github:owner/trpg@main';
    const empty = (await get(`/api/focus-page?repository=${encodeURIComponent(trpgId)}`)).body;
    expect(empty).toMatchObject({ repository: trpgId, page: { version: 1, focuses: [] }, writable: true });
    const page = { version: 1, focuses: [{ id: 'campaign', notebookId: 'trpg~trpg', name: 'Campaign', division: 'single', panes: [{ tabs: [] }] }] };
    const saved = await fetch(`${base}/api/focus-page`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, revision: empty.revision, repository: trpgId }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(trpg, '.github-notes-focus.yaml'), 'utf8')).toContain('Campaign');
    // The repository's file names the notebook by its local id.
    expect(fs.readFileSync(path.join(trpg, '.github-notes-focus.yaml'), 'utf8')).toContain('notebookId: trpg\n');
    expect(fs.existsSync(path.join(home, '.github-notes-focus.yaml'))).toBe(false);
    expect((await get('/api/focus-page')).body).toMatchObject({ page: { focuses: [] } });
    expect((await get('/api/study?repository=github%3Aowner%2Flost%40main')).status).toBe(503);
  });
});

describe('bookmarks in distinct notebook repositories', () => {
  it('keeps identical relative paths apart and requires both repository and owner scope', async () => {
    const { home, trpg } = await serve();
    const repository = 'github:owner/trpg@main';
    const empty = (await get(`/api/bookmarks?repository=${encodeURIComponent(repository)}`)).body;
    const page = { version: 1, notebooks: [{ notebookId: 'trpg', groups: [], bookmarks: [{ id: 'note', label: 'TRPG', groupId: null, target: { kind: 'note', path: 'note.md' } }] }] };
    const save = (page: unknown, revision: string) => fetch(`${base}/api/bookmarks`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, page, revision }) });
    expect((await save(page, empty.revision)).status).toBe(410);
    fs.writeFileSync(path.join(trpg, BOOKMARKS_FILE), serializeWorkspaceDocument(page));
    expect(fs.existsSync(path.join(home, BOOKMARKS_FILE))).toBe(false);
    const saved = (await get(`/api/bookmarks?repository=${encodeURIComponent(repository)}`)).body;
    // The file names its notebook by local id; the answer names it by key.
    expect(saved).toMatchObject({ page: { ...page, notebooks: [{ ...page.notebooks[0], notebookId: 'trpg~trpg' }] }, writable: false });
    expect((await save({ ...page, notebooks: [{ ...page.notebooks[0], notebookId: 'life' }] }, saved.revision)).status).toBe(410);
    expect((await get('/api/bookmarks?repository=github%3Aowner%2Flost%40main')).status).toBe(503);
  });
});

describe('Git changes in each worktree', () => {
  it('lists changes by repository and commits each worktree on its own', async () => {
    const { home, trpg } = await serve();
    fs.writeFileSync(path.join(home, 'notes/life/note.md'), '# Home changed\n');
    fs.writeFileSync(path.join(trpg, 'notes/life/note.md'), '# TRPG changed\n');
    const { changes } = (await get('/api/git/changes')).body;
    const trpgId = 'github:owner/trpg@main';
    expect(changes.map((change: { repository: string; path: string; }) => [change.repository.startsWith('local:') ? 'home' : change.repository, change.path]).sort()).toEqual([[trpgId, 'notes/life/note.md'], ['home', 'notes/life/note.md']]);
    const trpgChange = changes.find((change: { repository: string; }) => change.repository === trpgId);
    const diff = (await get(`/api/git/file-diff?path=notes/life/note.md&side=working&repository=${encodeURIComponent(trpgId)}`)).body.diff;
    expect(diff).toContain('TRPG changed');
    const committed = await fetch(`${base}/api/git/commit-staged`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: trpgId, files: ['notes/life/note.md'], revisions: { 'notes/life/note.md': trpgChange.revision }, message: 'docs: trpg only', selected: true }) });
    expect(committed.status).toBe(200);
    expect(execFileSync('git', ['log', '--format=%s', '-1'], { cwd: trpg, encoding: 'utf8' }).trim()).toBe('docs: trpg only');
    expect(execFileSync('git', ['status', '--short'], { cwd: home, encoding: 'utf8' })).toContain('notes/life/note.md');
    const sync = await fetch(`${base}/api/git/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: trpgId }) });
    expect(sync.status).toBe(409);
  });
});

describe('Agent files in each repository', () => {
  it('lists, reads and saves the Agent files of the repository a request names', async () => {
    const { home, trpg } = await serve();
    fs.writeFileSync(path.join(trpg, 'AGENTS.md'), '# TRPG rules\n');
    const trpgId = encodeURIComponent('github:owner/trpg@main');
    const listing = (await get(`/api/agent-resources?repository=${trpgId}`)).body;
    expect(listing.files.map((file: { path: string; }) => file.path)).toContain('AGENTS.md');
    expect((await get(`/api/agent-resources/read?path=AGENTS.md&repository=${trpgId}`)).body.content).toBe('# TRPG rules\n');
    const saved = await fetch(`${base}/api/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'AGENTS.md', content: '# TRPG rules v2\n', repository: 'github:owner/trpg@main' }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(trpg, 'AGENTS.md'), 'utf8')).toBe('# TRPG rules v2\n');
    expect(fs.existsSync(path.join(home, 'AGENTS.md'))).toBe(false);
  });
});

describe('assets and edits named by notebook', () => {
  it('serves the asset of the named notebook and deletes the note of the named notebook', async () => {
    const { home, trpg } = await serve();
    for (const [root, body] of [[home, 'home-png'], [trpg, 'trpg-png']] as const) {
      fs.mkdirSync(path.join(root, 'notes/life/assets'), { recursive: true });
      fs.writeFileSync(path.join(root, 'notes/life/assets/map.png'), body);
    }
    const asset = (notebook: string) => fetch(`${base}/raw-assets/notes/life/assets/map.png?notebook=${notebook}`).then(async response => ({ status: response.status, body: await response.text() }));
    expect(await asset('trpg~trpg')).toEqual({ status: 200, body: 'trpg-png' });
    expect(await asset(nb('life'))).toEqual({ status: 200, body: 'home-png' });
    expect((await fetch(`${base}/raw-assets/notes/life/assets/map.png`)).status).toBe(400);
    const deleted = await fetch(`${base}/api/notes?path=notes/life/note.md&notebookId=trpg~trpg&noCommit=true`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(fs.existsSync(path.join(trpg, 'notes/life/note.md'))).toBe(false);
    expect(fs.existsSync(path.join(home, 'notes/life/note.md'))).toBe(true);
  });
});
