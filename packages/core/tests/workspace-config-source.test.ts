import { describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultMember, deploymentConfigSource, sameSite, siteIdentity, type WorkspaceMember, WorkspaceSetupError } from '../src/workspace-config-source.js';
import { createWorkspaceRepositories } from '../src/workspace-repositories.js';
import { type RepositoryRef, repositoryRef } from '../src/repository.js';
import { productRepository } from '../src/source-config.js';
import { localManifest, MISSING_MANIFEST_REVISION } from '../src/local-manifest.js';
import type { WorkspaceConfig } from '../src/types.js';
import type { ManifestRead } from '../src/repository-manifest.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '../src/workspace-preferences.js';

const request = { headers: {} };
const manifest = (title: string) => `schema_version: 1\nworkspace:\n  title: ${title}\n  default_notebook: ex\nnotebooks:\n  - id: ex\n    title: Example\n    root: notes/ex\n`;

const member = (ref: RepositoryRef, alias: string, isDefault = false, hidden = false): WorkspaceMember => ({ ref, alias, default: isDefault, hidden });

describe('the deployment configuration source', () => {
  it('reads the default member from the environment on every call', async () => {
    const env = { MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main' };
    const source = deploymentConfigSource('/tmp', env);
    expect(source.mode).toBe('remote');
    const settings = await source.settings(request);
    expect(settings.site).toEqual({ type: 'github' });
    expect(settings.members).toEqual([{ ref: repositoryRef({ type: 'github', repository: 'owner/repo', branch: 'main' }), alias: 'repo', default: true, hidden: false }]);
    expect(defaultMember(settings)?.ref.id).toBe('github:owner/repo@main');
    env.MYGITNOTES_REPOSITORY = 'owner/other';
    expect(defaultMember(await source.settings(request))?.ref.id).toBe('github:owner/other@main');
  });
  it('names a GitLab or Enterprise site by its URL', async () => {
    expect((await deploymentConfigSource('/tmp', { MYGITNOTES_SOURCE: 'gitlab', MYGITNOTES_REPOSITORY: 'group/project', MYGITNOTES_BRANCH: 'main', MYGITNOTES_GITLAB_URL: 'https://gitlab.example.com' }).settings(request)).site).toEqual({ type: 'gitlab', url: 'https://gitlab.example.com' });
    expect(siteIdentity({ type: 'gitlab', url: 'https://gitlab.example.com' })).toBe('gitlab:https://gitlab.example.com');
    expect(siteIdentity({ type: 'github' })).toBe('github');
    expect(sameSite({ type: 'github' }, { type: 'github', repository: 'a/b', branch: 'main' })).toBe(true);
    expect(sameSite({ type: 'github' }, { type: 'github', url: 'https://ghe.example.com', repository: 'a/b', branch: 'main' })).toBe(false);
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
  it("keeps each member's manifest in that repository", async () => {
    const settings = await deploymentConfigSource('/tmp', { MYGITNOTES_SOURCE: 'github', MYGITNOTES_REPOSITORY: 'owner/repo', MYGITNOTES_BRANCH: 'main' }).settings(request);
    const store = { read: vi.fn(), save: vi.fn() };
    expect(settings.manifest(settings.members[0], () => store)).toBe(store);
  });
});

describe('the product repository', () => {
  it('is named by the environment or the server file, on the deployment GitHub site, at its core branch', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-product-'));
    try {
      expect(productRepository(base, {})).toBeNull();
      expect(productRepository(base, { MYGITNOTES_PRODUCT_REPOSITORY: 'owner/kb' })).toEqual({ type: 'github', repository: 'owner/kb', branch: 'core' });
      expect(productRepository(base, { MYGITNOTES_PRODUCT_REPOSITORY: 'owner/kb', MYGITNOTES_GITHUB_URL: 'https://ghe.example.com' })).toEqual({ type: 'github', url: 'https://ghe.example.com', repository: 'owner/kb', branch: 'core' });
      fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'product_repository: owner/from-file\n');
      expect(productRepository(base, {})).toMatchObject({ repository: 'owner/from-file' });
      expect(() => productRepository(base, { MYGITNOTES_PRODUCT_REPOSITORY: 'not a repository' })).toThrow(/MYGITNOTES_PRODUCT_REPOSITORY must name a GitHub repository/);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('workspace repositories', () => {
  const config: WorkspaceConfig = { schema_version: 4, workspace: { title: 'Test', default_notebook: 'ex' }, notebooks: [{ id: 'ex', title: 'Example', root: 'notes/ex' }] };
  const home = repositoryRef({ type: 'github', repository: 'owner/repo', branch: 'main' });
  const file = (read: ManifestRead) => ({ read: async () => read, save: vi.fn() });

  it('knows the default member without opening any repository', () => {
    const openRepository = vi.fn();
    const repositories = createWorkspaceRepositories({ members: [member(home, 'repo', true)], openRepository, manifest: () => file({ state: 'file', config, revision: 'r' }) });
    expect(repositories.default?.ref).toBe(home);
    expect(openRepository).not.toHaveBeenCalled();
  });
  it("serves the notebooks of each member's own manifest and rejects unknown notebooks and repositories", async () => {
    const repositories = createWorkspaceRepositories<{ scope: () => Promise<WorkspaceConfig>; }>({ members: [member(home, 'repo', true)], openRepository: async (_member, scope) => ({ scope }), manifest: () => file({ state: 'file', config, revision: 'a'.repeat(40) }) });
    expect((await repositories.forNotebook('repo~ex')).ref.id).toBe(home.id);
    expect(await (await repositories.defaultRepository()).handle.scope()).toEqual(config);
    await expect(repositories.forNotebook('repo~missing')).rejects.toMatchObject({ status: 404 });
    // A bare id is the browser's to redirect first; an unknown alias never falls back to a bare-id lookup.
    await expect(repositories.forNotebook('ex')).rejects.toMatchObject({ status: 400 });
    await expect(repositories.forNotebook('other~ex')).rejects.toMatchObject({ status: 404 });
    await expect(repositories.byId('github:owner/other@main')).rejects.toMatchObject({ status: 404 });
    expect((await repositories.all()).map(entry => entry.notebooks.map(notebook => notebook.id))).toEqual([['ex']]);
    expect(await repositories.keyedConfig()).toMatchObject({ workspace: { title: 'Test', default_notebook: 'repo~ex' }, notebooks: [{ id: 'repo~ex' }] });
  });
  it('has no default repository and no notebooks when it has no member', async () => {
    const repositories = createWorkspaceRepositories({ members: [], openRepository: vi.fn(), manifest: vi.fn() });
    expect(repositories.default).toBeNull();
    expect(await repositories.all()).toEqual([]);
    expect(await repositories.keyedConfig()).toBeNull();
    await expect(repositories.defaultRepository()).rejects.toMatchObject({ status: 404 });
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
    expect(await store.load()).toMatchObject({ config: { workspace: { title: 'Fresh' } }, revision: saved.revision });
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
    expect((await store.load()).config.workspace.title).toBe('Mine');
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

  it('saves a manifest read from the example layout so it reloads with the same roots', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-local-manifest-'));
    fs.mkdirSync(path.join(root, 'examples/workspace/notes/ex'), { recursive: true });
    fs.writeFileSync(path.join(root, 'examples/workspace/.mygitnotes.yaml'), manifest('Example'));
    const commit = vi.fn(async () => undefined);
    const store = localManifest(root, commit);
    const loaded = await store.load();
    expect(loaded.config.notebooks[0].root).toBe('examples/workspace/notes/ex');
    // Settings sends back the manifest as it was shown, with the roots the example layout resolved.
    await store.save(stringifyYaml({ ...loaded.config, workspace: { ...loaded.config.workspace, title: 'Saved' } }), loaded.revision);
    const saved = await store.load();
    expect(saved.config.workspace.title).toBe('Saved');
    expect(saved.config.notebooks[0].root).toBe('examples/workspace/notes/ex');
    expect((await localManifest(root, commit).load()).config.notebooks[0].root).toBe('examples/workspace/notes/ex');
    expect(commit).toHaveBeenCalledWith(root, ['notes/.mygitnotes.yaml'], 'chore(workspace): update configuration');
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
  const config: WorkspaceConfig = { schema_version: 4, workspace: { title: 'Test', default_notebook: 'ex' }, notebooks: [{ id: 'ex', title: 'Example', root: 'notes/ex' }, { id: 'deep', title: 'Deep', root: 'notes/ex-deep' }] };
  const home = repositoryRef({ type: 'github', repository: 'owner/repo', branch: 'main' });
  const repositories = createWorkspaceRepositories({ members: [member(home, 'repo', true)], openRepository: async (_member, scope) => ({ scope }), manifest: () => ({ read: async () => ({ state: 'file' as const, config, revision: 'a'.repeat(40) }), save: vi.fn() }) });

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

describe('several repositories, each with its own manifest', () => {
  const home = repositoryRef({ type: 'github', repository: 'owner/home', branch: 'main' });
  const trpg = repositoryRef({ type: 'github', repository: 'owner/trpg', branch: 'main' });
  const own = (title: string, ...ids: string[]): WorkspaceConfig => ({ schema_version: 4, workspace: { title, default_notebook: ids[0] }, notebooks: ids.map(id => ({ id, title: id.toUpperCase(), root: id === 'life' || id === 'trpg' ? 'notes' : id })), preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, defaultShowLineNumbers: title === 'Campaign' } });
  const members = [member(home, 'home', true), member(trpg, 'trpg')];
  const workspace = (reads: Record<string, ManifestRead>, open: (target: WorkspaceMember) => Promise<unknown> = async target => target) => {
    const save = vi.fn(async () => ({ revision: 'saved' }));
    const manifest = vi.fn((target: WorkspaceMember) => ({ read: async () => reads[target.ref.id], save }));
    return { save, manifest, repositories: createWorkspaceRepositories<unknown>({ members, openRepository: open as never, manifest }) };
  };

  it("keys each repository's notebooks by its alias and opens each repository once", async () => {
    const open = vi.fn(async (target: WorkspaceMember) => target);
    const { repositories } = workspace({ [home.id]: { state: 'file', config: own('Home', 'life', 'other'), revision: 'h1' }, [trpg.id]: { state: 'file', config: own('Campaign', 'trpg'), revision: 't1' } }, open);
    expect((await repositories.all()).map(entry => [entry.ref.id, entry.notebooks.map(notebook => notebook.key)])).toEqual([[home.id, ['home~life', 'home~other']], [trpg.id, ['trpg~trpg']]]);
    expect((await repositories.scope(trpg.id)).notebooks.map(notebook => notebook.id)).toEqual(['trpg']);
    expect((await repositories.forNotebook('trpg~trpg')).ref.id).toBe(trpg.id);
    expect(open).toHaveBeenCalledTimes(2);
    expect(await repositories.keyedConfig()).toMatchObject({ workspace: { title: 'Home', default_notebook: 'home~life' }, notebooks: [{ id: 'home~life' }, { id: 'home~other' }, { id: 'trpg~trpg' }] });
  });

  it('asks for the notebook when a path lies in notebooks of two repositories', async () => {
    const { repositories } = workspace({ [home.id]: { state: 'file', config: own('Home', 'life', 'other'), revision: 'h1' }, [trpg.id]: { state: 'file', config: own('Campaign', 'trpg'), revision: 't1' } });
    await expect(repositories.forPath('notes/a.md')).rejects.toMatchObject({ status: 400 });
    expect((await repositories.forPath('other/a.md')).notebook.id).toBe('other');
  });

  it('reports an unreachable repository without its notebooks and keeps the others serving', async () => {
    const { repositories, manifest } = workspace({ [home.id]: { state: 'file', config: own('Home', 'life'), revision: 'h1' } }, async target => target.ref.id === trpg.id ? { reason: 'no-access', message: 'Repository unavailable.' } : target);
    const [, trpgEntry] = await repositories.all();
    expect(trpgEntry).toMatchObject({ notebooks: [], unavailable: { reason: 'no-access', message: 'Repository unavailable.' } });
    await expect(repositories.forNotebook('trpg~trpg')).rejects.toMatchObject({ status: 503, message: 'Repository unavailable.' });
    expect((await repositories.forNotebook('home~life')).ref.id).toBe(home.id);
    expect(await repositories.manifestOf(trpg.id)).toMatchObject({ title: 'trpg', config: null, revision: '', defaultNotebook: null });
    await expect(repositories.saveManifest(trpg.id, 'yaml', '')).rejects.toMatchObject({ status: 503 });
    expect(manifest).toHaveBeenCalledTimes(1);
  });

  it('makes a repository whose manifest does not load, or still uses source, unavailable with the reason, and lets its manifest be fixed', async () => {
    const { repositories, save } = workspace({ [home.id]: { state: 'file', config: own('Home', 'life'), revision: 'h1' }, [trpg.id]: { state: 'invalid', text: 'workspace: [', error: 'bad YAML', revision: 't5' } });
    expect((await repositories.all())[1]).toMatchObject({ notebooks: [], unavailable: { reason: 'invalid-manifest', message: 'The manifest of owner/trpg cannot be loaded: bad YAML' } });
    expect(await repositories.manifestOf(trpg.id)).toMatchObject({ title: 'trpg', config: null, error: { message: 'bad YAML', text: 'workspace: [' }, revision: 't5' });
    expect(await repositories.handleOf(trpg.id)).toBe(members[1]);
    expect(await repositories.saveManifest(trpg.id, 'fixed', 't5')).toEqual({ revision: 'saved' });
    expect(save).toHaveBeenCalledWith('fixed', 't5');
    const sourced = workspace({ [home.id]: { state: 'invalid', text: 'x', error: 'Notebook b uses source, which schema 4 removed. Run pnpm convert-sources in this repository.', revision: 'h', sourceNotebook: 'b' }, [trpg.id]: { state: 'file', config: own('Campaign', 'trpg'), revision: 't1' } });
    expect((await sourced.repositories.all())[0]).toMatchObject({ unavailable: { reason: 'invalid-manifest', message: 'Notebook b uses source, which schema 4 removed. Run pnpm convert-sources in owner/home.' } });
    // The default repository cannot be read, so the workspace opens at the first one that can.
    expect(await sourced.repositories.keyedConfig()).toMatchObject({ workspace: { title: 'Campaign', default_notebook: 'trpg~trpg' } });
    await expect(sourced.repositories.defaultRepository()).rejects.toMatchObject({ status: 503 });
  });

  it("reads each repository's own manifest for its title, default and preferences, and saves it in that repository", async () => {
    const { repositories, save } = workspace({ [home.id]: { state: 'file', config: own('Home', 'life'), revision: 'h1' }, [trpg.id]: { state: 'file', config: own('Campaign', 'trpg'), revision: 't3' } });
    expect(await repositories.manifestOf(home.id)).toMatchObject({ title: 'Home', defaultNotebook: 'home~life', revision: 'h1', derived: false, preferences: { defaultShowLineNumbers: false } });
    expect(await repositories.manifestOf(trpg.id)).toMatchObject({ title: 'Campaign', defaultNotebook: 'trpg~trpg', revision: 't3', derived: false, preferences: { defaultShowLineNumbers: true } });
    expect(await repositories.saveManifest(trpg.id, 'yaml', 't3')).toEqual({ revision: 'saved' });
    expect(save).toHaveBeenCalledWith('yaml', 't3');
    await expect(repositories.manifestOf('github:owner/none@main')).rejects.toMatchObject({ status: 404 });
  });

  it('serves the derived notebooks of a repository that keeps no manifest, and none for a worktree that keeps none', async () => {
    const { repositories } = workspace({ [home.id]: { state: 'missing', revision: 'none' }, [trpg.id]: { state: 'derived', config: own('trpg', 'trpg'), revision: 't1' } });
    const [homeEntry, trpgEntry] = await repositories.all();
    expect(homeEntry).toMatchObject({ notebooks: [], handle: members[0] });
    expect(trpgEntry.notebooks.map(notebook => notebook.key)).toEqual(['trpg~trpg']);
    expect(await repositories.manifestOf(home.id)).toMatchObject({ title: 'home', config: null, revision: 'none', derived: false, defaultNotebook: null });
    expect(await repositories.manifestOf(trpg.id)).toMatchObject({ derived: true, defaultNotebook: 'trpg~trpg' });
    expect((await repositories.scope(home.id)).notebooks).toEqual([]);
    expect(await repositories.resolveBareId('trpg')).toBe('trpg~trpg');
  });

  it('opens only the members it is given', async () => {
    const open = vi.fn(async (target: WorkspaceMember) => target);
    const repositories = createWorkspaceRepositories<unknown>({ members: [members[0]], openRepository: open as never, manifest: () => ({ read: async () => ({ state: 'file' as const, config: own('Home', 'life'), revision: 'h1' }), save: vi.fn() }) });
    await repositories.all();
    await expect(repositories.byId(trpg.id)).rejects.toMatchObject({ status: 404 });
    await expect(repositories.forNotebook('trpg~trpg')).rejects.toMatchObject({ status: 404 });
    expect(open.mock.calls.map(([target]) => target.ref.id)).toEqual([home.id]);
  });
});

describe('local repository mappings', () => {
  it('makes each mapped worktree a member after the default one, relative to the file', async () => {
    const { loadRepositoryMappings, mapsRepository } = await import('../src/source-config.js');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-mappings-'));
    fs.mkdirSync(path.join(base, 'home'));
    fs.writeFileSync(path.join(base, 'mygitnotes.server.yaml'), 'source:\n  type: local\n  path: ./home\nrepositories:\n  - type: github\n    repository: owner/trpg\n    path: ../trpg\n  - type: github\n    repository: owner/home\n    path: ./home\n');
    const [mapping] = loadRepositoryMappings(base, {});
    expect(mapping.path).toBe(path.resolve(base, '../trpg'));
    expect(mapsRepository(mapping, { type: 'github', repository: 'owner/trpg', branch: 'draft' })).toBe(true);
    expect(mapsRepository(mapping, { type: 'github', repository: 'owner/other', branch: 'main' })).toBe(false);
    const settings = await deploymentConfigSource(base, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: path.join(base, 'home') }).settings(request);
    expect(settings.site).toEqual({ type: 'local' });
    // A mapping onto the default worktree is that repository by another name.
    expect(settings.members.map(entry => [entry.ref.id, entry.alias, entry.default, entry.localPath])).toEqual([[`local:${path.join(base, 'home')}`, 'home', true, path.join(base, 'home')], ['github:owner/trpg@main', 'trpg', false, path.resolve(base, '../trpg')]]);
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
