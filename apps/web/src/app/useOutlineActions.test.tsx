// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOutlineActions } from './useOutlineActions.js';
import type { NoteItem } from '../lib/types.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/api.js', () => ({ readNote: read }));
vi.mock('../lib/i18n/index.js', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const source: NoteItem = { notebookId: 'a', path: 'notes/shared/source.md', title: 'Source', id: 's', content: 'dirty source', tags: [], metadata: {} };
const destination = { ...source, path: 'notes/shared/plan.outline.md', title: 'Plan', content: '- Saved' };
const repository = { id: 'github:a/repo@main', alias: 'repo', type: 'github' as const, branch: 'main', revision: 'head', write: true, notebooks: ['a'], title: 'repo', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' };
type Params = Parameters<typeof useOutlineActions>[0];
function params(overrides: Partial<Params> = {}): Params {
  return { config: { schema_version: 3, workspace: { title: 'QA', default_notebook: 'a' }, notebooks: [{ id: 'a', root: 'notes/shared', title: 'A' }, { id: 'b', root: 'notes/shared', title: 'B' }] }, repositoryFor: id => id === 'a' ? repository : { ...repository, id: 'github:b/repo@main', notebooks: ['b'] }, readDraft: () => undefined, remote: false, sourceId: repository.id, selectedNotebookId: 'a', locationKey: 'source', routedRef: source, prepareLeave: vi.fn(async () => true), openNote: vi.fn(async () => {}), openNewNote: vi.fn(), onError: vi.fn(), ...overrides };
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  read.mockReset();
  read.mockResolvedValue(destination);
});
afterEach(cleanup);
it('opens the repository-qualified destination and lets only its mounted owner consume once', async () => {
  const input = params();
  const hook = renderHook(useOutlineActions, { initialProps: input });
  act(() => hook.result.current.value.add(source));
  await act(() => hook.result.current.choose(destination));
  expect(input.prepareLeave).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith(destination.path, 'a');
  expect(input.openNote).toHaveBeenCalledWith(destination);
  expect(hook.result.current.value.pending).toBeNull(); // not mounted/routed yet
  hook.rerender({ ...input, locationKey: 'destination', routedRef: destination });
  const id = hook.result.current.value.pending!.id;
  act(() => {
    expect(hook.result.current.value.consume(id)).toBe(true);
    expect(hook.result.current.value.consume(id)).toBe(false);
  });
  expect(hook.result.current.value.pending).toBeNull();
});
it('uses the staged destination and native new-outline creation without committing the source', async () => {
  const draft = { ...destination, content: '- Unsaved browser draft' };
  const input = params({ remote: true, readDraft: () => ({ note: draft, base: destination }) });
  const hook = renderHook(useOutlineActions, { initialProps: input });
  act(() => hook.result.current.value.add(source));
  await act(() => hook.result.current.choose(destination));
  expect(read).not.toHaveBeenCalled();
  expect(input.openNote).toHaveBeenCalledWith(draft);
  act(() => hook.result.current.value.cancel());
  act(() => hook.result.current.value.add(source));
  await act(() => hook.result.current.choose(null));
  expect(input.openNewNote).toHaveBeenCalledWith({ kind: 'outline', notebookId: 'a', initialLink: source });
});
it.each(['cancel', 'switch', 'read-only', 'root-change'] as const)('drops late reads after %s and never acts on equal paths in repository B', async reason => {
  const response = deferred<NoteItem>();
  read.mockReturnValue(response.promise);
  const input = params();
  const hook = renderHook(useOutlineActions, { initialProps: input });
  act(() => hook.result.current.value.add(source));
  let operation!: Promise<void>;
  await act(async () => {
    operation = hook.result.current.choose(destination);
    await Promise.resolve();
  });
  if (reason === 'cancel') act(() => hook.result.current.cancel());
  if (reason === 'switch') hook.rerender({ ...input, selectedNotebookId: 'b', locationKey: 'other', sourceId: 'github:b/repo@main', routedRef: { ...destination, notebookId: 'b' } });
  if (reason === 'read-only') hook.rerender({ ...input, repositoryFor: () => ({ ...repository, write: false }) });
  if (reason === 'root-change') hook.rerender({ ...input, config: { ...input.config!, notebooks: [{ id: 'a', root: 'notes/changed', title: 'A' }] } });
  await act(async () => {
    response.resolve(destination);
    await operation;
  });
  expect(input.openNote).not.toHaveBeenCalled();
  expect(hook.result.current.value.pending).toBeNull();
});
it('does not load or insert after source flush failure or a cross-notebook choice', async () => {
  const input = params({ prepareLeave: vi.fn(async () => false) });
  const hook = renderHook(useOutlineActions, { initialProps: input });
  act(() => hook.result.current.value.add(source));
  await act(() => hook.result.current.choose(destination));
  expect(hook.result.current.error).toBe('outline.saveFailed');
  await act(() => hook.result.current.choose({ ...destination, notebookId: 'b' }));
  expect(hook.result.current.error).toBe('outline.changed');
  expect(read).not.toHaveBeenCalled();
  expect(input.openNote).not.toHaveBeenCalled();
});
it('arms no insertion until navigation succeeds, even when adding an outline link to itself', async () => {
  const opening = deferred<boolean>();
  const input = params({ routedRef: destination, openNote: vi.fn(() => opening.promise) });
  const hook = renderHook(useOutlineActions, { initialProps: input });
  act(() => hook.result.current.value.add(destination));
  let operation!: Promise<void>;
  await act(async () => {
    operation = hook.result.current.choose(destination);
    await Promise.resolve();
  });
  expect(hook.result.current.value.pending).toBeNull();
  await act(async () => {
    opening.resolve(false);
    await operation;
  });
  expect(hook.result.current.value.pending).toBeNull();
  expect(hook.result.current.error).toBe('outline.saveFailed');
});

it('keeps load errors visible, rejects read-only activation and permanently cancels an abandoned destination', async () => {
  read.mockRejectedValueOnce(new Error('destination disappeared'));
  const input = params();
  const hook = renderHook(useOutlineActions, { initialProps: input });
  act(() => hook.result.current.value.add(source));
  await act(() => hook.result.current.choose(destination));
  expect(hook.result.current.error).toBe('destination disappeared');
  await act(() => hook.result.current.choose(destination));
  hook.rerender({ ...input, locationKey: 'elsewhere', routedRef: source });
  hook.rerender({ ...input, locationKey: 'destination', routedRef: destination });
  expect(hook.result.current.value.pending).toBeNull();
  hook.rerender({ ...input, repositoryFor: () => ({ ...repository, write: false }) });
  act(() => hook.result.current.value.add(source));
  expect(hook.result.current.dialog).toBeNull();
  expect(input.onError).toHaveBeenCalledWith('outline.readOnly');
});
