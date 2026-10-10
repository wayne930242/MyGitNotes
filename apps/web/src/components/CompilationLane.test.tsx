// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { horizontalListSortingStrategy, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { CompilationLane } from './CompilationLane.js';

vi.mock('@dnd-kit/sortable', async importOriginal => {
  const original = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return { ...original, SortableContext: vi.fn(original.SortableContext) };
});

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const row: CompilationRow = { id: 'row-1', path: 'notes/nb1/pinned.compilation.yml', name: 'Pinned', view: 'thumbnail', notebookId: 'nb1', kind: 'custom', items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }] };
const study: StudyController = { study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {}, loading: false, saving: false, error: '', writable: false };

let resizeCallbacks: ResizeObserverCallback[];
beforeEach(() => {
  vi.mocked(SortableContext).mockClear();
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
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [{ id: 'notes/nb1/a.md', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', tags: [], metadata: {} }] }), { headers: { 'Content-Type': 'application/json' } })));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

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
