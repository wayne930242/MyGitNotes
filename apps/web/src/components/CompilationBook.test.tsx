// @vitest-environment jsdom
import { createElement, type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import { CompilationEditingProvider, useCompilationEditing } from '../lib/compilation-editing.js';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { CompilationBook } from './CompilationBook.js';

const flushEditors = vi.fn<(keys?: readonly string[]) => Promise<boolean>>();
const editorProps = vi.fn<(note: { notebookId: string; }) => { readOnly: boolean; }>();
vi.mock('../lib/note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors, refreshNotes: async () => {}, editorProps }) }));
/** Paths whose editor renders into the page's body instead of the section, as a note's zoom borrowing it does. */
const portalled = new Set<string>();
vi.mock('./NoteEditorHost.js', () => ({
  HostedNoteEditor: ({ path, onSession }: { path: string; onSession?: (session: { content: string; title: string; dirty: boolean; locked: boolean; } | null) => void; }) => {
    useEffect(() => {
      onSession?.({ content: 'body', title: `Editing ${path}`, dirty: false, locked: false });
      return () => onSession?.(null);
    }, [onSession, path]);
    const editor = createElement('textarea', { 'aria-label': portalled.has(path) ? 'Zoom editor' : 'Note content', 'defaultValue': 'body' });
    return portalled.has(path) ? createPortal(editor, document.body) : editor;
  },
}));
const laneOverride: { current: ReturnType<typeof import('../lib/compilation-queries.js').useLaneNotes> | null; } = { current: null };
vi.mock('../lib/compilation-queries.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/compilation-queries.js')>();
  return { ...actual, useLaneNotes: (...args: Parameters<typeof actual.useLaneNotes>) => laneOverride.current ?? actual.useLaneNotes(...args) };
});

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const noteA = { id: 'notes/nb1/a.md', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', tags: [], metadata: {}, content: '# Chapter One\n\nThe body of note A.' };
const row: CompilationRow = { id: 'row-1', path: 'notes/nb1/reading.compilation.yml', name: 'Reading', view: 'book', notebookId: 'nb1', kind: 'custom', items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/gone.md' }, { id: 'item-3', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' }] };
const study: StudyController = { study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {}, loading: false, saving: false, error: '', writable: false };

beforeEach(() => {
  flushEditors.mockReset().mockResolvedValue(true);
  editorProps.mockReset().mockReturnValue({ readOnly: false });
  portalled.clear();
  laneOverride.current = null;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [noteA] }), { headers: { 'Content-Type': 'application/json' } })));
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const Editing = ({ children }: { children: ReactNode; }) => createElement(CompilationEditingProvider, { value: useCompilationEditing() }, children);
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, createElement(Editing, null, children));
const book = (props: Partial<Parameters<typeof CompilationBook>[0]> = {}) => createElement(CompilationBook, { row, study, notebooks, assets: [], onOpen: () => {}, disabled: false, readOnly: true, ...props });
const chapters = () => [...document.querySelectorAll<HTMLElement>('.compilation-book > .compilation-book-section')];

it('lays the items out in order as chapters: the full note, a missing notice in place, the video player', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  expect(screen.getByText('The body of note A.')).toBeInTheDocument();
  expect(within(chapters()[0]).getByRole('heading', { level: 2, name: 'Note A' })).toBeInTheDocument();
  expect(chapters().map(chapter => within(chapter).getByRole('heading', { level: 2 }).textContent)).toEqual(['Note A', 'gone.md', 'A talk']);
  expect(within(chapters()[1]).getByText('This item may have moved or been deleted.')).toBeInTheDocument();
  expect(within(chapters()[2]).getByLabelText('Play video: A talk')).toBeInTheDocument();
});

it('names every chapter in a Contents landmark, marks the missing one, and jumps to a chapter on click', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  const nav = screen.getByRole('navigation', { name: 'Contents' });
  const entries = within(nav).getAllByRole('button');
  expect(entries.map(entry => entry.textContent)).toEqual(['Note A', 'gone.md', 'A talk']);
  expect(within(entries[1]).getByLabelText('This item may have moved or been deleted.')).toBeInTheDocument();
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  const heading = within(chapters()[2]).getByRole('heading', { level: 2 });
  body.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  heading.getBoundingClientRect = () => ({ top: 700 }) as DOMRect;
  body.scrollTop = 50;
  fireEvent.click(entries[2]);
  expect(body.scrollTo).toHaveBeenCalledWith({ top: 650, behavior: 'smooth' });
  expect(heading).toHaveFocus();
  expect(window.location.hash).toBe('');
});

it('jumps without animation for a reader who prefers reduced motion', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: /A talk/ }));
  expect(document.querySelector<HTMLElement>('.compilation-book')!.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
});

it('highlights the entry whose heading last passed the top quarter of the body', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  body.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(body, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true });
  const tops = [-500, 150, 900];
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: tops[index] }) as DOMRect;
  });
  act(() => void body.dispatchEvent(new Event('scroll')));
  await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: /gone\.md/ })).toHaveAttribute('aria-current', 'location'));
  expect(within(screen.getByRole('navigation', { name: 'Contents' })).getAllByRole('button').filter(entry => entry.getAttribute('aria-current'))).toHaveLength(1);
});

it('opens an item from its heading', async () => {
  const onOpen = vi.fn();
  render(book({ onOpen }), { wrapper });
  fireEvent.click(await waitFor(() => within(chapters()[0]).getByRole('button', { name: 'Note A' })));
  expect(onOpen).toHaveBeenCalledWith(row.kind === 'custom' ? row.items[0] : undefined, expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it('is read-only: no Edit control, no drag handle or unpin control, and a body click opens the note', async () => {
  const onOpen = vi.fn();
  render(book({ onOpen }), { wrapper });
  await waitFor(() => expect(screen.getByText('The body of note A.')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Move item: Note A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Unpin: Note A')).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  fireEvent.click(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it("edits a note section in place, saves it for the next one, and follows the editor's title in the contents", async () => {
  render(book({ readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  const section = chapters()[0];
  await waitFor(() => expect(section).toHaveAttribute('data-editing'));
  expect(within(section).getByLabelText('Note content')).toBeInTheDocument();
  expect(within(section).getByRole('heading', { level: 2 })).toHaveTextContent('Editing notes/nb1/a.md');
  expect(await within(screen.getByRole('navigation', { name: 'Contents' })).findByRole('button', { name: /Editing notes\/nb1\/a\.md/ })).toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(section).not.toHaveAttribute('data-editing'));
  expect(flushEditors).toHaveBeenCalledWith(['nb1:notes/nb1/a.md']);
  expect(within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: /Note A/ })).toBeInTheDocument();
});

it('highlights the chapter that edits in the contents wherever the book is scrolled, and scrolling decides again once editing ends (B12)', async () => {
  const noteB = { ...noteA, id: 'notes/nb1/b.md', path: 'notes/nb1/b.md', title: 'Note B', content: '# Chapter Two\n\nThe body of note B.' };
  const pair: CompilationRow = { ...row, items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }] };
  laneOverride.current = { notes: [noteA, noteB] as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} };
  render(book({ row: pair, readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  const body = document.querySelector<HTMLElement>('.compilation-book')!;
  // The reader scrolls to the end of the book, where the second chapter is the one in view.
  body.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(body, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true });
  chapters().forEach((chapter, index) => {
    within(chapter).getByRole('heading', { level: 2 }).getBoundingClientRect = () => ({ top: [-2000, 100][index] }) as DOMRect;
  });
  act(() => void body.dispatchEvent(new Event('scroll')));
  const nav = screen.getByRole('navigation', { name: 'Contents' });
  const current = () => within(nav).getAllByRole('button').filter(entry => entry.getAttribute('aria-current') === 'location').map(entry => entry.textContent);
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  expect(current()).toEqual(['Editing notes/nb1/a.md']);
  fireEvent.click(within(chapters()[0]).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(chapters()[0]).not.toHaveAttribute('data-editing'));
  await waitFor(() => expect(current()).toEqual(['Note B']));
});

it('ends a section only on keys typed inside it, not on keys of its editor portalled into zoom (E4, K2)', async () => {
  portalled.add('notes/nb1/a.md');
  render(book({ readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  const zoomEditor = await screen.findByLabelText('Zoom editor');
  expect(chapters()[0]).not.toContainElement(zoomEditor);
  fireEvent.keyDown(zoomEditor, { key: 'Escape' });
  await act(async () => {});
  expect(chapters()[0]).toHaveAttribute('data-editing');
  expect(flushEditors).not.toHaveBeenCalled();
});

it('holds same-named notes of different folders apart while one edits, as a note id is not unique (E11)', async () => {
  const notesAt = ['x', 'y'].map(folder => ({ id: 'index', path: `notes/nb1/${folder}/index.md`, notebookId: 'nb1', title: `Index ${folder}`, tags: [], metadata: {}, content: `Body of ${folder}` }));
  laneOverride.current = { notes: notesAt as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} };
  const same: CompilationRow = { ...row, items: ['x', 'y'].map(folder => ({ id: `pin-${folder}`, kind: 'note' as const, notebookId: 'nb1', path: `notes/nb1/${folder}/index.md` })) };
  render(book({ row: same, readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Index x' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  expect(screen.getByText('Body of y')).toBeInTheDocument();
  expect(within(chapters()[1]).getByRole('button', { name: 'Edit Index y' })).toBeInTheDocument();
  expect(screen.queryByText('This item may have moved or been deleted.')).not.toBeInTheDocument();
  expect(chapters()).toHaveLength(2);
});

it('offers no Edit on a note whose repository cannot be written, though the compilation can (E13)', async () => {
  editorProps.mockImplementation(note => ({ readOnly: note.notebookId === 'nb1' }));
  const onOpen = vi.fn();
  render(book({ readOnly: false, onOpen }), { wrapper });
  await waitFor(() => expect(screen.getByText('The body of note A.')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
  fireEvent.pointerDown(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  fireEvent.click(screen.getByText('The body of note A.'), { pointerType: 'mouse' });
  expect(chapters()[0]).not.toHaveAttribute('data-editing');
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }), expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it("lists a folder's notes as sub-sections under it, in the book and in the contents, each a note section", async () => {
  const folder: CompilationRow = { ...row, items: [{ id: 'folder-1', kind: 'folder', notebookId: 'nb1', path: 'notes/nb1/sub' }] };
  render(book({ row: folder, readOnly: false }), { wrapper });
  await waitFor(() => expect(within(chapters()[0]).getByRole('heading', { level: 3, name: 'Note A' })).toBeInTheDocument());
  expect(within(chapters()[0]).getByRole('heading', { level: 2, name: 'sub' })).toBeInTheDocument();
  expect(within(chapters()[0]).getByRole('button', { name: 'Edit Note A' })).toBeInTheDocument();
  const entries = within(screen.getByRole('navigation', { name: 'Contents' })).getAllByRole('listitem');
  expect(entries.map(entry => [entry.textContent, entry.getAttribute('data-level')])).toEqual([['sub', '0'], ['Note A', '1']]);
});

it('shows the empty message and an empty contents list for a compilation with no members', () => {
  render(book({ row: { ...row, items: [] } }), { wrapper });
  expect(screen.getByText('Add notes, folders, assets or YouTube, or drag from another custom compilation.')).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Contents' })).queryAllByRole('button')).toHaveLength(0);
});

it('ends the contents list with Load more chapters while a paging dynamic compilation has more', async () => {
  const loadMore = vi.fn();
  laneOverride.current = { notes: [noteA] as never, loading: false, error: '', hasMore: true, loadingMore: false, loadMore };
  const dynamic: CompilationRow = { id: 'live', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'book', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'tag', tag: 'clue', notebookId: 'nb1' }, sort: { field: 'title', order: 'asc' } };
  render(book({ row: dynamic }), { wrapper });
  const more = within(screen.getByRole('navigation', { name: 'Contents' })).getByRole('button', { name: 'Load more chapters' });
  fireEvent.click(more);
  expect(loadMore).toHaveBeenCalledTimes(1);
  laneOverride.current = { notes: [noteA] as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore };
  cleanup();
  render(book({ row: dynamic }), { wrapper });
  expect(screen.queryByRole('button', { name: 'Load more chapters' })).not.toBeInTheDocument();
});

it('moves the contents into a drawer behind a Contents button: choosing an entry closes it and jumps, Escape or the close button returns focus', async () => {
  render(book(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  const open = screen.getByRole('button', { name: 'Show contents' });
  fireEvent.click(open);
  const drawer = screen.getByRole('dialog', { name: 'Contents' });
  expect(within(drawer).getByRole('button', { name: 'Close contents' })).toHaveFocus();
  fireEvent.click(within(drawer).getByRole('button', { name: /A talk/ }));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(within(chapters()[2]).getByRole('heading', { level: 2 })).toHaveFocus();

  fireEvent.click(open);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(open).toHaveFocus();

  fireEvent.click(open);
  fireEvent.click(screen.getByRole('button', { name: 'Close contents' }));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(open).toHaveFocus();

  fireEvent.click(open);
  fireEvent.click(screen.getByTestId('book-drawer-backdrop'));
  expect(screen.queryByRole('dialog', { name: 'Contents' })).not.toBeInTheDocument();
  expect(open).toHaveFocus();
});

it('keeps a section editing, and every chapter as a note, when its note drops out of the loaded notes while it edits (E11)', async () => {
  const noteB = { ...noteA, id: 'notes/nb1/b.md', path: 'notes/nb1/b.md', title: 'Note B', content: '# Chapter Two\n\nThe body of note B.' };
  const pair: CompilationRow = { ...row, items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' }] };
  const lane = (notes: unknown[]) => ({ notes: notes as never, loading: false, error: '', hasMore: false, loadingMore: false, loadMore: () => {} });
  laneOverride.current = lane([noteA, noteB]);
  const { rerender } = render(book({ row: pair, readOnly: false }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(chapters()[0]).toHaveAttribute('data-editing'));
  // A page of the dynamic list moves on and takes the edited note and its neighbour out of what is loaded.
  laneOverride.current = lane([]);
  rerender(book({ row: pair, readOnly: false }));
  expect(chapters()[0]).toHaveAttribute('data-editing');
  expect(within(chapters()[0]).getByLabelText('Note content')).toBeInTheDocument();
  expect(screen.queryByText('This item may have moved or been deleted.')).not.toBeInTheDocument();
  expect(chapters().map(chapter => within(chapter).getByRole('heading', { level: 2 }).textContent)).toEqual(['Editing notes/nb1/a.md', 'Note B']);
  fireEvent.click(within(chapters()[0]).getByRole('button', { name: /^Finish editing/ }));
  await waitFor(() => expect(chapters()[0]).not.toHaveAttribute('data-editing'));
  // With editing over, the live notes apply again.
  await waitFor(() => expect(screen.getAllByText('This item may have moved or been deleted.')).toHaveLength(2));
});
