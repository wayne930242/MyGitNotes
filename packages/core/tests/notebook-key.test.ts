import { describe, expect, it, vi } from 'vitest';
import { deriveAlias, isBareNotebookId, keyedItem, localIdIn, notebookKey, parseNotebookKey, repositoryName } from '../src/notebook-key.js';
import { repositoryRef } from '../src/repository.js';
import type { WorkspaceConfig } from '../src/types.js';
import type { WorkspaceMember } from '../src/workspace-config-source.js';
import { createWorkspaceRepositories } from '../src/workspace-repositories.js';

describe('notebook keys', () => {
  it('joins an alias and a local id and parses them back', () => {
    expect(notebookKey('kb', 'blog')).toBe('kb~blog');
    expect(parseNotebookKey('kb~blog')).toEqual({ alias: 'kb', localId: 'blog' });
    expect(localIdIn('kb', 'kb~blog')).toBe('blog');
    expect(localIdIn('other', 'kb~blog')).toBeNull();
    expect(keyedItem('kb')({ notebookId: 'blog', path: 'a.md' })).toEqual({ notebookId: 'kb~blog', path: 'a.md' });
  });

  it('tells a bare local id from a key and from anything else', () => {
    expect(parseNotebookKey('blog')).toBeNull();
    expect(isBareNotebookId('blog')).toBe(true);
    expect(isBareNotebookId('kb~blog')).toBe(false);
    for (const value of ['~blog', 'kb~', 'KB~blog', 'kb~blog~x', 'kb~bl og', `${'a'.repeat(41)}~blog`]) expect(parseNotebookKey(value)).toBeNull();
    expect(() => notebookKey('Kb', 'blog')).toThrow(/alias/);
    expect(() => notebookKey('kb', 'a/b')).toThrow(/notebook id/);
  });

  it('names a notebook whose local id is all by its key, apart from the every-notebook value', () => {
    expect(notebookKey('kb', 'all')).toBe('kb~all');
    expect(parseNotebookKey('kb~all')).toEqual({ alias: 'kb', localId: 'all' });
  });
});

describe('alias derivation', () => {
  it('lowercases the repository name and replaces characters outside the alias pattern', () => {
    expect(deriveAlias('owner/My_Notes.v2', new Set())).toBe('my-notes-v2');
    expect(deriveAlias('/Users/me/Knowledge Base', new Set())).toBe('knowledge-base');
    expect(deriveAlias('owner/--dash', new Set())).toBe('dash');
    expect(deriveAlias('owner/___', new Set())).toBe('repository');
    expect(repositoryName({ type: 'local', path: '/tmp/demo-workspace/' })).toBe('demo-workspace');
    expect(repositoryName({ type: 'github', repository: 'owner/notes', branch: 'main' })).toBe('notes');
  });

  it('keeps at most 40 characters and suffixes a taken alias within that limit', () => {
    const long = 'n'.repeat(50);
    expect(deriveAlias(long, new Set())).toBe('n'.repeat(40));
    expect(deriveAlias(long, new Set(['n'.repeat(40)]))).toBe(`${'n'.repeat(38)}-2`);
    expect(deriveAlias('notes', new Set(['notes', 'notes-2']))).toBe('notes-3');
  });
});

describe('workspace notebooks by key', () => {
  const kb = repositoryRef({ type: 'github', repository: 'owner/kb', branch: 'main' });
  const campaign = repositoryRef({ type: 'github', repository: 'owner/campaign', branch: 'main' });
  const manifests: Record<string, WorkspaceConfig> = { [kb.id]: { schema_version: 4, workspace: { title: 'Test', default_notebook: 'blog' }, notebooks: [{ id: 'blog', title: 'Blog', root: 'blog' }, { id: 'all', title: 'All', root: 'all' }, { id: 'shared', title: 'Shared', root: 'shared' }] }, [campaign.id]: { schema_version: 4, workspace: { title: 'Campaign', default_notebook: 'trpg' }, notebooks: [{ id: 'trpg', title: 'TRPG', root: 'notes' }, { id: 'shared', title: 'Shared', root: 'shared' }] } };
  const members = [{ ref: kb, alias: 'kb', default: true, hidden: false }, { ref: campaign, alias: 'campaign', default: false, hidden: false }];
  const repositories = () => createWorkspaceRepositories<WorkspaceMember>({ members, openRepository: async member => member, manifest: member => ({ read: async () => ({ state: 'file' as const, config: manifests[member.ref.id], revision: 'a'.repeat(40) }), save: vi.fn() }) });

  it("serves each repository's own notebooks under its alias", async () => {
    const workspace = repositories();
    expect(workspace.default?.alias).toBe('kb');
    expect((await workspace.all()).map(entry => [entry.alias, entry.notebooks.map(notebook => [notebook.id, notebook.key])])).toEqual([['kb', [['blog', 'kb~blog'], ['all', 'kb~all'], ['shared', 'kb~shared']]], ['campaign', [['trpg', 'campaign~trpg'], ['shared', 'campaign~shared']]]]);
    expect((await workspace.forNotebook('kb~all')).notebook.id).toBe('all');
    expect((await workspace.forNotebook('campaign~trpg')).ref.id).toBe('github:owner/campaign@main');
    expect((await workspace.forNotebook('campaign~shared')).ref.id).toBe('github:owner/campaign@main');
  });

  it('resolves a bare local id to the one repository that has it, else to the default repository', async () => {
    const workspace = repositories();
    expect(await workspace.resolveBareId('trpg')).toBe('campaign~trpg');
    expect(await workspace.resolveBareId('blog')).toBe('kb~blog');
    expect(await workspace.resolveBareId('shared')).toBe('kb~shared');
    expect(await workspace.resolveBareId('missing')).toBeNull();
    expect(await workspace.resolveBareId('kb~blog')).toBeNull();
  });
});
