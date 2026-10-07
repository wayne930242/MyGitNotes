// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useNoteDocumentPanel } from './useNoteDocumentPanel.js';
import type { MarkdownEditorHandle } from '../MarkdownEditor.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("reopens a zoomed note's panel as the user left it, open on its last section or closed", () => {
  const props = { frame: 'zoom' as const, active: false, isMarkdown: true, content: '# Alpha', editorMode: 'raw' as const, editorRef: createRef<MarkdownEditorHandle>(), metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const first = renderHook(() => useNoteDocumentPanel(props));
  expect(first.result.current.notePanel).toBeNull();
  act(() => first.result.current.setNotePanel('history'));
  first.unmount();
  const second = renderHook(() => useNoteDocumentPanel({ ...props, notePath: 'notes/b.md' }));
  expect(second.result.current.notePanel).toBe('history');
  act(() => second.result.current.setNotePanel(null));
  second.unmount();
  expect(renderHook(() => useNoteDocumentPanel(props)).result.current.notePanel).toBeNull();
});

it('keeps panel drafts across content updates and resets navigation only when the document identity changes', () => {
  const editorRef = createRef<MarkdownEditorHandle>();
  const initialProps = { frame: 'zoom' as const, active: false, isMarkdown: true, content: '# Alpha\n\nalpha alpha alpha', editorMode: 'raw' as const, editorRef, metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result, rerender } = renderHook(props => useNoteDocumentPanel(props), { initialProps });
  act(() => {
    result.current.setNotePanel('find');
    result.current.setFindQuery('alpha');
    result.current.setYamlText('custom: draft');
    result.current.setNewFieldKey('draft');
    result.current.setTagInput('unfinished');
  });
  act(() => result.current.stepFind(2));
  expect(result.current.findIndex).toBe(2);
  rerender({ ...initialProps, content: '# Alpha\n\nalpha alpha alpha\nupdated' });
  expect(result.current.findIndex).toBe(2);
  expect(result.current.tagInput).toBe('unfinished');
  rerender({ ...initialProps, notePath: 'notes/b.md' });
  expect(result.current.findQuery).toBe('');
  expect(result.current.findIndex).toBe(0);
  expect(result.current.tagInput).toBe('');
  expect(result.current.yamlText).toBe('custom: draft');
  expect(result.current.newFieldKey).toBe('draft');
});

it('clamps a search selection when matches shrink and keeps the clamped selection when they grow again', () => {
  const revealRange = vi.fn();
  const editorRef = { current: { insert: vi.fn(), revealRange, goToLine: vi.fn(), getCurrentLine: () => 1, getSelection: () => null, ready: () => true } };
  const initialProps = { frame: 'zoom' as const, active: false, isMarkdown: true, content: 'one one one', editorMode: 'raw' as const, editorRef, metadata: {}, notePath: 'notes/a.md', branch: 'main', readOnly: false };
  const { result, rerender } = renderHook(props => useNoteDocumentPanel(props), { initialProps });
  act(() => {
    result.current.setNotePanel('find');
    result.current.setFindQuery('one');
  });
  act(() => result.current.stepFind(2));
  expect(result.current.findIndex).toBe(2);
  rerender({ ...initialProps, content: 'one' });
  expect(result.current.findIndex).toBe(0);
  expect(revealRange).toHaveBeenLastCalledWith(0, 3);
  rerender(initialProps);
  expect(result.current.findIndex).toBe(0);
  act(() => result.current.stepFind(1));
  act(() => result.current.setFindQuery('on'));
  expect(result.current.findIndex).toBe(0);
});
