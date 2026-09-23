// @vitest-environment jsdom
import { type ChangeEvent, createElement, createRef, forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor, type NoteEditorHandle, type NoteEditorSession } from './NoteEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; mode: string; readOnly: boolean; compact?: boolean; onChange: (content: string) => void; }>(({ content, mode, readOnly, compact, onChange }, ref) => {
    useImperativeHandle(ref, () => ({
      insert: (text, at) => {
        const position = at ?? content.length;
        onChange(content.slice(0, position) + text + content.slice(position));
      },
      revealRange() {},
      goToLine() {},
      getCurrentLine: () => 1,
    }), [content, onChange]);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, readOnly, 'data-compact': compact ? 'true' : undefined, 'data-mode': mode, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

afterEach(cleanup);

const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };

it('renders the body with a status bar only, reports its session and inserts through its handle', () => {
  const ref = createRef<NoteEditorHandle>();
  const onSession = vi.fn<(session: NoteEditorSession | null) => void>();
  const { container, unmount } = render(createElement(PanelProvider, null, createElement(NoteEditor, { ref, note, frame: 'compact', active: false, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', onSession })));

  expect(container.querySelector('.note-editor')).toHaveAttribute('data-frame', 'compact');
  expect(container.querySelector('.note-toolbar')).toBeNull();
  expect(container.querySelector('.note-footer')).toBeNull();
  expect(container.querySelector('.note-document-panel')).toBeNull();
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-compact', 'true');
  expect(container.querySelector('.note-compact-path')).toHaveTextContent('a · a.md');
  expect(container.querySelector('.note-compact-status')).toHaveAttribute('data-state', 'saved');
  expect(container.querySelector('.note-compact-status')).toHaveTextContent('Clean (Saved to disk)');
  expect(onSession).toHaveBeenLastCalledWith({ content: '# Alpha\n', title: 'Alpha', dirty: false, locked: false });

  fireEvent.change(screen.getByLabelText('Note content'), { target: { value: '# Alpha\nMore.' } });
  expect(onSession).toHaveBeenLastCalledWith({ content: '# Alpha\nMore.', title: 'Alpha', dirty: true, locked: false });
  expect(container.querySelector('.note-compact-status')).toHaveAttribute('data-state', 'pending');

  act(() => ref.current!.insert('[Beta](b.md)', 8));
  expect(screen.getByLabelText('Note content')).toHaveValue('# Alpha\n[Beta](b.md)More.');

  fireEvent.click(container.querySelector('[data-mode-toggle="live"]')!);
  expect(container.querySelector('[data-mode-toggle="raw"]')).toBeInTheDocument();
  expect(screen.getByLabelText('Note content')).toHaveAttribute('data-mode', 'raw');

  unmount();
  expect(onSession).toHaveBeenLastCalledWith(null);
});

it('refuses handle inserts while read-only', () => {
  const ref = createRef<NoteEditorHandle>();
  render(createElement(PanelProvider, null, createElement(NoteEditor, { ref, note, frame: 'compact', active: false, statuses: [], readOnly: true, onSave: async () => note, onRestoreFile: async () => null, branch: 'main' })));
  act(() => ref.current!.insert('x', 0));
  expect(screen.getByLabelText('Note content')).toHaveValue('# Alpha\n');
});

it('opens the note commands leader on Ctrl+Shift+E only in zoom', () => {
  for (const frame of ['pane', 'zoom'] as const) {
    render(createElement(PanelProvider, null, createElement(NoteEditor, { note, frame, active: true, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main' })));
    const event = new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(Boolean(screen.queryByRole('dialog', { name: 'Note commands' }))).toBe(frame === 'zoom');
    expect(event.defaultPrevented).toBe(frame === 'zoom');
    cleanup();
  }
});
