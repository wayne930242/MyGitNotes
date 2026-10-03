import { describe, expect, it } from 'vitest';
import { applyEdits, formatMarkdown, type MarkdownFormat } from './markdown-format.js';

/** Formats the `[`…`]` selection (or `|` caret) of `marked` and returns the result marked the same way. */
function run(marked: string, format: MarkdownFormat) {
  const caret = marked.indexOf('|');
  const from = caret >= 0 ? caret : marked.indexOf('[');
  const doc = caret >= 0 ? marked.replace('|', '') : marked.replace('[', '').replace(']', '');
  const to = caret >= 0 ? caret : marked.indexOf(']') - 1;
  const result = formatMarkdown(doc, from, to, format);
  const next = applyEdits(doc, result.changes);
  const [start, end] = [Math.min(result.anchor, result.head), Math.max(result.anchor, result.head)];
  return start === end ? `${next.slice(0, start)}|${next.slice(start)}` : `${next.slice(0, start)}[${next.slice(start, end)}]${next.slice(end)}`;
}

describe('inline formats', () => {
  it('wraps a selection and selects the wrapped text', () => {
    expect(run('a [word] b', 'bold')).toBe('a **[word]** b');
    expect(run('a [word] b', 'italic')).toBe('a *[word]* b');
    expect(run('a [word] b', 'underline')).toBe('a <u>[word]</u> b');
    expect(run('a [word] b', 'strikethrough')).toBe('a ~~[word]~~ b');
    expect(run('a [word] b', 'code')).toBe('a `[word]` b');
  });

  it('unwraps when the markers surround the selection, so toggling twice restores the text', () => {
    expect(run('a **[word]** b', 'bold')).toBe('a [word] b');
    expect(run('a *[word]* b', 'italic')).toBe('a [word] b');
    expect(run('a <u>[word]</u> b', 'underline')).toBe('a [word] b');
    expect(run('a ~~[word]~~ b', 'strikethrough')).toBe('a [word] b');
  });

  it('unwraps when the selection includes the markers', () => {
    expect(run('a [**word**] b', 'bold')).toBe('a [word] b');
    expect(run('a [<u>word</u>] b', 'underline')).toBe('a [word] b');
  });

  it('tells bold and italic apart in a run of stars', () => {
    expect(run('a **[word]** b', 'italic')).toBe('a ***[word]*** b');
    expect(run('a ***[word]*** b', 'italic')).toBe('a **[word]** b');
    expect(run('a ***[word]*** b', 'bold')).toBe('a *[word]* b');
    expect(run('a *[word]* b', 'bold')).toBe('a ***[word]*** b');
  });

  it('inserts an empty pair at the caret and removes it when toggled again', () => {
    expect(run('a | b', 'bold')).toBe('a **|** b');
    expect(run('a **|** b', 'bold')).toBe('a | b');
    expect(run('a <u>|</u> b', 'underline')).toBe('a | b');
  });

  it('keeps surrounding whitespace outside the markers', () => {
    expect(run('a[ word ]b', 'bold')).toBe('a **[word]** b');
  });
});

describe('line formats', () => {
  it('adds, switches and removes heading levels', () => {
    expect(run('ti|tle', 'heading2')).toBe('## ti|tle');
    expect(run('# ti|tle', 'heading2')).toBe('## ti|tle');
    expect(run('## ti|tle', 'heading2')).toBe('ti|tle');
  });

  it('turns every selected line into a list item and back', () => {
    expect(run('[one\ntwo]', 'bulletList')).toBe('- [one\n- two]');
    expect(run('[one\ntwo]', 'orderedList')).toBe('1. [one\n2. two]');
    expect(run('- [one\n- two]', 'bulletList')).toBe('[one\ntwo]');
    expect(run('- [one\n- two]', 'taskList')).toBe('- [ ] [one\n- [ ] two]');
    expect(run('  - [ ] t|ask', 'taskList')).toBe('  t|ask');
  });

  it('skips blank lines in a multi-line selection and excludes a line the selection only touches', () => {
    expect(run('[one\n\ntwo\n]three', 'quote')).toBe('> [one\n\n> two\n]three');
    expect(run('> o|ne', 'quote')).toBe('o|ne');
  });
});

describe('block formats', () => {
  it('fences the selection on lines of its own', () => {
    expect(run('a [code] b', 'codeBlock')).toBe('a \n```\n[code]\n```\n b');
    expect(run('|', 'codeBlock')).toBe('```\n|\n```');
  });

  it('builds a link around the selected text', () => {
    expect(run('see [docs] now', 'link')).toBe('see [docs](|) now');
    expect(run('see | now', 'link')).toBe('see [|]() now');
  });

  it('adds a rule below the caret line, separated from text', () => {
    expect(run('te|xt', 'horizontalRule')).toBe('text\n\n---\n|');
    expect(run('text\n|\nmore', 'horizontalRule')).toBe('text\n\n---|\nmore');
    expect(run('|', 'horizontalRule')).toBe('---\n|');
  });
});
