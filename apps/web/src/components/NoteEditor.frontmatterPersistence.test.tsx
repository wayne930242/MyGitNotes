// @vitest-environment jsdom
import { type ChangeEvent, createElement, forwardRef, useImperativeHandle } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { PanelProvider } from '../lib/panel-context.js';
import { NoteEditor, type NoteEditorProps } from './NoteEditor.js';
import type { MarkdownEditorHandle, MarkdownEditorMode } from './MarkdownEditor.js';

vi.mock('./MarkdownEditor.js', () => ({
  MarkdownEditorModeSwitch: () => null,
  MarkdownEditor: forwardRef<MarkdownEditorHandle, { content: string; mode: MarkdownEditorMode; onChange: (content: string) => void; }>(({ content, onChange }, ref) => {
    useImperativeHandle(ref, () => ({ insert() {}, revealRange() {}, goToLine() {}, getCurrentLine: () => 1 }), []);
    return createElement('textarea', { 'aria-label': 'Note content', value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) });
  }),
}));

vi.mock('./FileSourceEditor.js', () => ({ FileSourceEditor: ({ content, label, onChange }: { content: string; label: string; onChange: (value: string) => void; }) => createElement('textarea', { 'aria-label': label, value: content, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value) }) }));

afterEach(cleanup);

const note = { id: 'a', path: 'notes/a/a.md', notebookId: 'a', title: 'Alpha', tags: [], metadata: { title: 'Alpha' }, content: '# Alpha\n' };
const editor = (props: Partial<NoteEditorProps>) => createElement(PanelProvider, null, createElement(NoteEditor, { note, frame: 'zoom', active: true, statuses: [], onSave: async () => note, onRestoreFile: async () => null, branch: 'main', draftScope: 'src:main', ...props } as NoteEditorProps));

it('keeps in-progress frontmatter form, tag and YAML state across a switch to another document-panel tab and back', () => {
  render(editor({}));

  fireEvent.click(screen.getByRole('tab', { name: 'Frontmatter' }));
  fireEvent.change(screen.getByPlaceholderText('New field name...'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByPlaceholderText('Add tag (e.g. project)...'), { target: { value: 'wip' } });

  fireEvent.click(screen.getByRole('button', { name: 'YAML Source' }));
  fireEvent.change(screen.getByLabelText('YAML Metadata'), { target: { value: '- item' } });
  expect(screen.getByText('Invalid YAML syntax: Root must be a mapping')).toBeInTheDocument();

  // Switch away to another document-panel tab, then back to Frontmatter.
  fireEvent.click(screen.getByRole('tab', { name: 'Outline' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Frontmatter' }));

  expect(screen.getByRole('button', { name: 'YAML Source' })).toHaveClass('shadow-sm');
  expect(screen.getByLabelText('YAML Metadata')).toHaveValue('- item');
  expect(screen.getByText('Invalid YAML syntax: Root must be a mapping')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Form' }));
  expect(screen.getByPlaceholderText('New field name...')).toHaveValue('custom');
  expect(screen.getByPlaceholderText('Add tag (e.g. project)...')).toHaveValue('wip');
});
