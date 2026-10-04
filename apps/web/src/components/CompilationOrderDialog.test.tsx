// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import { CompilationOrderDialog } from './CompilationOrderDialog.js';

const REVISION = 'e'.repeat(40);
let client: QueryClient;
let fetched: string[];

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const row: Extract<CompilationRow, { kind: 'dynamic'; }> = { id: 'row-1', path: 'notes/nb1/live.compilation.yml', name: 'Live', view: 'small', notebookId: 'nb1', kind: 'dynamic', source: { kind: 'folder', path: 'notes/nb1', recursive: true, notebookId: 'nb1' }, sort: { field: 'title', order: 'asc' }, study: { filter: 'all', dueFirst: false, status: 'published' } };
const note = (name: string, mtime: number) => ({ id: `notes/nb1/${name}.md`, path: `notes/nb1/${name}.md`, notebookId: 'nb1', title: `Note ${name.toUpperCase()}`, tags: [], metadata: {}, mtime });

beforeEach(() => {
  fetched = [];
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetched.push(`${String(input)} ${typeof init?.body === 'string' ? init.body : ''}`);
      return new Response(JSON.stringify({ revision: REVISION, notes: [note('b', 300), note('a', 200), note('c', 100)] }), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);
const titles = () => within(screen.getByRole('list', { name: 'Edit order' })).getAllByRole('listitem').map(item => item.textContent);

it('opens on a snapshot of the current order and saves every member path in that order', async () => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(createElement(CompilationOrderDialog, { row, notebooks, assets: [], disabled: false, onSave, onClose }), { wrapper });
  await waitFor(() => expect(titles()).toEqual(['1Note A', '2Note B', '3Note C']));
  fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
  expect(onSave).toHaveBeenCalledWith(['notes/nb1/a.md', 'notes/nb1/b.md', 'notes/nb1/c.md']);
  expect(onClose).toHaveBeenCalled();
});

it('starts from the stored manual order when the compilation already follows it', async () => {
  render(createElement(CompilationOrderDialog, { row: { ...row, sort: { field: 'manual', order: 'asc' }, manualOrder: ['notes/nb1/c.md'] }, notebooks, assets: [], disabled: false, onSave: () => {}, onClose: () => {} }), { wrapper });
  // C was placed by hand; A and B follow, oldest update first.
  await waitFor(() => expect(titles()).toEqual(['1Note C', '2Note A', '3Note B']));
});

it('loads every member regardless of the study status filter', async () => {
  render(createElement(CompilationOrderDialog, { row, notebooks, assets: [], disabled: false, onSave: () => {}, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(titles()).toHaveLength(3));
  expect(fetched.length).toBeGreaterThan(0);
  expect(fetched.some(request => request.includes('published'))).toBe(false);
});

it('saves nothing when cancelled', async () => {
  const onSave = vi.fn();
  render(createElement(CompilationOrderDialog, { row, notebooks, assets: [], disabled: false, onSave, onClose: () => {} }), { wrapper });
  await waitFor(() => expect(titles()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onSave).not.toHaveBeenCalled();
});
