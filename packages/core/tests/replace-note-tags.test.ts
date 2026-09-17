import { describe, expect, it } from 'vitest';
import { parseNoteContent, replaceNoteTags } from '../src/frontmatter.js';

describe('replaceNoteTags preserves the original frontmatter text', () => {
  it.each(['\n', '\r\n'])('changes only the tags value with %j line endings, flow middle key', eol => {
    const raw = ['---', 'id: x', 'tags: [a, b, c]', "title: '原始標題'", 'custom: {x: 1,y: 2}', '---', '', '正文  ', ''].join(eol);
    const updated = replaceNoteTags(raw, ['a', 'x']);
    expect(updated).toBe(raw.replace('tags: [a, b, c]', 'tags: [a, x]'));
  });

  it.each(['\n', '\r\n'])('changes only the tags value with %j line endings, block middle key', eol => {
    const raw = ['---', 'id: x', 'tags:', '  - a', '  - b', '  - c', "title: '原始標題'", '---', '', '正文', ''].join(eol);
    const updated = replaceNoteTags(raw, ['a', 'x']);
    expect(updated).toBe(['---', 'id: x', 'tags:', '  - a', '  - x', "title: '原始標題'", '---', '', '正文', ''].join(eol));
  });

  it('handles tags as the last frontmatter key, flow style, without adding a trailing newline', () => {
    const raw = '---\nid: x\ntitle: y\ntags: [a, b, c]\n---\nbody\n';
    expect(replaceNoteTags(raw, ['a', 'x'])).toBe('---\nid: x\ntitle: y\ntags: [a, x]\n---\nbody\n');
  });

  it('handles tags as the last frontmatter key, block style, without duplicating a blank line', () => {
    const raw = '---\nid: x\ntitle: y\ntags:\n  - a\n  - b\n  - c\n---\nbody\n';
    expect(replaceNoteTags(raw, ['a', 'x'])).toBe('---\nid: x\ntitle: y\ntags:\n  - a\n  - x\n---\nbody\n');
  });

  it('renders an empty result inline as [] even when the original was block style', () => {
    const raw = '---\nid: x\ntags:\n  - only\n---\nbody\n';
    expect(replaceNoteTags(raw, [])).toBe('---\nid: x\ntags: []\n---\nbody\n');
  });

  it('renders an empty result inline as [] when the original was flow style', () => {
    const raw = '---\ntags: [only]\n---\nbody\n';
    expect(replaceNoteTags(raw, [])).toBe('---\ntags: []\n---\nbody\n');
  });

  it('preserves a trailing inline comment on the tags line', () => {
    const raw = '---\ntags: [a, b] # keep\ntitle: y\n---\nbody\n';
    expect(replaceNoteTags(raw, ['a'])).toBe('---\ntags: [a] # keep\ntitle: y\n---\nbody\n');
  });

  it('preserves a flow-mapping frontmatter (`{...}`) style', () => {
    const raw = '---\n{status: learning, tags: ["a"]}\n---\nbody\n';
    expect(replaceNoteTags(raw, ['a', 'b'])).toBe('---\n{status: learning, tags: [a, b]}\n---\nbody\n');
  });

  it('quotes tag values that need quoting and leaves plain ones bare', () => {
    const raw = '---\ntags: ["規則"]\n---\nbody\n';
    const updated = replaceNoteTags(raw, ['a: b', '規則']);
    expect(updated).toBe('---\ntags: ["a: b", 規則]\n---\nbody\n');
    expect(parseNoteContent(updated).metadata.tags).toEqual(['a: b', '規則']);
  });

  it('keeps CRLF line endings inside a rewritten block sequence', () => {
    const raw = '---\r\nid: x\r\ntags:\r\n  - a\r\n  - b\r\n---\r\nbody\r\n';
    expect(replaceNoteTags(raw, ['a', 'x', 'y'])).toBe('---\r\nid: x\r\ntags:\r\n  - a\r\n  - x\r\n  - y\r\n---\r\nbody\r\n');
  });

  it('leaves the body and every other field untouched, including a note with no body', () => {
    const raw = '---\ntags: [a]\n---';
    expect(replaceNoteTags(raw, ['a', 'b'])).toBe('---\ntags: [a, b]\n---');
  });

  it('is a no-op when there is no frontmatter at all', () => {
    const raw = 'plain body, no frontmatter\n';
    expect(replaceNoteTags(raw, ['a'])).toBe(raw);
  });
});
