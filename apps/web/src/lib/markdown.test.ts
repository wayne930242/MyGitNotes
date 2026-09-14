import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => ({
  default: { sanitize: (html: string) => html },
}));

import { renderNote } from './markdown.js';

class MockElement {
  tagName: string;
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  childNodes: (MockElement | string)[] = [];
  parent: MockElement | null = null;
  tabIndex: number = 0;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get children(): MockElement[] {
    return this.childNodes.filter((n): n is MockElement => typeof n !== 'string');
  }

  get className(): string {
    return this.getAttribute('class') || '';
  }
  set className(val: string) {
    this.setAttribute('class', val);
  }

  get textContent(): string {
    return this.childNodes.map(n => (typeof n === 'string' ? n : n.textContent)).join('');
  }
  set textContent(val: string) {
    this.childNodes = [val];
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[camel] = value;
    }
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[camel];
    }
  }
  remove() {
    if (this.parent) {
      const idx = this.parent.childNodes.indexOf(this);
      if (idx !== -1) this.parent.childNodes.splice(idx, 1);
    }
  }
  replaceWith(newNode: MockElement) {
    if (this.parent) {
      const idx = this.parent.childNodes.indexOf(this);
      if (idx !== -1) {
        this.parent.childNodes.splice(idx, 1, newNode);
        newNode.parent = this.parent;
      }
    }
  }
  append(child: MockElement) {
    this.childNodes.push(child);
    child.parent = this;
  }

  set innerHTML(html: string) {
    this.childNodes = [];
    const doc = parseHtml(html);
    for (const c of doc.childNodes) {
      if (typeof c === 'string') {
        this.childNodes.push(c);
      } else {
        this.append(c);
      }
    }
  }

  get innerHTML(): string {
    return serializeChildren(this);
  }
}

function parseHtml(html: string): MockElement {
  const root = new MockElement('BODY');
  let current: MockElement = root;
  const tagRegex = /<(\/)?([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let match;
  while ((match = tagRegex.exec(html)) !== null) {
    const [_, isClose, tagName, attrString, text] = match;
    if (text) {
      current.childNodes.push(text);
      continue;
    }
    if (isClose) {
      if (current.parent) current = current.parent;
    } else {
      const el = new MockElement(tagName);
      if (attrString) {
        const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrString)) !== null) {
          const name = attrMatch[1];
          const val = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
          el.setAttribute(name, val);
        }
      }
      current.append(el);
      if (!['IMG', 'BR', 'HR', 'INPUT'].includes(el.tagName)) {
        current = el;
      }
    }
  }
  return root;
}

function serialize(el: MockElement): string {
  let attrs = '';
  for (const [k, v] of Object.entries(el.attributes)) {
    attrs += ` ${k}="${v}"`;
  }
  for (const [k, v] of Object.entries(el.dataset)) {
    const kebab = 'data-' + k.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (!el.attributes[kebab]) {
      attrs += ` ${kebab}="${v}"`;
    }
  }
  if (['IMG', 'BR', 'HR'].includes(el.tagName)) {
    return `<${el.tagName.toLowerCase()}${attrs} />`;
  }
  return `<${el.tagName.toLowerCase()}${attrs}>${serializeChildren(el)}</${el.tagName.toLowerCase()}>`;
}

function serializeChildren(el: MockElement): string {
  return el.childNodes.map(n => (typeof n === 'string' ? n : serialize(n))).join('');
}

function queryAll(node: MockElement, predicate: (el: MockElement) => boolean): MockElement[] {
  const result: MockElement[] = [];
  for (const child of node.children) {
    if (predicate(child)) result.push(child);
    result.push(...queryAll(child, predicate));
  }
  return result;
}

class MockDocument {
  body: MockElement;
  constructor(html: string) {
    this.body = parseHtml(html);
  }
  createElement(tag: string) {
    return new MockElement(tag);
  }
  querySelectorAll(sel: string) {
    const tags = sel.toLowerCase().split(',').map(s => s.trim());
    return queryAll(this.body, el => tags.includes(el.tagName.toLowerCase()));
  }
}

class MockDOMParser {
  parseFromString(html: string) {
    return new MockDocument(html);
  }
}

beforeEach(() => {
  vi.stubGlobal('DOMParser', MockDOMParser);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderNote YouTube embeds', () => {
  it('transforms standalone YouTube watch URL into a responsive embed container with poster facade', () => {
    const markdown = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const html = renderNote(markdown, 'notes/demo/test.md');
    expect(html).toContain('class="note-youtube-embed"');
    expect(html).toContain('data-video-id="dQw4w9WgXcQ"');
    expect(html).toContain('data-start="0"');
    expect(html).toContain('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(html).toContain('note-youtube-poster');
    expect(html).toContain('note-youtube-play-btn');
  });

  it('preserves start timestamp from URL query parameters', () => {
    const markdown = 'https://youtu.be/dQw4w9WgXcQ?t=1m30s';
    const html = renderNote(markdown, 'notes/demo/test.md');
    expect(html).toContain('data-video-id="dQw4w9WgXcQ"');
    expect(html).toContain('data-start="90"');
  });

  it('handles bracketed markdown link containing solely a YouTube URL', () => {
    const markdown = '[Watch video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)';
    const html = renderNote(markdown, 'notes/demo/test.md');
    expect(html).toContain('class="note-youtube-embed"');
    expect(html).toContain('data-video-id="dQw4w9WgXcQ"');
  });

  it('keeps inline YouTube links within paragraph text as standard hyperlinks', () => {
    const markdown = 'Check this video https://www.youtube.com/watch?v=dQw4w9WgXcQ for more information.';
    const html = renderNote(markdown, 'notes/demo/test.md');
    expect(html).not.toContain('class="note-youtube-embed"');
    expect(html).toContain('<a ');
    expect(html).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
    expect(html).toContain('target="_blank"');
  });

  it('does not transform non-YouTube URLs into embeds', () => {
    const markdown = 'https://example.com/some-page';
    const html = renderNote(markdown, 'notes/demo/test.md');
    expect(html).not.toContain('note-youtube-embed');
    expect(html).toContain('href="https://example.com/some-page"');
  });
});
