import { describe, it, expect } from 'vitest';
import { searchNotes, searchTerms } from '../src/note-search.js';
import type { NoteItem } from '../src/types.js';

const note = (path: string, title: string, content: string, extra: Partial<NoteItem> = {}): NoteItem => ({
  id: path, path, notebookId: path.split('/')[0], title, content, metadata: {}, tags: [], ...extra,
});

const notes: NoteItem[] = [
  note('blog/watermark.mdx', '我是不是「被 AI」了——文字工作者如何面對 AI 浮水印', '文責與製程的誠實。\n浮水印不能證明作者。'),
  note('blog/apology.md', '道歉的哲學', '「因為你生氣所以我道歉」為何不妥？\n道歉要表達對規則的重視。'),
  note('blog/logic.md', '普通人的邏輯學', '邏輯與道德無關。'),
  note('thesis/readings/fine1994essence/index.md', 'Essence and Modality', 'Reading entry.', { status: 'read', tags: ['reading', '形上學'], metadata: { citekey: 'fine1994essence', status: 'read' } }),
  note('thesis/readings/sidelle2023-grounding-mystique/notes.md', 'Reading Notes', 'Deflationism about ground.', { status: 'reading', tags: ['立基', '超內涵性'] }),
  note('literature/fine1994essence/paper.md', 'paper', 'ESSENCE AND MODALITY\nKit Fine argues essence is not modal.'),
  note('life/bridge/mltc.md', '現代失墩計算法 (MLTC) 概要', '橋牌失墩計算。', { tags: ['橋牌'] }),
];

describe('searchNotes', () => {
  it('ranks a note matching several independent words above notes matching one', () => {
    const { matches } = searchNotes(notes, { query: 'AI 浮水印 文責 製程 誠實' });
    expect(matches[0].path).toBe('blog/watermark.mdx');
    expect(matches[0].matchedTerms).toEqual(expect.arrayContaining(['浮水印', '文責']));
    expect(matches[0].snippet).toContain('文責');
  });

  it('matches an unspaced Chinese question through partial phrases', () => {
    const { matches } = searchNotes(notes, { query: '道歉時說因為你不高興所以對不起哪裡有問題' });
    expect(matches[0].path).toBe('blog/apology.md');
  });

  it('finds citation keys and reading slugs that only appear in paths or frontmatter', () => {
    const paths = searchNotes(notes, { query: 'fine1994essence' }).matches.map((m) => m.path);
    expect(paths).toEqual(expect.arrayContaining(['thesis/readings/fine1994essence/index.md', 'literature/fine1994essence/paper.md']));
    expect(searchNotes(notes, { query: 'sidelle2023-grounding-mystique' }).matches[0].path).toBe('thesis/readings/sidelle2023-grounding-mystique/notes.md');
  });

  it('lists notes by status, tags and notebook without a query', () => {
    expect(searchNotes(notes, { notebookId: 'thesis', status: 'reading' }).matches.map((m) => m.path)).toEqual(['thesis/readings/sidelle2023-grounding-mystique/notes.md']);
    const tagged = searchNotes(notes, { tags: ['橋牌'] });
    expect(tagged.matches).toMatchObject([{ path: 'life/bridge/mltc.md', tags: ['橋牌'], status: null }]);
  });

  it('applies filters before ranking a query', () => {
    const { matches } = searchNotes(notes, { query: 'essence', notebookId: 'literature' });
    expect(matches.map((m) => m.path)).toEqual(['literature/fine1994essence/paper.md']);
  });

  it('keeps regular expression semantics and reports limit truncation', () => {
    const regex = searchNotes(notes, { query: '道歉[要為]', isRegex: true });
    expect(regex.matches.map((m) => m.path)).toEqual(['blog/apology.md']);
    const limited = searchNotes(notes, { query: 'e', limit: 1 });
    expect(limited.matches).toHaveLength(1);
    expect(limited.truncated).toBe(true);
    expect(limited.total).toBeGreaterThan(1);
  });

  it('rejects an empty search, an invalid limit and an invalid regular expression', () => {
    expect(() => searchNotes(notes, {})).toThrow(/query or at least one filter/);
    expect(() => searchNotes(notes, { query: 'x', limit: 0 })).toThrow(/limit/);
    expect(() => searchNotes(notes, { query: '(', isRegex: true })).toThrow(/Invalid regular expression/);
  });
});

describe('searchTerms', () => {
  it('splits on spaces and punctuation and adds Han bigrams at lower weight', () => {
    expect(searchTerms('Essence, 超內涵性')).toEqual([
      { term: 'essence', weight: 1 },
      { term: '超內涵性', weight: 1 },
      { term: '超內', weight: 0.5 },
      { term: '內涵', weight: 0.5 },
      { term: '涵性', weight: 0.5 },
    ]);
  });
});

describe('searchNotes match counts and regex input', () => {
  it('counts title matches for query words but not Han bigrams', () => {
    const [match] = searchNotes([note('a/x.md', 'Hello', 'body')], { query: 'hello' }).matches;
    expect(match.matchCount).toBe(1);
    const [han] = searchNotes([note('a/y.md', 't', '中文字')], { query: '中文字' }).matches;
    expect(han.matchCount).toBe(1);
  });

  it('keeps leading whitespace in a regular expression', () => {
    const items = [note('a/x.md', 't', 'foo'), note('a/y.md', 't', 'a foo')];
    expect(searchNotes(items, { query: ' foo', isRegex: true }).matches.map((m) => m.path)).toEqual(['a/y.md']);
  });
});
