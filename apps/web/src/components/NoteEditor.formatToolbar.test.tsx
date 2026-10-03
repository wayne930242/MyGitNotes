// @vitest-environment jsdom
import { createElement, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';
import { FORMAT_TOOLBAR_STORAGE_KEY } from '../lib/editor-preferences.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { toolbarSlot?: HTMLElement | null; }>(({ toolbarSlot }, ref) => {
    useImperativeHandle(ref, () => ({ insert() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1 }), []);
    return toolbarSlot ? createPortal(createElement('div', { role: 'toolbar', 'aria-label': 'Formatting toolbar' }), toolbarSlot) : null;
  }),
}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: false, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));

for (const frame of ['pane', 'zoom'] as const) {
  it(`starts hidden, shows the formatting toolbar below the header from the header toggle, and hides it again (${frame})`, () => {
    const { container } = render(editor({ frame }));
    const toggle = screen.getByRole('button', { name: 'Formatting toolbar' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('toolbar')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting toolbar' });
    // The row sits between the header and the editor body, outside the header.
    expect(container.querySelector('.note-toolbar')).not.toContainElement(toolbar);
    expect(container.querySelector('.note-toolbar + .note-format-toolbar')).toContainElement(toolbar);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
}

it('remembers the choice in the browser across a remount', () => {
  const { unmount } = render(editor({}));
  fireEvent.click(screen.getByRole('button', { name: 'Formatting toolbar' }));
  expect(localStorage.getItem(FORMAT_TOOLBAR_STORAGE_KEY)).toBe('true');
  unmount();

  const { unmount: unmountShown } = render(editor({}));
  expect(screen.getByRole('button', { name: 'Formatting toolbar' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('toolbar', { name: 'Formatting toolbar' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Formatting toolbar' }));
  expect(localStorage.getItem(FORMAT_TOOLBAR_STORAGE_KEY)).toBe('false');
  unmountShown();

  render(editor({}));
  expect(screen.getByRole('button', { name: 'Formatting toolbar' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('toolbar')).toBeNull();
});

it('offers no toggle for a note that is not Markdown or cannot be edited', () => {
  render(editor({ note: { ...note, path: 'notes/a/a.txt' } }));
  expect(screen.queryByRole('button', { name: 'Formatting toolbar' })).toBeNull();
  cleanup();
  render(editor({ readOnly: true }));
  expect(screen.queryByRole('button', { name: 'Formatting toolbar' })).toBeNull();
});
