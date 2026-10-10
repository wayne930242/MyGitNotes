// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { standardKeymap } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, type KeyBinding, keymap } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keysId } from '../../lib/keyboard/keys.js';
import { bindingApplies, KEYMAP, type KeyScope, parsedBinding } from '../../lib/keyboard/keymap.js';
import { type KeyEnvironment, keyEnvironment } from '../../lib/keyboard/platform.js';
import { LiveMarkdownEditor } from '../LiveMarkdownEditor.js';
import { FileSourceEditor } from '../FileSourceEditor.js';
import { codeEditorKeymap, markdownEditorKeymap } from './editor-keymap.js';

const MAC: KeyEnvironment = { platform: 'mac', browser: 'safari' };

beforeEach(() => {
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterEach(cleanup);

/** A CodeMirror key name as the table's chord id: `Shift-Mod-k` → `mod+shift+k`; an upper-case letter implies Shift. */
function codeMirrorChordId(name: string, env: KeyEnvironment): string {
  const parts = name.split(/-(?!$)/);
  let key = parts.pop()!;
  const flags = { ctrl: false, mod: false, shift: false, alt: false };
  for (const part of parts) {
    if (part === 'Mod' || ((part === 'Cmd' || part === 'Meta') && env.platform === 'mac')) flags.mod = true;
    else if (part === 'Ctrl' || part === 'Control') flags.ctrl = true;
    else if (part === 'Shift') flags.shift = true;
    else if (part === 'Alt') flags.alt = true;
    else throw new Error(`Unexpected modifier ${part} in ${name}`);
  }
  if (/^[A-Z]$/.test(key)) flags.shift = true;
  key = key.length === 1 ? key.toLowerCase() : key === ' ' ? 'space' : key.toLowerCase();
  return [flags.ctrl && 'ctrl', flags.mod && 'mod', flags.shift && 'shift', flags.alt && 'alt', key].filter(Boolean).join('+');
}

/** The entries of `scopes` handled by CodeMirror, by the chord ids they take in `env`. */
function tableChords(scopes: readonly KeyScope[], env: KeyEnvironment) {
  const chords = new Map<string, string[]>();
  for (const entry of KEYMAP.filter(entry => entry.handler === 'codemirror' && entry.scopes.some(scope => scopes.includes(scope)))) {
    for (const binding of entry.bindings.filter(binding => bindingApplies(binding, env))) {
      const id = keysId(parsedBinding(binding));
      chords.set(id, [...chords.get(id) ?? [], entry.id]);
    }
  }
  return chords;
}

/** Asserts every installed key is a table entry of `scopes`, and (unless `onlyInstalled`) every such entry has a key installed. */
function expectCovered(installed: readonly KeyBinding[], scopes: readonly KeyScope[], env: KeyEnvironment, onlyInstalled = false) {
  const table = tableChords(scopes, env);
  const used = new Set<string>(installed.some(binding => standardKeymap.includes(binding)) ? ['editor.textNavigation'] : []);
  for (const binding of installed) {
    if (standardKeymap.includes(binding)) continue;
    // Bindings for another platform only (CodeMirror's `mac`, `win`, `linux`) are not active in this environment.
    const name = env.platform === 'mac' ? binding.mac ?? binding.key : binding.key;
    if (!name) continue;
    const id = codeMirrorChordId(name, env);
    const entries = table.get(id);
    expect(entries, `${name} (${id}) has no KEYMAP entry in ${scopes.join(', ')}`).toBeDefined();
    for (const entry of entries ?? []) used.add(entry);
  }
  if (onlyInstalled) return;
  const missing = [...new Set([...table.values()].flat())].filter(entry => !used.has(entry));
  expect(missing, 'KEYMAP lists CodeMirror keys these editors never install').toEqual([]);
}

const facetBindings = (element: HTMLElement) => EditorView.findFromDOM(element)!.state.facet(keymap).flat();

function mountMarkdown(path: string) {
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, {}, createElement(LiveMarkdownEditor, { content: '- one\n- two', notePath: path, notebookId: 'ex', readOnly: false, onChange: () => {}, ariaLabel: 'Note content' }))));
  return facetBindings(screen.getByRole('textbox', { name: 'Note content' }));
}

describe('installed CodeMirror keymaps', () => {
  it('the Markdown editor installs only KEYMAP keys and every Markdown CodeMirror entry, outline keys in outline notes', () => {
    const note = mountMarkdown('notes/ex/plan.md');
    cleanup();
    const outline = mountMarkdown('notes/ex/plan.outline.md');
    expectCovered([...note, ...outline], ['markdown-editor', 'link-completion'], keyEnvironment);
  });

  it('the Markdown editor binds Mod-/ to nothing, so the global help key reaches it', () => {
    const note = mountMarkdown('notes/ex/plan.md');
    expect(note.filter(binding => binding.key && codeMirrorChordId(binding.key, keyEnvironment) === 'mod+/')).toEqual([]);
  });

  it('the code-file editor installs only KEYMAP keys and every code-editor entry, Mod-/ included', () => {
    const view = render(createElement(FileSourceEditor, { path: 'scripts/build.js', content: 'const a = 1;', readOnly: false, label: 'Source', onChange: () => {} }));
    const installed = facetBindings(view.container.querySelector<HTMLElement>('.cm-content')!);
    expectCovered(installed, ['code-editor'], keyEnvironment);
    expect(installed.some(binding => binding.key && codeMirrorChordId(binding.key, keyEnvironment) === 'mod+/')).toBe(true);
  });

  it('builds the macOS variants from the table as well', () => {
    const facet = (extension: ReturnType<typeof markdownEditorKeymap>) => EditorState.create({ extensions: extension }).facet(keymap).flat();
    expectCovered(facet(markdownEditorKeymap(MAC)), ['markdown-editor'], MAC, true);
    expectCovered(facet(codeEditorKeymap(MAC)), ['code-editor'], MAC, true);
    expect(facet(markdownEditorKeymap(MAC)).map(binding => binding.key)).toEqual(expect.arrayContaining(['Mod-Shift-z', 'Ctrl-ArrowLeft', 'Ctrl-l']));
    expect(facet(markdownEditorKeymap(MAC)).map(binding => binding.key)).not.toContain('Mod-y');
  });
});
