import { expect, it } from 'vitest';
import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { CompilationAsset } from '../components/CompilationCard.js';
import { type BookEntry, bookChapters, bookEntries, chapterAnchor, sectionAnchor } from './book-chapters.js';

const note = (path: string, title: string) => ({ id: path, path, notebookId: 'nb', title, tags: [], metadata: {}, content: '' }) as NoteListItem;
const asset = { name: 'pic.png', path: 'notes/nb/pic.png', notebookId: 'nb', size: 1, mtime: 1, rawUrl: '/pic.png' } as unknown as CompilationAsset;
const items: CompilationItem[] = [
  { id: 'n1', kind: 'note', notebookId: 'nb', path: 'notes/nb/a.md' },
  { id: 'n2', kind: 'note', notebookId: 'nb', path: 'notes/nb/gone.md' },
  { id: 'f1', kind: 'folder', notebookId: 'nb', path: 'notes/nb/sub' },
  { id: 'a1', kind: 'asset', notebookId: 'nb', path: 'notes/nb/pic.png' },
  { id: 'a2', kind: 'asset', notebookId: 'nb', path: 'notes/nb/lost.png' },
  { id: 'y1', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' },
];

it('makes a chapter of each member in order, titled the way lane cards title them', () => {
  const chapters = bookChapters(items, [note('notes/nb/a.md', 'Alpha')], [asset]);
  expect(chapters.map(chapter => [chapter.id, chapter.kind, chapter.title])).toEqual([['n1', 'note', 'Alpha'], ['n2', 'note', 'gone.md'], ['f1', 'folder', 'sub'], ['a1', 'asset', 'pic.png'], ['a2', 'asset', 'lost.png'], ['y1', 'youtube', 'A talk']]);
  expect(chapters[0].note?.title).toBe('Alpha');
  expect(chapters[3].asset?.name).toBe('pic.png');
  expect(new Set(chapters.map(chapter => chapter.anchor)).size).toBe(chapters.length);
});

it('marks a note or file that is not there as missing, but only once the notes have loaded', () => {
  const loaded = bookChapters(items, [note('notes/nb/a.md', 'Alpha')], [asset]);
  expect(loaded.filter(chapter => chapter.missing).map(chapter => chapter.id)).toEqual(['n2', 'a2']);
  const loading = bookChapters(items, [note('notes/nb/a.md', 'Alpha')], [asset], true);
  expect(loading.filter(chapter => chapter.missing).map(chapter => chapter.id)).toEqual(['a2']);
});

it('matches notes by notebook as well as path', () => {
  const other = { ...note('notes/nb/a.md', 'Other notebook'), notebookId: 'other' };
  expect(bookChapters([items[0]], [other], [])[0].note).toBeUndefined();
});

it('lists every chapter with a folder\'s note sections beneath it and the missing label on a missing chapter', () => {
  const chapters = bookChapters(items.slice(0, 3), [note('notes/nb/a.md', 'Alpha')], []);
  const sections = new Map<string, BookEntry[]>([['f1', [{ anchor: sectionAnchor(items[2], 'notes/nb/sub/x.md'), title: 'X', level: 1 }, { anchor: sectionAnchor(items[2], 'notes/nb/sub/y.md'), title: 'Y', level: 1 }]]]);
  expect(bookEntries(chapters, sections).map(entry => [entry.title, entry.level, entry.missing ?? false])).toEqual([['Alpha', 0, false], ['gone.md', 0, true], ['sub', 0, false], ['X', 1, false], ['Y', 1, false]]);
});

it('shows the title of the section being edited instead of the saved one', () => {
  const chapters = bookChapters(items.slice(0, 1), [note('notes/nb/a.md', 'Alpha')], []);
  expect(bookEntries(chapters, new Map(), new Map([[chapterAnchor(items[0]), 'Alpha, retitled']]))[0].title).toBe('Alpha, retitled');
});

it('holds an empty contents list for a compilation with no members', () => {
  expect(bookEntries(bookChapters([], [], []), new Map())).toEqual([]);
});
