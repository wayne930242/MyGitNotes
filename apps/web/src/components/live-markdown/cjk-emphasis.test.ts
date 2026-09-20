// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { renderNote } from '../../lib/markdown.js';
import { cjkEmphasis } from './cjk-emphasis.js';

const lezer = markdown({ base: markdownLanguage, extensions: [cjkEmphasis] }).language.parser;

/** What the editor would show in bold or italic, as `StrongEmphasis 二口女` lines. */
function editorEmphasis(source: string) {
  const found: string[] = [];
  lezer.parse(source).iterate({
    enter(node) {
      if (node.name !== 'Emphasis' && node.name !== 'StrongEmphasis') return;
      const cuts: [number, number][] = [];
      node.node.cursor().iterate(inner => {
        if (inner.name.endsWith('Mark')) cuts.push([inner.from, inner.to]);
      });
      let text = '';
      for (let pos = node.from; pos < node.to; pos++) {
        if (!cuts.some(([from, to]) => pos >= from && pos < to)) text += source[pos];
      }
      found.push(`${node.name} ${text}`);
    },
  });
  return found.sort();
}

/** The same lines, read back off the rendered note. */
function renderedEmphasis(source: string) {
  const body = new DOMParser().parseFromString(renderNote(source, 'note.md'), 'text/html').body;
  return [...body.querySelectorAll('strong,em')].map(node => `${node.tagName === 'STRONG' ? 'StrongEmphasis' : 'Emphasis'} ${node.textContent}`).sort();
}

const samples = ['中的**二口女（ふたくちおんな）**意象', '**粗體**文字', '中**文**中', '中_文_字', '_斜體_字', '中的_二口女（ふたくちおんな）_意象', '這是_我想做的事。_所以', 'snake_case_word', '這是**我想做的事。**所以繼續', '**「重要」**です', 'a **bold** word', '*斜體*字', '中的***重點***在此', '**巢狀`code`**文', '（括號）**粗**中', '**粗（註）**a', 'a**粗（註）**中', 'a *plain* and _under_ line', 'foo_bar_baz', '(_foo_)', '**unclosed 中文'];

describe('CJK emphasis in the editor', () => {
  it('bolds the case CommonMark leaves as literal asterisks', () => {
    expect(editorEmphasis('中的**二口女（ふたくちおんな）**意象')).toEqual(['StrongEmphasis 二口女（ふたくちおんな）']);
  });
  it.each(samples)('reads %j the same way the renderer does', source => {
    expect(editorEmphasis(source)).toEqual(renderedEmphasis(source));
  });
});
