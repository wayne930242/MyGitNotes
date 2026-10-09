// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkingNoteCommit } from './useWorkingNoteCommit.js';
import { deletionEntry, readWorkingNotes, updateWorkingNote } from '../lib/working-notes.js';
import { draftStore, repositoryOf, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import type { FileChange, NoteItem } from '../lib/types.js';
import { documentDraftKey } from '../lib/use-workspace-document.js';
import { focusDocumentClient } from '../lib/use-focus-page.js';

const home: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'] };
const other: WorkspaceRepository = { id: 'github:me/campaign@main', alias: 'campaign', type: 'github', repository: 'me/campaign', branch: 'main', revision: 'b'.repeat(40), write: true, notebooks: ['campaign~trpg'] };
const repositories = [home, other];
const note = (path: string, notebookId: string, content: string, revision: string): NoteItem => ({ id: path, path, notebookId, title: path, content, metadata: {}, tags: [], revision });
const base = note('notes/life/a.md', 'notes~life', '# A', home.revision);
const change = (path: string, repository: WorkspaceRepository): FileChange => ({ path, repository: repository.id, kind: 'modified', tracked: true, revision: '', staged: false, unstaged: true });

let commits: any[];
function stubServer(failFor?: string) {
  commits = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (url === '/api/workspace?fresh=1') return new Response(JSON.stringify({ config: null, configRevision: home.revision, local: false, home: home.id, repositories }));
      if (url === '/api/notes/read-batch') return new Response(JSON.stringify({ notes: body.paths.map((path: string) => ({ ...base, path })) }));
      if (url === '/api/notes/commit') {
        commits.push(body);
        if (body.repository === failFor) return new Response(JSON.stringify({ error: 'The repository changed.', staleRepositories: [failFor] }), { status: 409 });
        return new Response(JSON.stringify({ revision: `${body.repository}-next`, commit: { commitHash: 'x' } }));
      }
      throw new Error(`Unexpected request ${url}`);
    }),
  );
}

function commitHook() {
  const stageWorkingNote = (draft: NoteItem, draftBase: NoteItem | null, blocked?: string, deleted?: boolean) => {
    updateWorkingNote(draftStore(repositoryOf(repositories, draft.notebookId)!), draft.path, { note: draft, base: draftBase, ...(blocked ? { blocked } : {}), ...(deleted ? { deleted: true as const } : {}) });
    return draft;
  };
  const clearCommittedDrafts = vi.fn();
  const setRepositoryRevision = vi.fn();
  const { result } = renderHook(() => useWorkingNoteCommit({ documents: [], sourceId: home.id, t: ((key: string, params?: Record<string, string>) => `${key} ${JSON.stringify(params ?? {})}`) as never, stageWorkingNote, clearCommittedDrafts, setRepositoryRevision, setActionError: vi.fn() }));
  return { ...result.current, clearCommittedDrafts, setRepositoryRevision };
}

beforeEach(() => {
  localStorage.clear();
  updateWorkingNote(draftStore(home), base.path, { note: { ...base, content: '# A edited' }, base });
  updateWorkingNote(draftStore(other), 'trpg/b.md', { note: note('trpg/b.md', 'campaign~trpg', '# B', other.revision), base: null });
});
afterEach(() => vi.unstubAllGlobals());

it('commits the drafts of each repository as one commit on that repository', async () => {
  stubServer();
  const { commitWorkingNotes, clearCommittedDrafts, setRepositoryRevision } = commitHook();
  await commitWorkingNotes([change(base.path, home), change('trpg/b.md', other)], 'docs: update');
  expect(commits.map(commit => [commit.repository, commit.revision, commit.notes.map((item: any) => item.path)])).toEqual([[home.id, home.revision, [base.path]], [other.id, other.revision, ['trpg/b.md']]]);
  expect(clearCommittedDrafts.mock.calls.map(([repository, sent]) => [repository.id, Object.keys(sent)])).toEqual([[home.id, [base.path]], [other.id, ['trpg/b.md']]]);
  expect(setRepositoryRevision.mock.calls).toEqual([[home.id, `${home.id}-next`], [other.id, `${other.id}-next`]]);
});

it('stops at the first repository that fails and names the repositories already committed', async () => {
  stubServer(other.id);
  const { commitWorkingNotes, clearCommittedDrafts, setRepositoryRevision } = commitHook();
  await expect(commitWorkingNotes([change(base.path, home), change('trpg/b.md', other)], 'docs: update')).rejects.toThrow(/changes\.partialCommit .*me\/notes.*The repository changed/);
  expect(clearCommittedDrafts.mock.calls.map(([repository]) => repository.id)).toEqual([home.id]);
  expect(setRepositoryRevision.mock.calls).toEqual([[home.id, `${home.id}-next`]]);
  expect(Object.keys(readWorkingNotes(draftStore(other)))).toEqual(['trpg/b.md']);
});

it('refuses a repository the requester may not write', async () => {
  stubServer();
  repositories[1] = { ...other, write: false };
  try {
    const { commitWorkingNotes } = commitHook();
    await expect(commitWorkingNotes([change('trpg/b.md', other)], 'docs: update')).rejects.toThrow(/write access/);
    expect(commits).toEqual([]);
  } finally {
    repositories[1] = other;
  }
});

it('commits equal paths of two repositories to their own repositories', async () => {
  stubServer();
  const twin = note(base.path, 'campaign~trpg', '# Twin', other.revision);
  updateWorkingNote(draftStore(other), base.path, { note: twin, base: null });
  const { commitWorkingNotes } = commitHook();
  await commitWorkingNotes([change(base.path, other)], 'docs: update');
  expect(commits.map(commit => [commit.repository, commit.notes.map((item: any) => item.content)])).toEqual([[other.id, ['# Twin']]]);
  expect(Object.keys(readWorkingNotes(draftStore(home)))).toEqual([base.path]);
});

it('commits a document draft with the group of the repository that holds it', async () => {
  stubServer();
  const page = { version: 1, focuses: [{ id: 'reading', notebookId: 'trpg', name: 'Reading', division: 'single', panes: [{ tabs: [] }] }] };
  localStorage.setItem(documentDraftKey(focusDocumentClient, other.id), JSON.stringify({ page, base: { version: 1, focuses: [] }, revision: other.revision }));
  const { commitWorkingNotes } = commitHook();
  await commitWorkingNotes([change('.github-notes-focus.yaml', other)], 'docs: focus');
  expect(commits.map(commit => [commit.repository, commit.documents.map((document: any) => document.path)])).toEqual([[other.id, ['.github-notes-focus.yaml']]]);
  // A draft saved before notebook keys stores the local id; the commit names the notebook by key for the server to store locally again.
  expect(commits[0].documents[0].page.focuses[0].notebookId).toBe('campaign~trpg');
  expect(localStorage.getItem(documentDraftKey(focusDocumentClient, other.id))).toBeNull();
});

it('commits a deletion as a delete entry when the note is as it was deleted', async () => {
  stubServer();
  updateWorkingNote(draftStore(home), base.path, deletionEntry(base));
  const { commitWorkingNotes, clearCommittedDrafts } = commitHook();
  await commitWorkingNotes([change(base.path, home)], 'docs: remove a');
  expect(commits[0].notes).toEqual([{ path: base.path, delete: true }]);
  expect(Object.keys(clearCommittedDrafts.mock.calls[0][1])).toEqual([base.path]);
});

it('blocks a deletion of a note that changed remotely since, keeping it in the trash', async () => {
  stubServer();
  updateWorkingNote(draftStore(home), base.path, deletionEntry({ ...base, content: '# Older A' }));
  const { commitWorkingNotes } = commitHook();
  await expect(commitWorkingNotes([change(base.path, home)], 'docs: remove a')).rejects.toThrow(/changed remotely after it was deleted/);
  expect(commits).toEqual([]);
  expect(readWorkingNotes(draftStore(home))[base.path]).toMatchObject({ deleted: true, blocked: expect.stringContaining('Restore it from the trash') });
});
