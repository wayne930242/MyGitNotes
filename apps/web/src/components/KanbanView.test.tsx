// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { KanbanView } from './KanbanView.js';
import { NOTE_DRAG_TYPE } from '../lib/note-drag.js';

const REVISION = 'd'.repeat(40);
let client: QueryClient;
let requests: string[];

const noteOf = (path: string, status?: string) => ({ id: path, path, notebookId: 'life', title: path, status, tags: [], metadata: {} });

beforeEach(() => {
  requests = [];
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(url);
    const withoutStatus = url.includes('noStatus=1');
    const body = withoutStatus
      ? { revision: REVISION, total: 7, nextCursor: null, notes: [noteOf('notes/life/loose.md')] }
      : { revision: REVISION, total: 3, nextCursor: null, notes: [noteOf('notes/life/a.md', 'inbox')] };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  }));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revision: REVISION, drafts: {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

const board = () => createElement(KanbanView, {
  query: { notebookId: 'life' }, statuses: ['inbox'],
  onOpenNote: () => {}, onUpdateNoteStatus: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {},
});

it('asks the server for the notes that carry no status', async () => {
  render(board(), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/loose.md')).toBeInTheDocument());
  expect(requests.some(url => url.includes('noStatus=1'))).toBe(true);
  expect(requests.some(url => url.includes('status=inbox'))).toBe(true);
});

it('counts each column and the board from the server totals', async () => {
  render(board(), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/loose.md')).toBeInTheDocument());
  const counts = [...document.querySelectorAll('.rounded-full')].map(node => node.textContent);
  expect(counts).toContain('3');
  expect(counts).toContain('7');
  expect(screen.getByText(/10/)).toBeInTheDocument();
});

it('leaves out the no-status column when the server answers none', async () => {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => new Response(JSON.stringify(
    String(url).includes('noStatus=1')
      ? { revision: REVISION, total: 0, nextCursor: null, notes: [] }
      : { revision: REVISION, total: 3, nextCursor: null, notes: [noteOf('notes/life/a.md', 'inbox')] },
  ), { headers: { 'Content-Type': 'application/json' } }) as never);
  render(board(), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText('No status')).not.toBeInTheDocument());
});

it('asks only the filtered status column when the board filters by status', async () => {
  render(createElement(KanbanView, {
    query: { notebookId: 'life', status: 'inbox' }, statuses: ['inbox', 'done'],
    onOpenNote: () => {}, onUpdateNoteStatus: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {},
  }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  expect(requests.some(url => url.includes('status=inbox'))).toBe(true);
  expect(requests.some(url => url.includes('status=done'))).toBe(false);
  expect(document.querySelector('[data-status-column="done"]')).toBeInTheDocument();
});

it('dates a card by its updated field when the source reports no mtime', async () => {
  const dated = { ...noteOf('notes/life/dated.md', 'inbox'), metadata: { updated: '2026-01-05T10:00:00Z' } };
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(
    { revision: REVISION, total: 1, nextCursor: null, notes: [dated] },
  ), { headers: { 'Content-Type': 'application/json' } }) as never);
  render(board(), { wrapper });
  const expected = new Date('2026-01-05T10:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  await waitFor(() => expect(screen.getAllByText(expected).length).toBeGreaterThan(0));
});

function makeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => { data[type] = value; },
    getData: (type: string) => data[type] || '',
    dropEffect: '',
    effectAllowed: '',
  };
}

function twoColumnBoard(props: { onUpdateNoteStatus: (note: unknown, status: string) => void; readOnly?: boolean; focusMode?: { onZoomNote: (note: unknown) => void; canDrag: (note: unknown) => boolean } }) {
  return createElement(KanbanView, {
    query: { notebookId: 'life' }, statuses: ['inbox', 'doing'],
    onOpenNote: () => {}, onDeleteNote: () => {}, onNewNoteWithStatus: () => {},
    ...props,
  });
}

function mockTwoColumnFetch() {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => {
    const u = String(url);
    const notes = u.includes('status=inbox') ? [noteOf('notes/life/a.md', 'inbox')] : [];
    return new Response(JSON.stringify({ revision: REVISION, total: notes.length, nextCursor: null, notes }), { headers: { 'Content-Type': 'application/json' } });
  });
}

it('still changes status by dragging a card into another column when focusMode is present', async () => {
  mockTwoColumnFetch();
  const onUpdateNoteStatus = vi.fn();
  render(twoColumnBoard({ onUpdateNoteStatus, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  const target = document.querySelector('[data-status-column="doing"]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(onUpdateNoteStatus).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/life/a.md' }), 'doing');
});

it('sets the note-drag payload on a card when focusMode is present', async () => {
  mockTwoColumnFetch();
  render(twoColumnBoard({ onUpdateNoteStatus: () => {}, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  expect(dataTransfer.getData(NOTE_DRAG_TYPE)).toBe('notes/life/a.md');
  expect(dataTransfer.getData('text/plain')).toBe('notes/life/a.md');
});

it('keeps a read-only board from changing status on drop even when focusMode allows dragging', async () => {
  mockTwoColumnFetch();
  const onUpdateNoteStatus = vi.fn();
  render(twoColumnBoard({ onUpdateNoteStatus, readOnly: true, focusMode: { onZoomNote: () => {}, canDrag: () => true } }), { wrapper });
  await waitFor(() => expect(screen.getByText('notes/life/a.md')).toBeInTheDocument());
  const card = screen.getByText('notes/life/a.md').closest('[data-notepath]')!;
  expect(card).toHaveAttribute('draggable', 'true');
  const target = document.querySelector('[data-status-column="doing"]')!;
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(card, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(onUpdateNoteStatus).not.toHaveBeenCalled();
});
