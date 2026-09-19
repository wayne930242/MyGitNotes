import { expect, it } from 'vitest';
import { resolveWorkspaceHref, headingSlug } from './workspace-links.js';
it('resolves relative notes, cross-notebook references, encoded assets and anchors', () => {
  const source = 'notes/a/folder/readme.md';
  expect(resolveWorkspaceHref('../next.md#Part%202', source)).toEqual({ kind: 'path', path: 'notes/a/next.md', anchor: 'Part 2' });
  expect(resolveWorkspaceHref('../../b/guide.md', source)).toMatchObject({ path: 'notes/b/guide.md' });
  expect(resolveWorkspaceHref('notes/b/assets/%E5%9C%B0%E5%9C%96%20%231.png', source)).toMatchObject({ path: 'notes/b/assets/地圖 #1.png' });
  expect(resolveWorkspaceHref('#標題', source)).toEqual({ kind: 'anchor', anchor: '標題' });
  expect(headingSlug('## **First** 標題！')).toBe('first-標題');
});
it('keeps safe external links and rejects unsafe protocols and escaping paths', () => {
  expect(resolveWorkspaceHref('https://example.com/page', 'notes/a/a.md')).toMatchObject({ kind: 'external' });
  expect(resolveWorkspaceHref('mailto:reader@example.com', 'notes/a/a.md')).toMatchObject({ kind: 'external' });
  for (const href of ['javascript:alert(1)', 'data:text/html,bad', 'file:///tmp/a', '../../../outside', '../%2e%2e/../outside', '..\\private', '%zz']) {
    expect(resolveWorkspaceHref(href, 'notes/a/a.md')).toBeNull();
  }
});

it('treats a same-origin absolute URL as internal when the current origin is given, and external otherwise', () => {
  const origin = 'https://notes.wayneh.tw';
  expect(resolveWorkspaceHref(`${origin}/notebooks/x/notes/y.md`, 'notes/a.md', undefined, origin)).toEqual({ kind: 'route', url: '/notebooks/x/notes/y.md' });
  expect(resolveWorkspaceHref(`${origin}/graph`, 'notes/a.md', undefined, origin)).toEqual({ kind: 'route', url: '/graph' });
  expect(resolveWorkspaceHref(`${origin}/notebooks/x/notes/y.md`, 'notes/a.md')).toMatchObject({ kind: 'external' });
  expect(resolveWorkspaceHref('https://other.example/notebooks/x/notes/y.md', 'notes/a.md', undefined, origin)).toMatchObject({ kind: 'external' });
});

it('resolves alias paths from notebook pathAliases', () => {
  const notebooks = [
    {
      id: 'blog',
      title: 'Blog',
      root: 'blog/src/content/posts',
      pathAliases: {
        '@/*': 'blog/src/*',
      },
    },
  ];
  const source = 'blog/src/content/posts/tech/note.md';
  expect(resolveWorkspaceHref('@/assets/images/pic.png', source, notebooks)).toEqual({
    kind: 'path',
    path: 'blog/src/assets/images/pic.png',
    anchor: '',
  });
});
