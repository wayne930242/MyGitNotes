// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCreateNote } from './useCreateNote.js';
import type { NoteItem } from '../lib/types.js';
const api = vi.hoisted(() => ({ saveNote: vi.fn(), fetchGitStatus: vi.fn(), renderNoteTemplate: vi.fn() }));
vi.mock('../lib/api.js', () => api);
type Params = Parameters<typeof useCreateNote>[0];
function params(overrides: Partial<Params> = {}): Params {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'fetchQuery').mockResolvedValue({ notes: [] });
  return { config: { notebooks: [{ id: 'a', root: 'notes/shared', title: 'A', templates: [{ id: 'template', title: 'Template', file: 'template.md' }] }, { id: 'b', root: 'notes/b', title: 'B' }] }, selectedNotebookId: 'a', setSelectedNotebookId: vi.fn(), folders: [{ notebookId: 'a', path: 'sub', title: 'Sub', order: 0 }], remote: false, canWrite: true, readDraft: () => undefined, queryClient, queryScope: { sourceId: 'local:a', revisions: {}, repositories: { a: 'local:a' }, drafts: {} }, stageWorkingNote: vi.fn(note => note), revisionFor: () => 'head', invalidateNotes: vi.fn(), setGitStatus: vi.fn(), newNoteStatuses: ['inbox'], sourceId: 'local:a', t: (key: string) => key === 'createNote.untitled' ? 'Untitled' : key, onCreated: vi.fn(), onError: vi.fn(), ...overrides } as Params;
}
const lookupReturns = (input: Params, paths: string[]) => vi.mocked(input.queryClient.fetchQuery).mockResolvedValue({ notes: paths.map(path => ({ path })) });
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchGitStatus.mockResolvedValue({ status: {} });
  api.saveNote.mockImplementation(async input => ({ note: { ...input, id: 'new', title: 'Untitled', tags: [] } }));
  api.renderNoteTemplate.mockResolvedValue({ content: '# Untitled\n\nFrom template.\n', metadata: { title: 'Untitled', kind: 'reading' } });
});
afterEach(cleanup);

it('creates a note at once at the notebook root, titled by its heading', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote());
  expect(api.saveNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/shared/untitled.md', content: '# Untitled\n\nWrite your note here.\n', createOnly: true, noCommit: true }));
  // No title field: the heading names the note, so editing it renames the note.
  expect(api.saveNote.mock.calls[0][0].metadata).toEqual({ id: 'untitled', tags: [], status: 'inbox' });
  expect(input.onCreated).toHaveBeenCalledOnce();
});

it('numbers the untitled name past existing notes and remote drafts', async () => {
  const input = params({ remote: true, readDraft: (_: string, path: string) => path === 'notes/shared/untitled-2.md' ? { note: {} as NoteItem, base: null } : undefined });
  lookupReturns(input, ['notes/shared/untitled.md']);
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote());
  expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/shared/untitled-3.md', id: 'untitled-3' }), null);
  expect(api.saveNote).not.toHaveBeenCalled();
});

it('creates native outlines with the compound suffix and no template', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', templateId: 'template' }));
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/untitled.outline.md', content: '- ', metadata: { title: 'Untitled', status: 'inbox' } });
  expect(api.renderNoteTemplate).not.toHaveBeenCalled();
});

it('creates a note from a template, and in the folder a compilation lane draws from', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ templateId: 'template', folder: 'sub', tag: 'reading' }));
  expect(api.renderNoteTemplate).toHaveBeenCalledWith({ notebookId: 'a', templateId: 'template', title: 'Untitled' });
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ path: 'notes/shared/sub/untitled.md', content: '# Untitled\n\nFrom template.\n', metadata: { kind: 'reading', tags: ['reading'] } });
});

it('stages a linked remote outline with native metadata and no save API', async () => {
  const input = params({ remote: true });
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', initialLink: { notebookId: 'a', path: 'notes/shared/source.compilation.yml', title: 'Source' } }));
  expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'outline', path: 'notes/shared/untitled.outline.md', content: '- [Source](source.compilation.yml)' }), null);
  expect(api.saveNote).not.toHaveBeenCalled();
});

it('switches to another notebook first, then creates there', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', notebookId: 'b' }));
  expect(input.setSelectedNotebookId).toHaveBeenCalledWith('b');
  expect(api.saveNote).not.toHaveBeenCalled();
  await act(async () => {
    hook.rerender({ ...input, selectedNotebookId: 'b', queryScope: { ...input.queryScope, repositories: { b: 'local:a' } } });
  });
  await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notebookId: 'b', path: 'notes/b/untitled.outline.md' })));
});

it.each(['repository', 'read-only'] as const)('does not create after a %s change during the name lookup', async reason => {
  const input = params();
  let finish!: (value: { notes: NoteItem[]; }) => void;
  vi.mocked(input.queryClient.fetchQuery).mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const hook = renderHook(useCreateNote, { initialProps: input });
  let operation!: Promise<void>;
  act(() => {
    operation = hook.result.current.createNote();
  });
  if (reason === 'repository') hook.rerender({ ...input, sourceId: 'local:b', selectedNotebookId: 'b' });
  if (reason === 'read-only') hook.rerender({ ...input, canWrite: false });
  await act(async () => {
    finish({ notes: [] });
    await operation;
  });
  expect(api.saveNote).not.toHaveBeenCalled();
  expect(input.stageWorkingNote).not.toHaveBeenCalled();
});

it('refuses a cross-notebook initial link without creating anything', async () => {
  const input = params();
  const hook = renderHook(useCreateNote, { initialProps: input });
  await act(() => hook.result.current.createNote({ kind: 'outline', initialLink: { notebookId: 'b', path: 'notes/b/same.md', title: 'Wrong owner' } }));
  expect(input.onError).toHaveBeenLastCalledWith('outline.changed');
  expect(api.saveNote).not.toHaveBeenCalled();
});
