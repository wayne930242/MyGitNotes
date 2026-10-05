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
const api = vi.hoisted(() => ({ readNote: vi.fn() }));
vi.mock('../lib/api.js', () => api);
vi.mock('../lib/use-note-queries.js', () => ({ noteLookupOptions: () => ({ queryKey: ['lookup'], queryFn: async () => ({ notes: lookup.notes }) }) }));

const note: NoteItem = { id: 'idea', path: 'notes/idea.md', notebookId: 'nb', title: 'Idea', tags: [], metadata: {}, content: '# Idea' };
const config = { notebooks: [{ id: 'nb', root: 'notes' }] } as never;

function setup({ draft, focusTabs = [] as string[], remote = true }: { draft?: WorkingNote; focusTabs?: string[]; remote?: boolean; }) {
  const order: string[] = [];
  const drafts = new Map<string, WorkingNote>(draft ? [[draft.note.path, draft]] : []);
  const focus = { page: { version: 1, focuses: [{ id: 'f', notebookId: 'nb', name: 'Focus', division: 'single', panes: [{ tabs: focusTabs.map(path => ({ kind: 'note', path })) }] }] }, change: vi.fn() };
  const params = {
    config,
    remote,
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
    saveNote: vi.fn(async (input: { path: string; }) => {
      order.push(`save ${input.path}`);
      return note;
    }),
    focus: focus as never,
    queryClient: new QueryClient(),
    queryScope: {} as never,
    flushEditors: vi.fn(async () => true),
    beforeFileChange: vi.fn(async () => {}),
    onFilesChanged: vi.fn(async () => {
      order.push('files changed');
    }),
    setActionError: vi.fn(),
    t: ((key: string) => key) as never,
  };
  const hook = renderHook(() => useNoteMove(params));
  const move = async (folder: string | null) => {
    act(() => hook.result.current.moveNote(note)?.());
    await act(() => hook.result.current.confirmMove(folder));
  };
  const rename = async (title: string, target: NoteItem = note, applyTitle?: (title: string) => void) => {
    act(() => hook.result.current.renameNote(target, applyTitle)?.());
    await act(() => hook.result.current.confirmRename(title));
  };
  return { params, drafts, focus, move, rename, order };
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

  it('renames a never-committed draft: a new file name and the heading that titles it', async () => {
    const { params, drafts, rename } = setup({ draft: { note: { ...note, path: 'notes/untitled.md', content: '# Untitled\n\nBody.\n' }, base: null } });
    await rename('讀書 計畫', { ...note, path: 'notes/untitled.md' });
    expect([...drafts.keys()]).toEqual(['notes/讀書-計畫.md']);
    expect(drafts.get('notes/讀書-計畫.md')?.note).toMatchObject({ content: '# 讀書 計畫\n\nBody.\n', title: '讀書 計畫' });
    expect(params.onFilesChanged).toHaveBeenCalledWith(expect.objectContaining({ pathMap: { 'notes/untitled.md': 'notes/讀書-計畫.md' } }));
    expect(params.saveNote).not.toHaveBeenCalled();
  });

  it('renames a local file, then saves the new title where it now lies before the editor reopens it', async () => {
    files.fetchFiles.mockResolvedValue({ revision: 'r1' });
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: { 'notes/idea.md': 'notes/plans.md' }, deletedPaths: [] });
    api.readNote.mockResolvedValue({ ...note, path: 'notes/plans.md', metadata: { status: 'inbox' } });
    const { params, rename, order } = setup({ remote: false });
    await rename('Plans');
    expect(files.mutateFile).toHaveBeenCalledWith({ kind: 'move', notebookId: 'nb', path: 'notes/idea.md', destination: 'notes/plans.md' }, 'r1');
    expect(params.saveNote).toHaveBeenCalledWith({ path: 'notes/plans.md', notebookId: 'nb', content: '# Plans', metadata: { status: 'inbox' } });
    expect(order).toEqual(['save notes/plans.md', 'files changed']);
  });

  it('lets a compilation apply its own new name, and only moves its file', async () => {
    files.fetchFiles.mockResolvedValue({ revision: 'r1' });
    files.mutateFile.mockResolvedValue({ revision: 'r2', selectedPath: '', pathMap: {}, deletedPaths: [] });
    const applyTitle = vi.fn();
    const compilation = { ...note, path: 'notes/untitled.compilation.yml', title: 'Untitled compilation' };
    const { params, rename } = setup({ remote: false });
    await rename('Reading list', compilation, applyTitle);
    expect(applyTitle).toHaveBeenCalledWith('Reading list');
    expect(files.mutateFile).toHaveBeenCalledWith(expect.objectContaining({ destination: 'notes/reading-list.compilation.yml' }), 'r1');
    expect(params.saveNote).not.toHaveBeenCalled();
  });

  it('refuses a name with nothing to name a file after', async () => {
    const { params, rename } = setup({});
    await rename('!!!');
    expect(params.setActionError).toHaveBeenLastCalledWith('files.renameInvalid');
    expect(params.flushEditors).not.toHaveBeenCalled();
  });
});
