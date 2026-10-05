// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteItem } from '../lib/types.js';
import type { WorkingNote } from '../lib/working-notes.js';
import { useNoteMove } from './useNoteMove.js';

const files = vi.hoisted(() => ({ fetchFiles: vi.fn(), mutateFile: vi.fn() }));
vi.mock('../lib/files-api.js', () => files);
const lookup = vi.hoisted(() => ({ notes: [] as NoteItem[] }));
vi.mock('../lib/use-note-queries.js', () => ({ noteLookupOptions: () => ({ queryKey: ['lookup'], queryFn: async () => ({ notes: lookup.notes }) }) }));

const note: NoteItem = { id: 'idea', path: 'notes/idea.md', notebookId: 'nb', title: 'Idea', tags: [], metadata: {}, content: '# Idea' };
const config = { notebooks: [{ id: 'nb', root: 'notes' }] } as never;

function setup({ draft, focusTabs = [] as string[] }: { draft?: WorkingNote; focusTabs?: string[]; }) {
  const drafts = new Map<string, WorkingNote>(draft ? [[draft.note.path, draft]] : []);
  const focus = { page: { version: 1, focuses: [{ id: 'f', notebookId: 'nb', name: 'Focus', division: 'single', panes: [{ tabs: focusTabs.map(path => ({ kind: 'note', path })) }] }] }, change: vi.fn() };
  const params = {
    config,
    remote: true,
    canWriteNotebook: () => true,
    readDraft: (_: string, path: string) => drafts.get(path),
    updateDraft: vi.fn((_: string, path: string, entry: WorkingNote | null) => {
      if (entry) drafts.set(path, entry);
      else drafts.delete(path);
    }),
    stageWorkingNote: vi.fn((staged: NoteItem, base: NoteItem | null) => {
      drafts.set(staged.path, { note: staged, base });
      return staged;
    }),
    focus: focus as never,
    queryClient: new QueryClient(),
    queryScope: {} as never,
    flushEditors: vi.fn(async () => true),
    beforeFileChange: vi.fn(async () => {}),
    onFilesChanged: vi.fn(async () => {}),
    setActionError: vi.fn(),
    t: ((key: string) => key) as never,
  };
  const hook = renderHook(() => useNoteMove(params));
  const move = async (folder: string | null) => {
    act(() => hook.result.current.moveNote(note)?.());
    await act(() => hook.result.current.confirmMove(folder));
  };
  return { params, drafts, focus, move };
}

beforeEach(() => {
  vi.clearAllMocks();
  lookup.notes = [];
});

describe('useNoteMove', () => {
  it('re-keys a never-committed remote draft, with its Focus tab, instead of moving a file', async () => {
    const { params, drafts, focus, move } = setup({ draft: { note, base: null }, focusTabs: ['notes/idea.md', 'notes/other.md'] });
    await move('work');
    expect(params.setActionError).toHaveBeenLastCalledWith('');
    expect([...drafts.keys()]).toEqual(['notes/work/idea.md']);
    expect(drafts.get('notes/work/idea.md')).toMatchObject({ base: null, note: { path: 'notes/work/idea.md', content: '# Idea' } });
    expect(focus.change).toHaveBeenCalledOnce();
    expect(focus.change.mock.calls[0][0].focuses[0].panes[0].tabs.map((tab: { path: string; }) => tab.path)).toEqual(['notes/work/idea.md', 'notes/other.md']);
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ pathMap: { 'notes/idea.md': 'notes/work/idea.md' } }));
    expect(files.mutateFile).not.toHaveBeenCalled();
    expect(params.beforeFileChange).not.toHaveBeenCalled();
  });

  it('refuses to re-key a draft onto a note that already exists there', async () => {
    lookup.notes = [{ ...note, path: 'notes/work/idea.md' }];
    const { params, drafts, move } = setup({ draft: { note, base: null } });
    await move('work');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.moveTaken');
    expect([...drafts.keys()]).toEqual(['notes/idea.md']);
    expect(params.onFilesChanged).not.toHaveBeenCalled();
  });

  it('moves a committed note as a file after saving the open editors', async () => {
    files.fetchFiles.mockResolvedValue({ revision: 'r1' });
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/work/idea.md' }, deletedPaths: [] });
    const { params, move } = setup({});
    await move('work');
    expect(params.flushEditors).toHaveBeenCalled();
    expect(params.beforeFileChange).toHaveBeenCalled();
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/idea.md', destination: 'notes/work/idea.md' }, 'r1');
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ revision: 'r2' }));
  });
});
