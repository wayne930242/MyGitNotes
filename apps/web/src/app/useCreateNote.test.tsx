// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNewNoteDialog } from './useNewNoteDialog.js';
import type { NoteItem } from '../lib/types.js';
const api = vi.hoisted(() => ({ saveNote: vi.fn(), fetchGitStatus: vi.fn(), renderNoteTemplate: vi.fn() }));
vi.mock('../lib/api.js', () => api);
type Params = Parameters<typeof useNewNoteDialog>[0];
function params(overrides: Partial<Params> = {}): Params {
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, 'fetchQuery').mockResolvedValue({ notes: [] });
  return { config: { notebooks: [{ id: 'a', root: 'notes/shared', title: 'A', templates: [{ id: 'template', title: 'Template', file: 'template.md' }] }] }, selectedNotebookId: 'a', setSelectedNotebookId: vi.fn(), folders: [{ notebookId: 'a', path: 'sub', title: 'Sub', order: 0 }], remote: false, canWrite: true, readDraft: () => undefined, queryClient, queryScope: { sourceId: 'local:a', revisions: {}, repositories: { a: 'local:a' }, drafts: {} }, stageWorkingNote: vi.fn(note => note), revisionFor: () => 'head', invalidateNotes: vi.fn(), setGitStatus: vi.fn(), newNoteStatuses: ['inbox'], sourceId: 'local:a', t: key => key, onCreated: vi.fn(), ...overrides };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.fetchGitStatus.mockResolvedValue({ status: {} });
  api.saveNote.mockImplementation(async input => ({ note: { ...input, id: 'new', title: input.metadata.title, tags: [] } }));
});
afterEach(cleanup);
it('creates several native outlines with the compound suffix, no template and worktree-only saves', async () => {
  const input = params();
  const hook = renderHook(useNewNoteDialog, { initialProps: input });
  for (const title of ['First plan', 'Second plan']) {
    act(() => hook.result.current.openNewNote({ kind: 'outline', folder: 'sub' }));
    act(() => {
      hook.result.current.setNewNoteTitle(title);
      hook.result.current.setNewNoteTemplateId('template');
    });
    await act(() => hook.result.current.handleCreateNewNote());
  }
  expect(api.saveNote.mock.calls.map(([input]) => input.path)).toEqual(['notes/shared/sub/first-plan.outline.md', 'notes/shared/sub/second-plan.outline.md']);
  expect(api.saveNote.mock.calls[0][0]).toMatchObject({ createOnly: true, noCommit: true, notebookId: 'a', content: '- ', metadata: { title: 'First plan', status: 'inbox' } });
  expect(api.renderNoteTemplate).not.toHaveBeenCalled();
  expect(input.onCreated).toHaveBeenCalledTimes(2);
});
it('stages a linked remote outline with native metadata and no save API/forced commit', async () => {
  const input = params({ remote: true });
  const hook = renderHook(useNewNoteDialog, { initialProps: input });
  act(() => hook.result.current.openNewNote({ kind: 'outline', folder: 'sub', initialLink: { notebookId: 'a', path: 'notes/shared/source.compilation.yml', title: 'Source' } }));
  act(() => hook.result.current.setNewNoteTitle('Linked plan'));
  await act(() => hook.result.current.handleCreateNewNote());
  expect(input.stageWorkingNote).toHaveBeenCalledWith(expect.objectContaining({ kind: 'outline', path: 'notes/shared/sub/linked-plan.outline.md', content: '- [Source](../source.compilation.yml)' }), null);
  expect(api.saveNote).not.toHaveBeenCalled();
});
it('keeps New note ordinary even after an outline creation and does not report status refresh as creation failure', async () => {
  const input = params();
  const hook = renderHook(useNewNoteDialog, { initialProps: input });
  act(() => hook.result.current.openNewNote({ kind: 'outline' }));
  act(() => hook.result.current.cancelNewNote());
  act(() => hook.result.current.openNewNote());
  act(() => hook.result.current.setNewNoteTitle('Ordinary'));
  api.fetchGitStatus.mockRejectedValueOnce(new Error('offline'));
  await act(() => hook.result.current.handleCreateNewNote());
  expect(api.saveNote).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/shared/ordinary.md', content: '# Ordinary\n\nWrite your note here.\n' }));
  expect(input.onCreated).toHaveBeenCalledOnce();
  expect(hook.result.current.createError).toBe('');
});
it.each(['cancel', 'repository', 'read-only'] as const)('does not create after %s during collision lookup', async reason => {
  const input = params();
  let finish!: (value: { notes: NoteItem[]; }) => void;
  vi.mocked(input.queryClient.fetchQuery).mockReturnValue(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const hook = renderHook(useNewNoteDialog, { initialProps: input });
  act(() => hook.result.current.openNewNote({ kind: 'outline' }));
  act(() => hook.result.current.setNewNoteTitle('Plan'));
  let operation!: Promise<void>;
  act(() => {
    operation = hook.result.current.handleCreateNewNote();
  });
  if (reason === 'cancel') act(() => hook.result.current.cancelNewNote());
  if (reason === 'repository') hook.rerender({ ...input, sourceId: 'local:b', selectedNotebookId: 'b' });
  if (reason === 'read-only') hook.rerender({ ...input, canWrite: false });
  await act(async () => {
    finish({ notes: [] });
    await operation;
  });
  expect(api.saveNote).not.toHaveBeenCalled();
  expect(input.stageWorkingNote).not.toHaveBeenCalled();
});
it('refuses an existing outline or a cross-notebook initial link without altering it', async () => {
  const input = params();
  const hook = renderHook(useNewNoteDialog, { initialProps: input });
  act(() => hook.result.current.openNewNote({ kind: 'outline', initialLink: { notebookId: 'b', path: 'notes/shared/same.md', title: 'Wrong owner' } }));
  act(() => hook.result.current.setNewNoteTitle('Plan'));
  await act(() => hook.result.current.handleCreateNewNote());
  expect(hook.result.current.createError).toBe('outline.changed');
  expect(api.saveNote).not.toHaveBeenCalled();
  act(() => hook.result.current.openNewNote({ kind: 'outline' }));
  act(() => hook.result.current.setNewNoteTitle('Plan'));
  vi.mocked(input.queryClient.fetchQuery).mockResolvedValue({ notes: [{ path: 'notes/shared/plan.outline.md' }] });
  await act(() => hook.result.current.handleCreateNewNote());
  expect(hook.result.current.createError).toContain('already exists');
  expect(api.saveNote).not.toHaveBeenCalled();
});
