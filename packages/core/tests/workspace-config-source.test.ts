import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentConfigSource, WorkspaceSetupError } from '../src/workspace-config-source.js';
import { createWorkspaceRepositories } from '../src/workspace-repositories.js';
import { repositoryRef } from '../src/repository.js';
import { localManifest, MISSING_MANIFEST_REVISION } from '../src/local-manifest.js';
import type { WorkspaceConfig } from '../src/types.js';
import type { ManifestRead } from '../src/repository-manifest.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../src/workspace-preferences.js';

const request = { headers: {} };
const manifest = (title: string) => `schema_version: 1\nworkspace:\n  title: ${title}\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n`;

describe('the deployment configuration source', () => {
  it('reads the home repository from the environment on every call', async () => {
    const env = { MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main' };
    const source = deploymentConfigSource('/tmp', env);
    expect(source.mode).toBe('remote');
    expect((await source.settings(request)).home.id).toBe('github:owner/repo@main');
    env.MYGITNOTES_REPOSITORY = 'owner/other';
    expect((await source.settings(request)).home.id).toBe('github:owner/other@main');
  });
  it('starts in remote mode and reports a setup error per request when no source is usable', async () => {
    const source = deploymentConfigSource('/tmp', { MYGITNOTES_SOURCE: 'github', VERCEL: '1' });
    expect(source.mode).toBe('remote');
    await expect(source.settings(request)).rejects.toBeInstanceOf(WorkspaceSetupError);
    await expect(source.settings(request)).rejects.toMatchObject({ status: 503 });
  });
  it('refuses a source that switched between local and remote after startup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-deployment-'));
    const env: NodeJS.ProcessEnv = { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: root };
    const source = deploymentConfigSource('/tmp', env);
    expect(source.mode).toBe('local');
    Object.assign(env, { MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main' });
    await expect(source.settings(request)).rejects.toThrow(/Restart the server/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  it('keeps the manifest in the home repository', async () => {
    const settings = await deploymentConfigSource('/tmp', { MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main' }).settings(request);
    const store = { load: vi.fn(), save: vi.fn() };
    expect(settings.manifest(() => store)).toBe(store);
  });
});

describe('workspace repositories', () => {
  const config: WorkspaceConfig = { schema_version: 1, workspace: { title: 'Test', default_notebook: 'ex' }, notebooks: [{ id: 'ex', title: 'Example', root: 'notes/ex' }] };
  const home = repositoryRef({ type: 'github', repository: 'owner/repo', branch: 'main' });

  it('opens the home repository without loading the manifest', () => {
    const load = vi.fn(async () => ({ config, revision: 'a'.repeat(40) }));
    const repositories = createWorkspaceRepositories({ home, openHome: scope => ({ scope }), manifest: () => ({ load, save: vi.fn() }) });
    expect(repositories.home.ref).toBe(home);
    expect(load).not.toHaveBeenCalled();
  });
  it('serves every notebook from the home repository and rejects unknown notebooks and repositories', async () => {
    const repositories = createWorkspaceRepositories({ home, openHome: scope => ({ scope }), manifest: () => ({ load: async () => ({ config, revision: 'a'.repeat(40) }), save: vi.fn() }) });
    expect((await repositories.forNotebook('repo~ex')).ref.id).toBe(home.id);
    expect(await repositories.home.handle.scope()).toEqual(config);
    await expect(repositories.forNotebook('repo~missing')).rejects.toMatchObject({ status: 404 });
    // A bare id is the browser's to redirect first; an unknown alias never falls back to a bare-id lookup.
    await expect(repositories.forNotebook('ex')).rejects.toMatchObject({ status: 400 });
    await expect(repositories.forNotebook('other~ex')).rejects.toMatchObject({ status: 404 });
    await expect(repositories.byId('github:owner/other@main')).rejects.toMatchObject({ status: 404 });
    expect((await repositories.all()).map(entry => entry.notebooks.map(notebook => notebook.id))).toEqual([['ex']]);
  });
});

describe('a local manifest store', () => {
  it('writes the first manifest under the standard filename and commits it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-local-manifest-'));
    const commit = vi.fn(async () => undefined);
    const store = localManifest(root, commit);
    await expect(store.load()).rejects.toMatchObject({ status: 422 });
    await expect(store.read()).resolves.toEqual({ state: 'missing', revision: MISSING_MANIFEST_REVISION });
    const saved = await store.save(manifest('Fresh'), MISSING_MANIFEST_REVISION);
    expect(saved.config.workspace.title).toBe('Fresh');
    expect(fs.readFileSync(path.join(root, 'notes/.mygitnotes.yaml'), 'utf8')).toContain('Fresh');
    expect(commit).toHaveBeenCalledWith(root, ['notes/.mygitnotes.yaml'], 'chore(workspace): update configuration');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('revises the manifest by its content and refuses a save from a revision the file no longer has', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-local-manifest-'));
    fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), manifest('First'));
    const commit = vi.fn(async () => undefined);
    const store = localManifest(root, commit);
    const { revision } = await store.load();
    expect(revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await store.load()).revision).toBe(revision);
    // Another editor changes the file after this one read it.
    fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), manifest('Elsewhere'));
    await expect(store.save(manifest('Mine'), revision)).rejects.toMatchObject({ status: 409 });
    await expect(store.save(manifest('Mine'), '')).rejects.toMatchObject({ status: 409 });
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toContain('Elsewhere');
    expect(commit).not.toHaveBeenCalled();
    const current = (await store.load()).revision;
    expect(current).not.toBe(revision);
    const saved = await store.save(manifest('Mine'), current);
    expect(saved.config.workspace.title).toBe('Mine');
    expect(saved.revision).not.toBe(current);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses to create a manifest that appeared since the worktree was read without one', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-local-manifest-'));
    const store = localManifest(root, vi.fn(async () => undefined), '.mygitnotes.yaml');
    const { revision } = await store.read();
    fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), manifest('Appeared'));
    await expect(store.save(manifest('Created'), revision)).rejects.toMatchObject({ status: 409 });
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toContain('Appeared');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads an invalid manifest as its text and error, and replaces it on save', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-local-manifest-'));
    fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), 'schema_version: 3\nworkspace: [broken\n');
    const store = localManifest(root, vi.fn(async () => undefined));
    const read = await store.read();
    expect(read).toMatchObject({ state: 'invalid', text: 'schema_version: 3\nworkspace: [broken\n' });
    await store.save(manifest('Fixed'), read.revision);
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toContain('Fixed');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads a manifest it cannot open as one it cannot read, and refuses to load it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-local-manifest-'));
    fs.mkdirSync(path.join(root, '.mygitnotes.yaml'));
    const store = localManifest(root, vi.fn(async () => undefined));
    const read = await store.read();
    expect(read).toMatchObject({ state: 'invalid', text: '', error: expect.stringMatching(/EISDIR/), revision: 'unread:.mygitnotes.yaml' });
    await expect(store.load()).rejects.toMatchObject({ code: 'EISDIR' });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('repositories by path and shared credentials', () => {
  const config: WorkspaceConfig = { schema_version: 1, workspace: { title: 'Test', default_notebook: 'ex' }, notebooks: [{ id: 'ex', title: 'Example', root: 'notes/ex' }, { id: 'deep', title: 'Deep', root: 'notes/ex-deep' }] };
  const home = repositoryRef({ type: 'github', repository: 'owner/repo', branch: 'main' });
  const repositories = createWorkspaceRepositories({ home, openHome: scope => ({ scope }), manifest: () => ({ load: async () => ({ config, revision: 'a'.repeat(40) }), save: vi.fn() }) });

  it('finds the notebook whose root contains a path', async () => {
    const { forPath } = repositories;
    expect((await forPath('notes/ex/a.md')).notebook.id).toBe('ex');
    expect((await forPath('notes/ex-deep/a.md')).notebook.id).toBe('deep');
    await expect(forPath('notes/other/a.md')).rejects.toMatchObject({ status: 403 });
    await expect(forPath('notes/ex')).rejects.toMatchObject({ status: 403 });
  });

  it('shares a credential only within one platform and site', async () => {
    const { sharesCredential } = await import('../src/repository.js');
    const github = { type: 'github' as const, repository: 'a/b', branch: 'main' };
    const gitlab = { type: 'gitlab' as const, url: 'https://gitlab.com', repository: 'a/b', branch: 'main' };
    expect(sharesCredential(github, { ...github, repository: 'c/d' })).toBe(true);
    expect(sharesCredential(github, gitlab)).toBe(false);
    expect(sharesCredential(gitlab, { ...gitlab, repository: 'c/d' })).toBe(true);
    expect(sharesCredential(gitlab, { ...gitlab, url: 'https://gitlab.example.com' })).toBe(false);
  });
});

describe('notebook repositories', () => {
  const home = repositoryRef({ type: 'github', repository: 'owner/home', branch: 'main' });
  const trpg = { type: 'github' as const, repository: 'owner/trpg', branch: 'main' };
  const config: WorkspaceConfig = { schema_version: 3, workspace: { title: 'Test', default_notebook: 'life' }, notebooks: [{ id: 'life', title: 'Life', root: 'notes' }, { id: 'trpg', title: 'TRPG', root: 'notes', source: trpg }, { id: 'also-home', title: 'Also home', root: 'other', source: { type: 'github', repository: 'owner/home', branch: 'main' } }] };
  const load = async () => ({ config, revision: 'a'.repeat(40) });
  const open = (openRepository?: (ref: ReturnType<typeof repositoryRef>, scope: () => Promise<WorkspaceConfig>) => Promise<unknown>) => createWorkspaceRepositories<unknown>({ home, openHome: scope => ({ scope }), manifest: () => ({ load, save: vi.fn() }), ...(openRepository ? { openRepository: openRepository as never } : {}) });

  it('groups notebooks by repository, treating a source that names the home repository as home', async () => {
    const opened = vi.fn(async (_ref: unknown, scope: () => Promise<WorkspaceConfig>) => ({ scope }));
    const repositories = open(opened);
    const all = await repositories.all();
    expect(all.map(entry => [entry.ref.id, entry.notebooks.map(notebook => notebook.id)])).toEqual([[home.id, ['life', 'also-home']], ['github:owner/trpg@main', ['trpg']]]);
    expect((await repositories.scope(home.id)).notebooks.map(notebook => notebook.id)).toEqual(['life', 'also-home']);
    expect((await repositories.scope('github:owner/trpg@main')).notebooks.map(notebook => notebook.id)).toEqual(['trpg']);
    expect((await repositories.forNotebook('trpg~trpg')).ref.id).toBe('github:owner/trpg@main');
    await repositories.forNotebook('trpg~trpg');
    expect(opened).toHaveBeenCalledTimes(1);
    expect((await repositories.keyedConfig()).notebooks.map(notebook => notebook.id)).toEqual(['home~life', 'trpg~trpg', 'home~also-home']);
    expect((await repositories.keyedConfig()).workspace.default_notebook).toBe('home~life');
  });

  it('asks for the notebook when a path lies in notebooks of two repositories', async () => {
    const repositories = open(async (_ref, scope) => ({ scope }));
    await expect(repositories.forPath('notes/a.md')).rejects.toMatchObject({ status: 400 });
    expect((await repositories.forPath('other/a.md')).notebook.id).toBe('also-home');
  });

  it('reports an unavailable repository and refuses to serve its notebooks', async () => {
    const repositories = open(async () => ({ reason: 'no-access', message: 'Repository unavailable.' }));
    const [, trpgEntry] = await repositories.all();
    expect(trpgEntry).toMatchObject({ unavailable: { reason: 'no-access' } });
    await expect(repositories.forNotebook('trpg~trpg')).rejects.toMatchObject({ status: 503, message: 'TRPG: Repository unavailable.' });
    expect((await repositories.forNotebook('home~life')).ref.id).toBe(home.id);
  });

  it('marks notebook repositories unmapped when nothing opens them', async () => {
    const [, trpgEntry] = await open().all();
    expect(trpgEntry).toMatchObject({ unavailable: { reason: 'unmapped' } });
  });

  it("reads each repository's own manifest for its title, default and preferences, and saves it in that repository", async () => {
    const trpgId = 'github:owner/trpg@main';
    const file = { read: vi.fn(async (): Promise<ManifestRead> => ({ state: 'missing', revision: 'r1' })), save: vi.fn(async () => ({ revision: 'r2' })) };
    const homeSave = vi.fn(async () => ({ config, revision: 'h2' }));
    const repositories = createWorkspaceRepositories<unknown>({ home, openHome: scope => ({ scope }), manifest: () => ({ load, save: homeSave }), openRepository: async (_ref, scope) => ({ scope }), repositoryManifest: () => file });
    expect(await repositories.manifestOf(home.id)).toMatchObject({ title: 'Test', defaultNotebook: 'home~life', revision: 'a'.repeat(40), derived: false, preferences: DEFAULT_WORKSPACE_PREFERENCES });
    // Without a file the repository is shown by its name and would create a manifest of the notebooks it serves.
    const derived = await repositories.manifestOf(trpgId);
    expect(derived).toMatchObject({ title: 'trpg', defaultNotebook: 'trpg~trpg', revision: 'r1', derived: true, preferences: DEFAULT_WORKSPACE_PREFERENCES });
    expect(derived.config?.notebooks).toEqual([expect.objectContaining({ id: 'trpg', root: 'notes' })]);
    expect(derived.config?.notebooks[0]).not.toHaveProperty('source');
    // Its own file names it and sets its preferences; a default it does not serve falls back to its first notebook.
    const own = { schema_version: 3, workspace: { title: 'Campaign', default_notebook: 'elsewhere' }, notebooks: [{ id: 'elsewhere', title: 'Elsewhere', root: 'x' }], preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, defaultShowLineNumbers: true } };
    file.read.mockResolvedValueOnce({ state: 'file', config: own, revision: 'r3' });
    expect(await repositories.manifestOf(trpgId)).toMatchObject({ title: 'Campaign', defaultNotebook: 'trpg~trpg', unservedDefault: 'elsewhere', preferences: { defaultShowLineNumbers: true }, revision: 'r3', derived: false });
    file.read.mockResolvedValueOnce({ state: 'file', config: { ...own, workspace: { title: 'Campaign', default_notebook: 'trpg' } }, revision: 'r4' });
    expect(await repositories.manifestOf(trpgId)).not.toHaveProperty('unservedDefault');
    // A file that does not parse keeps the repository open and reports its text.
    file.read.mockResolvedValueOnce({ state: 'invalid', text: 'workspace: [', error: 'bad YAML', revision: 'r5' });
    expect(await repositories.manifestOf(trpgId)).toMatchObject({ title: 'trpg', config: null, error: { message: 'bad YAML', text: 'workspace: [' }, revision: 'r5', preferences: DEFAULT_WORKSPACE_PREFERENCES });
    expect((await repositories.forNotebook('trpg~trpg')).ref.id).toBe(trpgId);

    expect(await repositories.saveManifest(trpgId, 'yaml', 'r1')).toEqual({ revision: 'r2' });
    expect(file.save).toHaveBeenCalledWith('yaml', 'r1');
    expect(homeSave).not.toHaveBeenCalled();
    expect(await repositories.saveManifest(home.id, 'home yaml', 'h1')).toEqual({ revision: 'h2' });
    expect(homeSave).toHaveBeenCalledWith('home yaml', 'h1');
    await expect(repositories.manifestOf('github:owner/none@main')).rejects.toMatchObject({ status: 404 });
  });

  it('names an unreachable repository without reading it and refuses to save its manifest', async () => {
    const read = vi.fn();
    const repositories = createWorkspaceRepositories<unknown>({ home, openHome: scope => ({ scope }), manifest: () => ({ load, save: vi.fn() }), openRepository: async () => ({ reason: 'no-access', message: 'Repository unavailable.' }), repositoryManifest: () => ({ read, save: vi.fn() }) });
    expect(await repositories.manifestOf('github:owner/trpg@main')).toMatchObject({ title: 'trpg', config: null, revision: '', defaultNotebook: 'trpg~trpg' });
    expect(read).not.toHaveBeenCalled();
    await expect(repositories.saveManifest('github:owner/trpg@main', 'yaml', '')).rejects.toMatchObject({ status: 503 });
  });

  it('refuses overlapping roots once a source resolves to the home repository', async () => {
    const overlapping: WorkspaceConfig = { ...config, notebooks: [{ id: 'life', title: 'Life', root: 'notes' }, { id: 'nested', title: 'Nested', root: 'notes/n', source: trpg }] };
    const repositories = createWorkspaceRepositories<unknown>({ home, openHome: scope => ({ scope }), manifest: () => ({ load: async () => ({ config: overlapping, revision: '' }), save: vi.fn() }), isHome: ref => ref.id === 'github:owner/trpg@main' });
    await expect(repositories.all()).rejects.toMatchObject({ status: 422 });
  });
});

describe('local repository mappings', () => {
  it('resolves worktrees from mygitnotes.server.yaml relative to the file', async () => {
    const { loadRepositoryMappings, mapsRepository } = await import('../src/source-config.js');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mappings-'));
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'source:\n  type: local\n  path: ./home\nrepositories:\n  - type: github\n    repository: owner/trpg\n    path: ../trpg\n');
    const [mapping] = loadRepositoryMappings(base, {});
    expect(mapping.path).toBe(path.resolve(base, '../trpg'));
    expect(mapsRepository(mapping, { type: 'github', repository: 'owner/trpg', branch: 'draft' })).toBe(true);
    expect(mapsRepository(mapping, { type: 'github', repository: 'owner/other', branch: 'main' })).toBe(false);
    const settings = await deploymentConfigSource(base, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: base }).settings(request);
    expect(settings.localPath(repositoryRef({ type: 'github', repository: 'owner/trpg', branch: 'main' }))).toBe(path.resolve(base, '../trpg'));
    expect(settings.localPath(repositoryRef({ type: 'github', repository: 'owner/none', branch: 'main' }))).toBeUndefined();
    fs.rmSync(base, { recursive: true, force: true });
  });
  it('fails setup on a malformed mapping', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mappings-'));
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'repositories:\n  - type: github\n    repository: owner/trpg\n');
    await expect(deploymentConfigSource(base, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: base }).settings(request)).rejects.toThrow(/needs a path/);
    fs.rmSync(base, { recursive: true, force: true });
  });
});

describe('repository refusals', () => {
  it('names the step that failed and keeps the provider status and message', async () => {
    const { reaching, RepositoryUnavailableError } = await import('../src/repository.js');
    const { SourceError } = await import('../src/github-api.js');
    const refused = reaching('missing-branch', async () => {
      throw new SourceError('Branch unavailable.', 404);
    });
    await expect(refused).rejects.toBeInstanceOf(RepositoryUnavailableError);
    await expect(reaching('missing-branch', async () => {
      throw new SourceError('Branch unavailable.', 404);
    })).rejects.toMatchObject({ reason: 'missing-branch', status: 404, message: 'Branch unavailable.' });
    await expect(reaching('no-access', async () => {
      throw new SourceError('Rate limited.', 429);
    })).rejects.not.toBeInstanceOf(RepositoryUnavailableError);
  });
});
