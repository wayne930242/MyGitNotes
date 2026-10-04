// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureTextAnchor } from '@mygitnotes/core/bookmark-anchor';
import type { MarkdownEditorHandle } from '../components/MarkdownEditor.js';
import { useBookmarkPosition } from './use-bookmark-position.js';
import type { NoteItem } from './types.js';
const mocked = vi.hoisted(() => ({ actions: {} as Record<string, unknown> }));
vi.mock('./bookmark-context.js', () => ({ useBookmarkActionsContext: () => mocked.actions }));
let frames: Map<number, FrameRequestCallback>, sequence: number;
beforeEach(() => {
  frames = new Map();
  sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const tick = () =>
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(performance.now()));
  });
const note = { notebookId: 'a', path: 'notes/a/a.md', title: 'A', content: 'unique paragraph', metadata: {} } as NoteItem;
function fixture() {
  const consumePosition = vi.fn(), revealRange = vi.fn(), ready = vi.fn(() => true);
  const position = { id: 'request', notebookId: 'a', path: note.path, anchor: captureTextAnchor(note.content, { from: 0, to: note.content.length }, 'paragraph') };
  mocked.actions = { position, consumePosition };
  const editor = { current: { ready, revealRange } as unknown as MarkdownEditorHandle };
  return { consumePosition, revealRange, ready, editor, position };
}
it('rematches against the actual dirty mounted body instead of using saved offsets', () => {
  const f = fixture();
  renderHook(() => useBookmarkPosition(note, 'shifted\n\nunique paragraph', f.editor));
  tick();
  expect(f.revealRange).toHaveBeenCalledWith(9, 25, true);
  expect(f.consumePosition).toHaveBeenCalledWith('request', true);
});
it('never reveals a guessed repeated position', () => {
  const f = fixture();
  renderHook(() => useBookmarkPosition(note, 'unique paragraph\n\nunique paragraph', f.editor));
  tick();
  expect(f.revealRange).not.toHaveBeenCalled();
  expect(f.consumePosition).toHaveBeenCalledWith('request', false);
});
it('waits for raw/live editor readiness and cancels a request when its note host changes', () => {
  const f = fixture();
  f.ready.mockReturnValue(false);
  const hook = renderHook(({ current }) => useBookmarkPosition(current, current.content, f.editor), { initialProps: { current: note } });
  tick();
  expect(f.consumePosition).not.toHaveBeenCalled();
  hook.rerender({ current: { ...note, notebookId: 'b' } });
  f.ready.mockReturnValue(true);
  tick();
  expect(f.revealRange).not.toHaveBeenCalled();
});
it('ignores a superseded activation before its animation-frame reveal', () => {
  const f = fixture();
  const hook = renderHook(() => useBookmarkPosition(note, note.content, f.editor));
  mocked.actions = { ...mocked.actions, position: null };
  hook.rerender();
  tick();
  expect(f.revealRange).not.toHaveBeenCalled();
  expect(f.consumePosition).not.toHaveBeenCalled();
});
