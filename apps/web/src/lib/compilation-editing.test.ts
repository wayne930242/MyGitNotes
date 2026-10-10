// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompilationEditingProvider, holdOrder, useCompilationEditing, useHeldNotes, useHeldOrder } from './compilation-editing.js';

const flushEditors = vi.fn<(keys?: readonly string[]) => Promise<boolean>>();
const refreshNotes = vi.fn<() => Promise<void>>();
vi.mock('./note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors, refreshNotes }) }));

const a = { slot: 'item-a', key: 'nb:a.md' };
const b = { slot: 'item-b', key: 'nb:b.md' };

beforeEach(() => {
  flushEditors.mockReset().mockResolvedValue(true);
  refreshNotes.mockReset().mockResolvedValue();
});
afterEach(cleanup);

it('edits one slot at a time: starting another saves the first, then switches', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  expect(result.current.editing).toBeNull();
  await act(async () => void await result.current.start(a));
  expect(result.current.editing).toEqual(a);
  expect(flushEditors).not.toHaveBeenCalled();
  await act(async () => void await result.current.start(b));
  expect(flushEditors).toHaveBeenCalledWith([a.key]);
  expect(refreshNotes).toHaveBeenCalledTimes(1);
  expect(result.current.editing).toEqual(b);
});

it('keeps the slot editing, and refuses the switch, when its note cannot be saved', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  await act(async () => void await result.current.start(a));
  flushEditors.mockResolvedValue(false);
  let switched = true;
  await act(async () => void (switched = await result.current.start(b)));
  expect(switched).toBe(false);
  expect(result.current.editing).toEqual(a);
  let finished = true;
  await act(async () => void (finished = await result.current.finish()));
  expect(finished).toBe(false);
  expect(result.current.editing).toEqual(a);
});

it('treats a save that throws as a failed save', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  await act(async () => void await result.current.start(a));
  flushEditors.mockRejectedValue(new Error('offline'));
  await act(async () => void await result.current.finish());
  expect(result.current.editing).toEqual(a);
});

it('finishes by saving the slot and clearing the state, then reads the notes as saved', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  await act(async () => void await result.current.start(a));
  await act(async () => void await result.current.finish());
  expect(flushEditors).toHaveBeenCalledWith([a.key]);
  expect(refreshNotes).toHaveBeenCalled();
  expect(result.current.editing).toBeNull();
});

it('finishes without a save when nothing is editing, and restarts the same slot without one', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  await act(async () => void await result.current.finish());
  expect(flushEditors).not.toHaveBeenCalled();
  await act(async () => void await result.current.start(a));
  await act(async () => void await result.current.start(a));
  expect(flushEditors).not.toHaveBeenCalled();
});

it('still switches when the notes cannot be refreshed after a successful save', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  await act(async () => void await result.current.start(a));
  refreshNotes.mockRejectedValue(new Error('offline'));
  await act(async () => void await result.current.start(b));
  expect(result.current.editing).toEqual(b);
});

it('runs two quick requests one after the other', async () => {
  const { result } = renderHook(() => useCompilationEditing());
  await act(async () => void await result.current.start(a));
  const order: string[] = [];
  flushEditors.mockImplementation(async keys => {
    order.push(`flush ${keys?.join()}`);
    return true;
  });
  await act(async () => {
    await Promise.all([result.current.start(b), result.current.finish()]);
  });
  expect(order).toEqual(['flush nb:a.md', 'flush nb:b.md']);
  expect(result.current.editing).toBeNull();
});

const item = (id: string, title = id) => ({ id, title });

it('holds the order as it was, appends arrivals, keeps members that left and uses the latest copy', () => {
  const held = [item('1'), item('2'), item('3')];
  expect(holdOrder([item('3'), item('1', 'one'), item('4')], held)).toEqual([item('1', 'one'), item('2'), item('3'), item('4')]);
  expect(holdOrder([item('3'), item('1')], null)).toEqual([item('3'), item('1')]);
});

it('holds a dynamic list while a slot edits and applies the live order once editing ends', async () => {
  let editingRef!: ReturnType<typeof useCompilationEditing>;
  const Wrapper = ({ children }: { children: ReactNode; }) => {
    const editing = useCompilationEditing();
    /* eslint-disable react/globals -- The test probe captures the hook's result for assertions after React commits. */
    editingRef = editing;
    /* eslint-enable react/globals */
    return createElement(CompilationEditingProvider, { value: editing }, children);
  };
  const { result, rerender } = renderHook(({ items }) => useHeldOrder(items), { wrapper: Wrapper, initialProps: { items: [item('1'), item('2'), item('3')] } });
  expect(result.current.map(entry => entry.id)).toEqual(['1', '2', '3']);
  await act(async () => void await editingRef.start({ slot: '2', key: 'nb:2.md' }));
  // An autosave moves the edited note to the top, and a new member arrives.
  rerender({ items: [item('2'), item('1'), item('4')] });
  expect(result.current.map(entry => entry.id)).toEqual(['1', '2', '3', '4']);
  await act(async () => void await editingRef.finish());
  expect(result.current.map(entry => entry.id)).toEqual(['2', '1', '4']);
});

it('holds loaded notes under their repository key, as two notes can share an id', async () => {
  let editingRef!: ReturnType<typeof useCompilationEditing>;
  const Wrapper = ({ children }: { children: ReactNode; }) => {
    const editing = useCompilationEditing();
    /* eslint-disable react/globals -- The test probe captures the hook's result for assertions after React commits. */
    editingRef = editing;
    /* eslint-enable react/globals */
    return createElement(CompilationEditingProvider, { value: editing }, children);
  };
  const index = (folder: string, body: string) => ({ id: 'index', notebookId: 'nb', path: `notes/${folder}/index.md`, body });
  const { result, rerender } = renderHook(({ notes }) => useHeldNotes(notes), { wrapper: Wrapper, initialProps: { notes: [index('x', 'one'), index('y', 'two')] } });
  await act(async () => void await editingRef.start({ slot: 'x', key: 'nb:notes/x/index.md' }));
  // The edited note leaves the loaded page; both stay, in their order, and the neighbour keeps its latest copy.
  rerender({ notes: [index('y', 'two, saved elsewhere')] });
  expect(result.current.map(note => [note.path, note.body])).toEqual([['notes/x/index.md', 'one'], ['notes/y/index.md', 'two, saved elsewhere']]);
});
