// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { horizontalListSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import type { NotebookConfig } from '../lib/types.js';
import { CompilationEditingProvider, useCompilationEditing } from '../lib/compilation-editing.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { CompilationLane } from './CompilationLane.js';

vi.mock('@dnd-kit/sortable', async importOriginal => {
  const original = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return { ...original, SortableContext: vi.fn(original.SortableContext), useSortable: vi.fn(original.useSortable) };
});

const flushEditors = vi.fn<(keys?: readonly string[]) => Promise<boolean>>();
const refreshNotes = vi.fn<() => Promise<void>>();
/** Paths whose editor renders into the page's body instead of the card, as a note's zoom borrowing it does. */
const portalled = new Set<string>();
const editorProps = vi.fn<(note: { notebookId: string; }) => { readOnly: boolean; }>();
vi.mock('../lib/note-editing.js', () => ({ useNoteEditing: () => ({ flushEditors, refreshNotes, editorProps }) }));
vi.mock('./NoteEditorHost.js', () => ({ HostedNoteEditor: ({ path }: { path: string; }) => portalled.has(path) ? createPortal(createElement('textarea', { 'aria-label': 'Zoom editor' }), document.body) : createElement('textarea', { 'aria-label': `Editor ${path}`, 'defaultValue': 'body' }) }));

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const itemA = { id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' } as const;
const itemB = { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/b.md' } as const;
const row: CompilationRow = { id: 'row-1', path: 'notes/nb1/pinned.compilation.yml', name: 'Pinned', view: 'thumbnail', notebookId: 'nb1', kind: 'custom', items: [itemA] };
const two: CompilationRow = { ...row, view: 'small', items: [itemA, itemB] };
const study: StudyController = { study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {}, loading: false, saving: false, error: '', writable: false };

let resizeCallbacks: ResizeObserverCallback[];
beforeEach(() => {
  vi.mocked(SortableContext).mockClear();
  vi.mocked(useSortable).mockClear();
  flushEditors.mockReset().mockResolvedValue(true);
  refreshNotes.mockReset().mockResolvedValue();
  editorProps.mockReset().mockReturnValue({ readOnly: false });
  portalled.clear();
  resizeCallbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [{ id: 'a', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', content: 'Body of A', tags: [], metadata: {} }, { id: 'b', path: 'notes/nb1/b.md', notebookId: 'nb1', title: 'Note B', content: 'Body of B', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const Editing = ({ children }: { children: ReactNode; }) => createElement(CompilationEditingProvider, { value: useCompilationEditing() }, children);
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, createElement(Editing, null, children));

const lane = (props: Partial<Parameters<typeof CompilationLane>[0]> = {}) => createElement(CompilationLane, { row, reorder: false, disabled: false, study, notebooks, assets: [], onOpen: () => {}, ...props });

it('read-only: renders cards and scroll buttons but no editing controls', async () => {
  render(lane({ readOnly: true }), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(screen.getByLabelText('Scroll left: Pinned')).toBeInTheDocument();
  expect(screen.getByLabelText('Scroll right: Pinned')).toBeInTheDocument();
  expect(screen.queryByLabelText('Filters and sorting: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('View size: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Start studying: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Add item: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Move item: Note A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Unpin: Note A')).not.toBeInTheDocument();
});

it('read-only: clicking a card calls onOpen', async () => {
  const onOpen = vi.fn();
  render(lane({ readOnly: true, onOpen }), { wrapper });
  const title = await waitFor(() => screen.getByText('Note A'));
  fireEvent.click(title);
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onOpen.mock.calls[0][0]).toMatchObject({ path: 'notes/nb1/a.md', notebookId: 'nb1' });
});

it('offers the order editor on a writable dynamic compilation only', async () => {
  const onEditOrder = vi.fn();
  const dynamic: CompilationRow = { id: 'row-2', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'small', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'folder', path: 'notes/nb1', recursive: true, notebookId: 'nb1' } };
  const { rerender } = render(lane({ row: dynamic, onEditOrder }), { wrapper });
  fireEvent.click(await screen.findByLabelText('Edit order: Live'));
  expect(onEditOrder).toHaveBeenCalledTimes(1);
  rerender(lane({ row: dynamic, onEditOrder, readOnly: true }));
  expect(screen.queryByLabelText('Edit order: Live')).not.toBeInTheDocument();
  rerender(lane({ onEditOrder }));
  expect(screen.queryByLabelText(/Edit order/)).not.toBeInTheDocument();
});

const compilationView = (width: string, props: Partial<Parameters<typeof CompilationLane>[0]> = {}) => createElement('div', { className: 'compilation-view', style: { width } }, lane(props));
const resizeTo = (width: number) => act(() => resizeCallbacks.forEach(callback => callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)));
const altWheel = (target: Element) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, altKey: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
const sortableStrategy = () => vi.mocked(SortableContext).mock.calls.at(-1)?.[0].strategy;

it('keeps the strip, its scroll buttons and Alt+wheel at 560px of compilation width', async () => {
  render(compilationView('560px', { reorder: true }), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(document.querySelector('.screen-lane')).toHaveAttribute('data-orientation', 'horizontal');
  expect(screen.getByLabelText('Scroll left: Pinned')).toBeInTheDocument();
  expect(screen.getByLabelText('Scroll right: Pinned')).toBeInTheDocument();
  expect(altWheel(document.querySelector('.screen-lane-strip')!)).toBe(true);
  expect(sortableStrategy()).toBe(horizontalListSortingStrategy);
});

it('lists cards top to bottom under 560px: no scroll buttons, no Alt+wheel, a vertical sorting strategy', async () => {
  render(compilationView('559px', { reorder: true }), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(document.querySelector('.screen-lane')).toHaveAttribute('data-orientation', 'vertical');
  expect(screen.queryByLabelText('Scroll left: Pinned')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Scroll right: Pinned')).not.toBeInTheDocument();
  expect(altWheel(document.querySelector('.screen-lane-strip')!)).toBe(false);
  expect(sortableStrategy()).toBe(verticalListSortingStrategy);
  expect(screen.getByLabelText('Move item: Note A')).toBeInTheDocument();
});

it('switches layout when the compilation is resized across 560px without writing anything', async () => {
  const onView = vi.fn(), onSort = vi.fn(), onRemove = vi.fn(), onStudyChange = vi.fn();
  render(compilationView('900px', { reorder: true, onView, onSort, onRemove, onStudyChange }), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  const requests = vi.mocked(fetch).mock.calls.length;
  resizeTo(400);
  expect(document.querySelector('.screen-lane')).toHaveAttribute('data-orientation', 'vertical');
  expect(screen.queryByLabelText('Scroll right: Pinned')).not.toBeInTheDocument();
  expect(sortableStrategy()).toBe(verticalListSortingStrategy);
  resizeTo(560);
  expect(document.querySelector('.screen-lane')).toHaveAttribute('data-orientation', 'horizontal');
  expect(screen.getByLabelText('Scroll right: Pinned')).toBeInTheDocument();
  expect(sortableStrategy()).toBe(horizontalListSortingStrategy);
  expect(screen.getByText('Note A')).toBeInTheDocument();
  for (const callback of [onView, onSort, onRemove, onStudyChange]) expect(callback).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.slice(requests).filter(([, init]) => init?.method && init.method !== 'GET')).toEqual([]);
});

it('takes Alt+wheel again after the arrangement returns from graph to cards', async () => {
  const { rerender } = render(compilationView('900px', { row: { ...row, view: 'graph' } }), { wrapper });
  expect(document.querySelector('.screen-lane-strip')).toBeNull();
  rerender(compilationView('900px'));
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(altWheel(document.querySelector('.screen-lane-strip')!)).toBe(true);
});

const card = (title: string) => document.querySelector<HTMLElement>(`[data-screen-item="${title}"]`)!;
const mouseClick = (element: Element, pointerType = 'mouse') => {
  fireEvent.pointerDown(element, { pointerType });
  fireEvent.click(element, { pointerType });
};
const cardOrder = () => [...document.querySelectorAll('[data-screen-item]')].map(element => element.getAttribute('data-screen-item'));

it('edits a note card in place on a mouse click of its body, and one card at a time (E1, E6)', async () => {
  const onOpen = vi.fn();
  render(lane({ row: two, onOpen }), { wrapper });
  mouseClick(await screen.findByText('Body of A'));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  expect(card('item-1')).toContainElement(screen.getByLabelText('Editor notes/nb1/a.md'));
  expect(screen.queryByText('Body of A')).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
  mouseClick(screen.getByText('Body of B'));
  await waitFor(() => expect(card('item-2')).toHaveAttribute('data-editing'));
  expect(card('item-1')).not.toHaveAttribute('data-editing');
  expect(flushEditors).toHaveBeenCalledWith(['nb1:notes/nb1/a.md']);
  expect(screen.getByText('Body of A')).toBeInTheDocument();
});

it('edits from the Edit button, and Done and Escape return the card to reading with focus on Edit (E1, E6)', async () => {
  render(lane({ row: two }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  fireEvent.click(screen.getByRole('button', { name: 'Finish editing Note A' }));
  await waitFor(() => expect(card('item-1')).not.toHaveAttribute('data-editing'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Note A' })).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  fireEvent.keyDown(screen.getByLabelText('Editor notes/nb1/a.md'), { key: 'Escape' });
  await waitFor(() => expect(card('item-1')).not.toHaveAttribute('data-editing'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Note A' })).toHaveFocus());
});

it('keeps a card in edit mode when its save fails and the switch is refused (E7)', async () => {
  render(lane({ row: two }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  flushEditors.mockResolvedValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note B' }));
  await waitFor(() => expect(flushEditors).toHaveBeenCalled());
  expect(card('item-1')).toHaveAttribute('data-editing');
  expect(card('item-2')).not.toHaveAttribute('data-editing');
});

it('opens zoom for a touch tap, a title click, and any click on a read-only note (E2, E4)', async () => {
  const onOpen = vi.fn();
  const { rerender } = render(lane({ row: two, onOpen }), { wrapper });
  mouseClick(await screen.findByText('Body of A'), 'touch');
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(card('item-1')).not.toHaveAttribute('data-editing');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  fireEvent.click(within(card('item-1')).getByTitle('Note A'));
  expect(onOpen).toHaveBeenCalledTimes(2);
  expect(card('item-1')).toHaveAttribute('data-editing');
  rerender(lane({ row: two, onOpen, readOnly: true }));
  expect(screen.queryByRole('button', { name: /^Edit Note/ })).toBeNull();
  mouseClick(screen.getByText('Body of B'));
  expect(onOpen).toHaveBeenCalledTimes(3);
});

it('keeps asset and folder cards as they are, with no Edit control (E14)', async () => {
  const mixed: CompilationRow = { ...two, items: [{ id: 'asset-1', kind: 'asset', notebookId: 'nb1', path: 'notes/nb1/x.pdf' }, { id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }] };
  const onOpen = vi.fn();
  render(lane({ row: mixed, onOpen, assets: [{ notebookId: 'nb1', path: 'notes/nb1/x.pdf', name: 'x.pdf', size: 2048, rawUrl: '/x.pdf' } as never] }), { wrapper });
  await screen.findByText('Body of A');
  expect(within(card('asset-1')).queryByRole('button', { name: /Edit/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1);
});

it('hides Edit and ignores body clicks in reorder mode, and takes the editing card out of the sortable list (E12)', async () => {
  const onOpen = vi.fn();
  const { rerender } = render(lane({ row: two, onOpen }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  const sortable = (id: string) => vi.mocked(useSortable).mock.calls.filter(([args]) => args.id === id).at(-1)?.[0];
  rerender(lane({ row: two, onOpen, reorder: true }));
  expect(sortable('item-1')?.disabled).toBe(true);
  expect(sortable('item-2')?.disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Finish editing Note A' }));
  await waitFor(() => expect(card('item-1')).not.toHaveAttribute('data-editing'));
  expect(screen.queryByRole('button', { name: /^Edit Note/ })).toBeNull();
  mouseClick(screen.getByText('Body of B'));
  expect(card('item-2')).not.toHaveAttribute('data-editing');
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(sortable('item-1')?.disabled).toBe(false);
  expect(screen.getByLabelText('Unpin: Note A')).toBeInTheDocument();
});

it('holds the card order while one edits and applies the live order afterwards (E11)', async () => {
  const reversed: CompilationRow = { ...two, items: [itemB, itemA] };
  const { rerender } = render(lane({ row: two }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(card('item-1')).toHaveAttribute('data-editing'));
  rerender(lane({ row: reversed }));
  expect(cardOrder()).toEqual(['item-1', 'item-2']);
  fireEvent.click(await screen.findByRole('button', { name: 'Finish editing Note A' }));
  await waitFor(() => expect(cardOrder()).toEqual(['item-2', 'item-1']));
});

it('keeps the editing card and its editor across the 560px threshold and scrolls it into view (L6, L7)', async () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  render(compilationView('900px', { row: two }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note B' }));
  await waitFor(() => expect(card('item-2')).toHaveAttribute('data-editing'));
  const editor = screen.getByLabelText('Editor notes/nb1/b.md');
  scrollIntoView.mockClear();
  resizeTo(400);
  expect(document.querySelector('.screen-lane')).toHaveAttribute('data-orientation', 'vertical');
  expect(screen.getByLabelText('Editor notes/nb1/b.md')).toBe(editor);
  expect(card('item-2')).toHaveAttribute('data-editing');
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView.mock.contexts[0]).toBe(card('item-2'));
  resizeTo(700);
  expect(screen.getByLabelText('Editor notes/nb1/b.md')).toBe(editor);
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  delete (Element.prototype as { scrollIntoView?: unknown; }).scrollIntoView;
});

it('keeps the editing card a note card when its note leaves the loaded page, until editing ends (E11)', async () => {
  const dynamic: CompilationRow = { id: 'row-3', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'small', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'folder', path: 'notes/nb1', recursive: true, notebookId: 'nb1' } };
  render(lane({ row: dynamic }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note A' }));
  await waitFor(() => expect(screen.getByLabelText('Editor notes/nb1/a.md')).toBeInTheDocument());
  // An autosave moves the note out of the page the lane loaded: the next fetch no longer lists it.
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ revision: REVISION, notes: [{ id: 'b', path: 'notes/nb1/b.md', notebookId: 'nb1', title: 'Note B', content: 'Body of B', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } }));
  await act(async () => {
    await client.invalidateQueries();
  });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1));
  expect(card('dynamic:row-3:notes/nb1/a.md')).toHaveAttribute('data-editing');
  expect(screen.getByLabelText('Editor notes/nb1/a.md')).toBeInTheDocument();
  expect(within(card('dynamic:row-3:notes/nb1/a.md')).queryByText('This item may have moved or been deleted.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Finish editing Note A' }));
  await waitFor(() => expect(document.querySelector('[data-screen-item="dynamic:row-3:notes/nb1/a.md"]')).toBeNull());
  expect(screen.getByRole('button', { name: 'Edit Note B' })).toBeInTheDocument();
});

it('holds same-named notes of different folders apart while one edits, as a note id is not unique (E11)', async () => {
  const notesAt = ['x', 'y'].map(folder => ({ id: 'index', path: `notes/nb1/${folder}/index.md`, notebookId: 'nb1', title: `Index ${folder}`, content: `Body of ${folder}`, tags: [], metadata: {} }));
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ revision: REVISION, notes: notesAt }), { headers: { 'Content-Type': 'application/json' } }));
  const same: CompilationRow = { ...row, view: 'small', items: ['x', 'y'].map(folder => ({ id: `pin-${folder}`, kind: 'note' as const, notebookId: 'nb1', path: `notes/nb1/${folder}/index.md` })) };
  render(lane({ row: same }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Index x' }));
  await waitFor(() => expect(card('pin-x')).toHaveAttribute('data-editing'));
  expect(screen.getByLabelText('Editor notes/nb1/x/index.md')).toBeInTheDocument();
  expect(screen.getByText('Body of y')).toBeInTheDocument();
  expect(within(card('pin-y')).getByRole('button', { name: 'Edit Index y' })).toBeInTheDocument();
  expect(screen.queryByText('This item may have moved or been deleted.')).toBeNull();
});

it('offers no Edit on a note whose repository cannot be written, though the compilation can (E13)', async () => {
  editorProps.mockImplementation(note => ({ readOnly: note.notebookId === 'nb1' }));
  const onOpen = vi.fn();
  render(lane({ row: two, onOpen }), { wrapper });
  mouseClick(await screen.findByText('Body of A'));
  expect(screen.queryByRole('button', { name: /^Edit Note/ })).toBeNull();
  expect(card('item-1')).not.toHaveAttribute('data-editing');
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it("ends the card's slot only on keys typed inside the card, not on keys of its editor portalled into zoom (E4, K2)", async () => {
  portalled.add('notes/nb1/b.md');
  render(lane({ row: two }), { wrapper });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Note B' }));
  const zoomEditor = await screen.findByLabelText('Zoom editor');
  expect(card('item-2')).not.toContainElement(zoomEditor);
  fireEvent.keyDown(zoomEditor, { key: 'Escape' });
  await act(async () => {});
  expect(card('item-2')).toHaveAttribute('data-editing');
  expect(flushEditors).not.toHaveBeenCalled();
});
