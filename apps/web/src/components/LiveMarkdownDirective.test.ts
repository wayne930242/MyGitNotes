import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/markdown.js', () => ({ renderNote: (text: string) => `<div class="mock-rendered">${text}</div>` }));

import { LiveMarkdownDirective } from './LiveMarkdownDirective.js';
import type { EditorView } from '@codemirror/view';

class MockDomNode {
  tagName: string;
  className = '';
  contentEditable = 'true';
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  children: MockDomNode[] = [];
  innerHTML = '';
  value = '';
  title = '';
  selected = false;
  style: Record<string, string> = {};
  listeners: Record<string, ((e: any) => void)[]> = {};

  classList = {
    add: (c: string) => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      set.add(c);
      this.className = [...set].join(' ');
    },
    remove: (c: string) => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      set.delete(c);
      this.className = [...set].join(' ');
    },
    contains: (c: string) => this.className.split(' ').includes(c),
  };

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(k: string, v: string) {
    this.attributes[k] = v;
  }
  getAttribute(k: string) {
    return this.attributes[k] ?? null;
  }
  append(...nodes: MockDomNode[]) {
    this.children.push(...nodes);
    for (const n of nodes) {
      if (n.selected && n.value) this.value = n.value;
    }
  }
  prepend(...nodes: MockDomNode[]) {
    this.children.unshift(...nodes);
  }
  focus() {}
  blur() {}
  addEventListener(event: string, fn: (e: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  dispatchEvent(e: any) {
    const list = this.listeners[e.type] || [];
    for (const fn of list) fn(e);
  }
  querySelector<T = MockDomNode>(selector: string): T | null {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      for (const c of this.children) {
        if (c.className.split(' ').includes(cls)) return c as unknown as T;
        const sub = c.querySelector<T>(selector);
        if (sub) return sub;
      }
    }
    return null;
  }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new MockDomNode(tag) });
  vi.stubGlobal(
    'Event',
    class {
      constructor(readonly type: string) {}
      stopPropagation() {}
      preventDefault() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LiveMarkdownDirective widget', () => {
  it('correctly compares equality via eq()', () => {
    const d1 = new LiveMarkdownDirective(':::info\n內容\n:::', 'note.md', 0, false, 'info');
    const d2 = new LiveMarkdownDirective(':::info\n內容\n:::', 'note.md', 0, false, 'info');
    const d3 = new LiveMarkdownDirective(':::sidebar\n內容\n:::', 'note.md', 0, false, 'sidebar');

    expect(d1.eq(d2)).toBe(true);
    expect(d1.eq(d3)).toBe(false);
  });

  it('renders root DOM with toolbar and type selector in editable mode', () => {
    const text = ':::info\n重要通知\n:::';
    const directive = new LiveMarkdownDirective(text, 'note.md', 10, false, 'info');

    const mockView = { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() } as unknown as EditorView;

    const dom = directive.toDOM(mockView);
    expect(dom.className).toContain('live-md-directive');
    expect(dom.dataset.directiveType).toBe('info');

    const toolbar = dom.querySelector('.live-directive-toolbar');
    expect(toolbar).not.toBeNull();

    const typeSelect = toolbar?.querySelector<HTMLSelectElement>('.live-directive-type-select');
    expect(typeSelect).not.toBeNull();
    expect(typeSelect?.value).toBe('info');

    const editBtn = toolbar?.querySelector('.live-directive-edit-btn');
    expect(editBtn).not.toBeNull();
  });

  it('renders variant selector for handout directives', () => {
    const text = ':::handout{id="H-01" variant="newspaper"}\n剪報報導\n:::';
    const directive = new LiveMarkdownDirective(text, 'note.md', 0, false, 'handout', 'newspaper');

    const mockView = { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() } as unknown as EditorView;

    const dom = directive.toDOM(mockView);
    const variantSelect = dom.querySelector<HTMLSelectElement>('.live-directive-variant-select');
    expect(variantSelect).not.toBeNull();
    expect(variantSelect?.value).toBe('newspaper');
  });

  it('dispatches text change when type is changed in selector', () => {
    const text = ':::info\n內容文字\n:::';
    const directive = new LiveMarkdownDirective(text, 'note.md', 5, false, 'info');

    const mockView = { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() } as unknown as EditorView;

    const dom = directive.toDOM(mockView);
    const typeSelect = dom.querySelector<HTMLSelectElement>('.live-directive-type-select')!;
    typeSelect.value = 'sidebar';
    typeSelect.dispatchEvent(new Event('change'));

    expect(mockView.dispatch).toHaveBeenCalledWith(expect.objectContaining({ changes: expect.objectContaining({ from: 5, to: 5 + text.length, insert: expect.stringContaining(':::sidebar') }), userEvent: 'input.directive' }));
  });

  it('supports title field editing from toolbar input', () => {
    const text = ':::info\n內容文字\n:::';
    const directive = new LiveMarkdownDirective(text, 'note.md', 0, false, 'info');

    const mockView = { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() } as unknown as EditorView;

    const dom = directive.toDOM(mockView);
    const titleInput = dom.querySelector<HTMLInputElement>('.live-directive-title-input')!;
    expect(titleInput).not.toBeNull();
    titleInput.value = '新標題';
    titleInput.dispatchEvent(new Event('blur'));

    expect(mockView.dispatch).toHaveBeenCalledWith(expect.objectContaining({ changes: expect.objectContaining({ from: 0, to: text.length, insert: expect.stringContaining(':::info[新標題]') }), userEvent: 'input.directive' }));
  });

  it('switches to inline edit form when clicking edit button', () => {
    const text = ':::info[原標題]\n原有內文\n:::';
    const directive = new LiveMarkdownDirective(text, 'note.md', 0, false, 'info');

    const mockView = { dispatch: vi.fn(), requestMeasure: vi.fn(), focus: vi.fn() } as unknown as EditorView;

    const dom = directive.toDOM(mockView);
    const editBtn = dom.querySelector<HTMLButtonElement>('.live-directive-edit-btn')!;
    expect(editBtn).not.toBeNull();
    expect(editBtn.textContent).toBe('編輯內文');

    editBtn.dispatchEvent(new Event('click'));

    const panel = dom.querySelector('.live-directive-editor-panel');
    expect(panel).not.toBeNull();

    const bodyEditor = dom.querySelector<HTMLTextAreaElement>('.live-directive-body-editor');
    expect(bodyEditor).not.toBeNull();
    expect(bodyEditor?.value).toBe('原有內文');

    const saveBtn = dom.querySelector<HTMLButtonElement>('.live-directive-btn-save');
    expect(saveBtn).not.toBeNull();
  });

  it('omits toolbar in readOnly mode', () => {
    const text = ':::info\n唯讀內容\n:::';
    const directive = new LiveMarkdownDirective(text, 'note.md', 0, true, 'info');

    const mockView = {} as unknown as EditorView;
    const dom = directive.toDOM(mockView);

    expect(dom.querySelector('.live-directive-toolbar')).toBeNull();
  });
});
