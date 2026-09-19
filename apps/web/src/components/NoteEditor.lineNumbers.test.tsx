// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';
import type { MarkdownEditorHandle, MarkdownEditorMode } from './MarkdownEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: ({ mode, onChange }: { mode: MarkdownEditorMode; onChange: (mode: MarkdownEditorMode) => void; }) => createElement('button', { type: 'button', onClick: () => onChange(mode === 'live' ? 'raw' : 'live') }, `Switch to ${mode === 'live' ? 'Source' : 'Live'}`),
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; mode: MarkdownEditorMode; showLineNumbers?: boolean; onChange: (content: string) => void; }>(({ content, mode, showLineNumbers, onChange }, ref) => {
    useImperativeHandle(ref, () => ({ insert() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1 }), []);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, 'data-mode': mode, 'data-line-numbers': showLineNumbers ? 'true' : 'false', onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

afterEach(cleanup);

const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'compact', active: false, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));

for (const frame of ['compact', 'pane', 'zoom'] as const) {
  it(`starts with line numbers hidden, shows them on toggle, and keeps them shown across a mode switch (${frame})`, () => {
    render(editor({ frame }));
    const toggle = screen.getByRole('button', { name: 'Line Numbers' });
    const content = screen.getByLabelText('Note content');

    expect(content).toHaveAttribute('data-line-numbers', 'false');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(content).toHaveAttribute('data-line-numbers', 'true');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Source|Live/ }));
    expect(content).toHaveAttribute('data-line-numbers', 'true');

    fireEvent.click(toggle);
    expect(content).toHaveAttribute('data-line-numbers', 'false');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
}
