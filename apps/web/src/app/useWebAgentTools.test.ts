// @vitest-environment jsdom
import { noteRefKey } from '@mygitnotes/core/note-query';
import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useWebAgentTools } from './useWebAgentTools.js';
import { readWorkingNotes, updateWorkingNote, type WorkingNote, type WorkingNotes } from '../lib/working-notes.js';
import { draftScope, draftStore, type WorkspaceRepository } from '../lib/workspace-repositories.js';
import { externalEditCount } from '../lib/external-note-edits.js';
import { saveLocalDraft } from '../lib/storage.js';
import type { NoteItem } from '../lib/types.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';

const repository: WorkspaceRepository = { id: 'github:me/notes@main', alias: 'notes', type: 'github', repository: 'me/notes', branch: 'main', revision: 'a'.repeat(40), write: true, notebooks: ['notes~life'], title: 'notes', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
const scope = draftScope(repository);
const store = draftStore(repository);
const committed = (path: string, content: string, metadata: Record<string, unknown> = {}): NoteItem => ({ id: path, path, notebookId: 'notes~life', title: path, content, metadata, tags: [], revision: repository.revision });
const server = new Map<string, NoteItem>();

function tools({ writable = true } = {}) {
  const readDraft = (_notebookId: string, path: string) => readWorkingNotes(store)[path];
  const updateDraft = (_notebookId: string, path: string, entry: WorkingNote | null) => {
    updateWorkingNote(store, path, entry);
  };
  const stageWorkingNote = vi.fn((note: NoteItem, base: NoteItem | null, blocked?: string, deleted?: boolean) => {
    updateWorkingNote(store, note.path, { note, base, ...(blocked ? { blocked } : {}), ...(deleted && base ? { deleted: true as const } : {}) });
    return note;
  });
  const active = (): WorkingNotes => Object.fromEntries(Object.values(readWorkingNotes(store)).map(entry => [noteRefKey(entry.note), entry]));
  const { result } = renderHook(() => useWebAgentTools({ config: { workspace: { title: 'Notes' }, notebooks: [{ id: 'notes~life', title: 'Life', root: 'notes' }] } as never, activeWorkingNotes: active(), repositoryFor: () => repository, canWriteNotebook: () => writable, revisionFor: () => repository.revision, readDraft, updateDraft, stageWorkingNote, findCommittedNote: async ref => server.get(ref.path) ?? null, resolveBareNotebook: localId => localId === 'life' ? 'notes~life' : null }));
  return { call: result.current, stageWorkingNote };
}

beforeEach(() => {
  localStorage.clear();
  server.clear();
  server.set('notes/plan.md', committed('notes/plan.md', '# Plan\n\nship it\n', { status: 'working' }));
});

it('reads the committed note, then the working change once the agent wrote one, and never commits', async () => {
  const { call } = tools();
  expect(await call('read_note', { path: 'notes/plan.md' })).toMatchObject({ source: 'committed', content: '# Plan\n\nship it\n' });
  const before = externalEditCount(noteRefKey({ notebookId: 'notes~life', path: 'notes/plan.md' }));
  expect(await call('write_note', { path: 'notes/plan.md', content: '# Plan\n\nshipped\n', metadata: { status: 'done' } })).toMatchObject({ source: 'working', created: false });
  const entry = readWorkingNotes(store)['notes/plan.md'];
  expect(entry.base?.content).toBe('# Plan\n\nship it\n');
  expect(entry.note).toMatchObject({ content: '# Plan\n\nshipped\n', metadata: { status: 'done' } });
  expect(externalEditCount(noteRefKey({ notebookId: 'notes~life', path: 'notes/plan.md' }))).toBe(before + 1);
  expect(await call('read_note', { path: 'notes/plan.md' })).toMatchObject({ source: 'working', content: '# Plan\n\nshipped\n' });
});

it('accepts a bare notebook id as tool calls from before notebook keys name it, and returns the key', async () => {
  const { call } = tools();
  expect(await call('read_note', { path: 'notes/plan.md', notebookId: 'life' })).toMatchObject({ notebookId: 'notes~life', source: 'committed' });
  await expect(call('read_note', { path: 'notes/plan.md', notebookId: 'work' })).rejects.toThrow('not inside notebook work');
});

it('creates a note, edits one exact occurrence, and keeps frontmatter keys it was not given', async () => {
  const { call } = tools();
  expect(await call('write_note', { path: 'notes/new.md', content: 'hello world', metadata: { title: 'New' } })).toMatchObject({ created: true });
  expect(readWorkingNotes(store)['notes/new.md'].base).toBeNull();
  await call('edit_note', { path: 'notes/plan.md', oldText: 'ship it', newText: 'shipped' });
  expect(readWorkingNotes(store)['notes/plan.md'].note).toMatchObject({ content: '# Plan\n\nshipped\n', metadata: { status: 'working' } });
  await expect(call('edit_note', { path: 'notes/plan.md', oldText: 'absent', newText: 'x' })).rejects.toThrow('does not occur');
  await expect(call('edit_note', { path: 'notes/new.md', oldText: 'l', newText: 'L' })).rejects.toThrow('occurs 3 times');
});

it('moves a committed note to the trash as a deletion, and drops a note that exists only as a working change', async () => {
  const { call } = tools();
  expect(await call('delete_note', { path: 'notes/plan.md' })).toEqual({ path: 'notes/plan.md', notebookId: 'notes~life', deleted: true, trashed: true });
  expect(readWorkingNotes(store)['notes/plan.md']).toMatchObject({ deleted: true, base: { content: '# Plan\n\nship it\n' } });
  await expect(call('read_note', { path: 'notes/plan.md' })).rejects.toThrow('waits in their trash');
  await expect(call('delete_note', { path: 'notes/plan.md' })).rejects.toThrow('already deleted');
  await call('write_note', { path: 'notes/new.md', content: 'x' });
  expect(await call('delete_note', { path: 'notes/new.md' })).toMatchObject({ trashed: false });
  expect(readWorkingNotes(store)['notes/new.md']).toBeUndefined();
  // The page renders again after each change; a fresh render lists what is staged now.
  const { changes } = await tools().call('list_changes', {}) as { changes: { path: string; kind: string; diff: string; }[]; };
  expect(changes).toEqual([expect.objectContaining({ path: 'notes/plan.md', kind: 'deleted', diff: expect.stringContaining('-ship it') })]);
});

it('refuses a note with typing not yet saved, a read-only notebook, and a path outside every notebook', async () => {
  saveLocalDraft(scope, 'notes/plan.md', '# Plan\n\ntyping', {});
  await expect(tools().call('write_note', { path: 'notes/plan.md', content: 'x' })).rejects.toThrow('The person is editing notes/plan.md');
  await expect(tools().call('delete_note', { path: 'notes/plan.md' })).rejects.toThrow('editing');
  await expect(tools({ writable: false }).call('write_note', { path: 'notes/other.md', content: 'x' })).rejects.toThrow('read-only');
  await expect(tools().call('write_note', { path: 'elsewhere/a.md', content: 'x' })).rejects.toThrow('not inside any notebook');
  await expect(tools().call('read_note', { path: 'notes/../secret.md' })).rejects.toThrow('not a note path');
  await expect(tools().call('commit', {})).rejects.toThrow('Unknown note tool');
});
