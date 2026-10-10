// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type CommandSpec, useRegisterCommands } from '../commands/registry.js';
import { markdownEditorKeymap } from '../../components/live-markdown/editor-keymap.js';
import { KeyboardRoot } from './KeyboardDispatcher.js';

let views: EditorView[] = [];
beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(() => {
  for (const view of views) view.destroy();
  views = [];
  cleanup();
});

function mount(specs: CommandSpec[]) {
  const Commands = () => {
    useRegisterCommands(specs);
    return null;
  };
  return render(createElement(KeyboardRoot, null, createElement(Commands)));
}

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

it('takes Ctrl+/ before a mounted Markdown CodeMirror editor, which no longer toggles a comment', () => {
  const help = vi.fn();
  mount([{ id: 'help.open', run: help }]);
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'plain line', extensions: [markdown(), history(), markdownEditorKeymap(), EditorView.contentAttributes.of({ 'data-key-scope': 'markdown-editor' })] }) });
  views.push(view);
  const event = press(view.contentDOM, { key: '/', code: 'Slash', ctrlKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(help).toHaveBeenCalledWith(expect.objectContaining({ source: 'key' }));
  expect(view.state.doc.toString()).toBe('plain line');
});

it('leaves a key alone when its command is not registered or not available', () => {
  mount([{ id: 'palette.commands', availability: () => ({ enabled: false, reason: 'commit dialog' }), run: vi.fn() }]);
  expect(press(document.body, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
  expect(press(document.body, { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
});

it('runs a chord typed while an IME reports keyCode 229, matching it by its physical key', () => {
  const notes = vi.fn();
  mount([{ id: 'palette.notes', run: notes }]);
  const event = press(document.body, { key: 'Process', code: 'KeyF', keyCode: 229, ctrlKey: true, shiftKey: true } as KeyboardEventInit);
  expect(event.defaultPrevented).toBe(true);
  expect(notes).toHaveBeenCalledOnce();
});

it('ignores keys that only look like its chords', () => {
  const notes = vi.fn();
  mount([{ id: 'palette.notes', run: notes }, { id: 'help.open', run: notes }]);
  press(document.body, { key: 'f', code: 'KeyF', ctrlKey: true });
  press(document.body, { key: '/', code: 'Slash', altKey: true });
  press(document.body, { key: 'F', code: 'KeyF', ctrlKey: true, altKey: true, shiftKey: true });
  expect(notes).not.toHaveBeenCalled();
});
