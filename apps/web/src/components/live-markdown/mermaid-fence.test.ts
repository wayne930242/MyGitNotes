// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { cjkEmphasis } from './cjk-emphasis.js';
import { chipEditState } from './chip-editing.js';
import { tableUIState } from '../LiveMarkdownTable.js';
import { liveDecorations } from './decorations.js';
import { MermaidDiagram } from './widgets.js';

vi.mock('../../lib/mermaid.js', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/mermaid.js')>(), hydrateMermaid: () => () => {} }));

const t = (key: string) => key;
const decorations = StateField.define<DecorationSet>({
  create: state => liveDecorations(state, false, 'n.md', 'link', 'table', 'page', 'owner', t as never),
  update: (_value, tr) => liveDecorations(tr.state, false, 'n.md', 'link', 'table', 'page', 'owner', t as never),
  provide: field => EditorView.decorations.from(field),
});

const views: EditorView[] = [];
function editor(doc: string) {
  const view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }), chipEditState, tableUIState, decorations] }) });
  views.push(view);
  return view;
}
afterEach(() => {
  while (views.length) views.pop()!.destroy();
  document.querySelectorAll('.mermaid-editor-overlay').forEach(node => node.remove());
});

/** The diagram sources the live editor draws as widgets. */
function diagrams(view: EditorView) {
  const found: string[] = [];
  view.state.field(decorations).between(0, view.state.doc.length, (_from, _to, value: Decoration) => {
    if (value.spec.widget instanceof MermaidDiagram) found.push(value.spec.widget.source);
  });
  return found;
}

function saveThrough(view: EditorView, source: string) {
  const edit = view.dom.querySelector<HTMLButtonElement>('.live-md-mermaid-edit')!;
  edit.click();
  const overlay = document.querySelector('.mermaid-editor-overlay')!;
  overlay.querySelector('textarea')!.value = source;
  overlay.querySelector<HTMLButtonElement>('header .ui-button-primary')!.click();
  return overlay;
}

describe('nested mermaid fences in the live editor', () => {
  it('draws a fence inside a blockquote', () => {
    expect(diagrams(editor('> ```mermaid\n> graph LR\n>   A --> B\n> ```\n'))).toEqual(['graph LR\n  A --> B']);
  });

  it('draws a fence inside a list item and a quoted list item', () => {
    expect(diagrams(editor('- item\n\n  ```mermaid\n  graph LR\n\n    A-->B\n  ```\n'))).toEqual(['graph LR\n\n  A-->B']);
    expect(diagrams(editor('> - ```mermaid\n>   graph LR\n>   A-->B\n>   ```\n'))).toEqual(['graph LR\nA-->B']);
  });

  it('keeps the blockquote prefixes when the split view saves', () => {
    const view = editor('> intro\n>\n> ```mermaid\n> graph LR\n> ```\n\nafter\n');
    saveThrough(view, 'graph TB\n\n  X --> Y\n');
    expect(view.state.doc.toString()).toBe('> intro\n>\n> ```mermaid\n> graph TB\n>\n>   X --> Y\n> ```\n\nafter\n');
  });

  it('keeps the list indentation when the split view saves', () => {
    const view = editor('- item\n\n  ```mermaid\n  graph LR\n  ```\n');
    saveThrough(view, 'graph TB\n  X --> Y');
    expect(view.state.doc.toString()).toBe('- item\n\n  ```mermaid\n  graph TB\n    X --> Y\n  ```\n');
  });

  it('keeps quote and list prefixes together when the split view saves', () => {
    const view = editor('> - ```mermaid\n>   graph LR\n>   ```\n');
    saveThrough(view, 'graph TB');
    expect(view.state.doc.toString()).toBe('> - ```mermaid\n>   graph TB\n>   ```\n');
  });
});

describe('top-level mermaid fences', () => {
  it('draws every line of a multi-line diagram', () => {
    expect(diagrams(editor('```mermaid\ngraph LR\n  A --> B\n\n  B --> C\n```\n'))).toEqual(['graph LR\n  A --> B\n\n  B --> C']);
  });

  it('keeps every line when writing a multi-line diagram back', () => {
    const view = editor('```mermaid\ngraph LR\n  A --> B\n```\n');
    saveThrough(view, 'graph LR\n  A --> B\n  B --> C');
    expect(view.state.doc.toString()).toBe('```mermaid\ngraph LR\n  A --> B\n  B --> C\n```\n');
  });

  it('keeps a longer or tilde fence marker on write-back', () => {
    const view = editor('~~~~mermaid\ngraph LR\n~~~~\n');
    saveThrough(view, 'graph TB\n  X --> Y\n');
    expect(view.state.doc.toString()).toBe('~~~~mermaid\ngraph TB\n  X --> Y\n~~~~\n');
  });

  it('closes an unterminated fence when writing back', () => {
    const view = editor('```mermaid\ngraph LR');
    saveThrough(view, 'graph TB');
    expect(view.state.doc.toString()).toBe('```mermaid\ngraph TB\n```');
  });

  it('closes an unterminated fence inside a blockquote with the quote prefix', () => {
    const view = editor('> ```mermaid\n> graph LR');
    saveThrough(view, 'graph TB');
    expect(view.state.doc.toString()).toBe('> ```mermaid\n> graph TB\n> ```');
  });

  it('writes an emptied diagram as an empty fence', () => {
    const view = editor('```mermaid\ngraph LR\n```\n');
    saveThrough(view, '\n');
    expect(view.state.doc.toString()).toBe('```mermaid\n```\n');
  });
});

describe('split-view save after the document changed underneath', () => {
  const fence = '```mermaid\ngraph LR\n```';

  it('writes into the same fence when content was added before it', () => {
    const view = editor(`${fence}\n`);
    view.dom.querySelector<HTMLButtonElement>('.live-md-mermaid-edit')!.click();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `# Title\n\nintro\n\n${fence}\n` } });
    const overlay = document.querySelector('.mermaid-editor-overlay')!;
    overlay.querySelector('textarea')!.value = 'graph TB';
    overlay.querySelector<HTMLButtonElement>('header .ui-button-primary')!.click();
    expect(view.state.doc.toString()).toBe('# Title\n\nintro\n\n```mermaid\ngraph TB\n```\n');
  });

  it('refuses the write and shows a message when the document became shorter and the fence is gone', () => {
    const view = editor(`intro\n\n${fence}\n`);
    view.dom.querySelector<HTMLButtonElement>('.live-md-mermaid-edit')!.click();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'x\n' } });
    const overlay = document.querySelector('.mermaid-editor-overlay')!;
    overlay.querySelector('textarea')!.value = 'graph TB';
    expect(() => overlay.querySelector<HTMLButtonElement>('header .ui-button-primary')!.click()).not.toThrow();
    expect(view.state.doc.toString()).toBe('x\n');
    expect(document.querySelector('.mermaid-editor-overlay [role="alert"]')?.textContent).toBe('mermaid.saveConflict');
  });

  it('refuses the write when several identical fences make the target ambiguous', () => {
    const view = editor(`${fence}\n`);
    view.dom.querySelector<HTMLButtonElement>('.live-md-mermaid-edit')!.click();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `x\n\n${fence}\n\n${fence}\n` } });
    const overlay = document.querySelector('.mermaid-editor-overlay')!;
    overlay.querySelector('textarea')!.value = 'graph TB';
    overlay.querySelector<HTMLButtonElement>('header .ui-button-primary')!.click();
    expect(view.state.doc.toString()).toBe(`x\n\n${fence}\n\n${fence}\n`);
    expect(document.querySelector('.mermaid-editor-overlay [role="alert"]')).not.toBeNull();
  });

  it('refuses the write when a deleted identical fence lets its twin shift into the opened position', () => {
    const view = editor(`${fence}\n\n${fence}\n`);
    view.dom.querySelector<HTMLButtonElement>('.live-md-mermaid-edit')!.click();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `${fence}\n` } });
    const overlay = document.querySelector('.mermaid-editor-overlay')!;
    overlay.querySelector('textarea')!.value = 'graph TB';
    overlay.querySelector<HTMLButtonElement>('header .ui-button-primary')!.click();
    expect(view.state.doc.toString()).toBe(`${fence}\n`);
    expect(document.querySelector('.mermaid-editor-overlay [role="alert"]')).not.toBeNull();
  });
});
