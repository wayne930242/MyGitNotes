import { describe, expect, it } from 'vitest';
import { draftScope, groupByRepository, notebookRepositories, pageRepository, repositoryOf, revisionSet, type WorkspaceRepository } from './workspace-repositories.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';

const home: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life', 'notes~work'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const other: WorkspaceRepository = { id: 'github:me/campaign@main', alias: 'campaign', type: 'github', repository: 'me/campaign', branch: 'main', revision: 'b'.repeat(40), write: false, notebooks: ['campaign~trpg'], title: 'campaign', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };

describe('workspace repositories', () => {
  it('keeps the home repository drafts under the scope the workspace used before', () => {
    // Earlier releases stored drafts under `${source identity}:${branch}`; the home repository id is that identity.
    expect(draftScope(home)).toBe('github:me/notes@main:main');
  });

  it('maps notebooks to repositories and collects their revisions', () => {
    expect(repositoryOf([home, other], 'campaign~trpg')).toBe(other);
    expect(repositoryOf([home, other], 'missing')).toBeUndefined();
    expect(notebookRepositories([home, other])).toEqual({ 'notes~life': home.id, 'notes~work': home.id, 'campaign~trpg': other.id });
    expect(revisionSet([home, { ...other, revision: '' }])).toEqual({ [home.id]: home.revision });
  });

  it('groups items by repository in the order their notebooks first appear', () => {
    const items = [{ notebookId: 'campaign~trpg', path: 'a' }, { notebookId: 'notes~life', path: 'b' }, { notebookId: 'campaign~trpg', path: 'c' }];
    expect(groupByRepository([home, other], items, item => item.notebookId).map(group => [group.repository.id, group.items.map(item => item.path)])).toEqual([[other.id, ['a', 'c']], [home.id, ['b']]]);
    expect(() => groupByRepository([home], [{ notebookId: 'campaign~trpg' }], item => item.notebookId)).toThrow(/not served/);
  });

  it("belongs a page to the shown notebook's repository, and to the default repository where no single notebook is shown", () => {
    const page = (tab: string, notebookId: string, allNotebooks = false) => pageRepository([home, other], home.id, { tab, notebookId, allNotebooks })?.id;
    expect(page('notes', 'campaign~trpg')).toBe(other.id);
    expect(page('graph', 'campaign~trpg')).toBe(other.id);
    expect(page('notes', 'notes~life')).toBe(home.id);
    expect(page('settings', 'campaign~trpg')).toBe(home.id);
    expect(page('agent', 'campaign~trpg')).toBe(home.id);
    expect(page('notes', 'campaign~trpg', true)).toBe(home.id);
    expect(page('notes', 'gone~x')).toBe(home.id);
    expect(pageRepository([], '', { tab: 'notes', notebookId: 'x', allNotebooks: false })).toBeUndefined();
  });
});
