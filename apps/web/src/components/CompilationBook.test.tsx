// @vitest-environment jsdom
import { createElement, type ReactNode, useEffect } from 'react';
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
vi.mock('../lib/note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors, refreshNotes: async () => {} }) }));
vi.mock('./NoteEditorHost.js', () => ({
  HostedNoteEditor: ({ path, onSession }: { path: string; onSession?: (session: { content: string; title: string; dirty: boolean; locked: boolean; } | null) => void; }) => {
    useEffect(() => {
      onSession?.({ content: 'body', title: `Editing ${path}`, dirty: false, locked: false });
      return () => onSession?.(null);
    }, [onSession, path]);
    return createElement('textarea', { 'aria-label': 'Note content', 'defaultValue': 'body' });
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
  const open = screen.getByRole('button', { name: 'Contents' });
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
