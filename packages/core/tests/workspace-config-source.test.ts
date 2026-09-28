import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentConfigSource, WorkspaceSetupError } from '../src/workspace-config-source.js';
import { createWorkspaceRepositories } from '../src/workspace-repositories.js';
import { repositoryRef } from '../src/repository.js';
import { localManifest } from '../src/local-manifest.js';
import type { WorkspaceConfig } from '../src/types.js';

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
    expect((await repositories.forNotebook('ex')).ref.id).toBe(home.id);
    expect(await repositories.home.handle.scope()).toEqual(config);
    await expect(repositories.forNotebook('missing')).rejects.toMatchObject({ status: 404 });
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
    const saved = await store.save(manifest('Fresh'), '');
    expect(saved.config.workspace.title).toBe('Fresh');
    expect(fs.readFileSync(path.join(root, 'notes/.mygitnotes.yaml'), 'utf8')).toContain('Fresh');
    expect(commit).toHaveBeenCalledWith(root, ['notes/.mygitnotes.yaml'], 'chore(workspace): update configuration');
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
  const config: WorkspaceConfig = { schema_version: 2, workspace: { title: 'Test', default_notebook: 'life' }, notebooks: [{ id: 'life', title: 'Life', root: 'notes' }, { id: 'trpg', title: 'TRPG', root: 'notes', source: trpg }, { id: 'also-home', title: 'Also home', root: 'other', source: { type: 'github', repository: 'owner/home', branch: 'main' } }] };
  const load = async () => ({ config, revision: 'a'.repeat(40) });
  const open = (openRepository?: (ref: ReturnType<typeof repositoryRef>, scope: () => Promise<WorkspaceConfig>) => Promise<unknown>) => createWorkspaceRepositories<unknown>({ home, openHome: scope => ({ scope }), manifest: () => ({ load, save: vi.fn() }), ...(openRepository ? { openRepository: openRepository as never } : {}) });

  it('groups notebooks by repository, treating a source that names the home repository as home', async () => {
    const opened = vi.fn(async (_ref: unknown, scope: () => Promise<WorkspaceConfig>) => ({ scope }));
    const repositories = open(opened);
    const all = await repositories.all();
    expect(all.map(entry => [entry.ref.id, entry.notebooks.map(notebook => notebook.id)])).toEqual([[home.id, ['life', 'also-home']], ['github:owner/trpg@main', ['trpg']]]);
    expect((await repositories.scope(home.id)).notebooks.map(notebook => notebook.id)).toEqual(['life', 'also-home']);
    expect((await repositories.scope('github:owner/trpg@main')).notebooks.map(notebook => notebook.id)).toEqual(['trpg']);
    expect((await repositories.forNotebook('trpg')).ref.id).toBe('github:owner/trpg@main');
    await repositories.forNotebook('trpg');
    expect(opened).toHaveBeenCalledTimes(1);
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
    await expect(repositories.forNotebook('trpg')).rejects.toMatchObject({ status: 503, message: 'TRPG: Repository unavailable.' });
    expect((await repositories.forNotebook('life')).ref.id).toBe(home.id);
  });

  it('marks notebook repositories unmapped when nothing opens them', async () => {
    const [, trpgEntry] = await open().all();
    expect(trpgEntry).toMatchObject({ unavailable: { reason: 'unmapped' } });
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
