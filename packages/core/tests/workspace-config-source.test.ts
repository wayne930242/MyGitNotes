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
    expect(await repositories.home.handle.scope()).toBe(config);
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
