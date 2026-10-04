// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CompilationRow } from '@mygitnotes/core/compilation';
import { emptyStudyWorkspace } from '@mygitnotes/core/study';
import type { NotebookConfig } from '../lib/types.js';
import { setNoteQueryScope } from '../lib/use-note-queries.js';
import type { StudyController } from '../lib/use-study-workspace.js';
import { CompilationStack } from './CompilationStack.js';

const REVISION = 'e'.repeat(40);
let client: QueryClient;

const notebooks: NotebookConfig[] = [{ id: 'nb1', title: 'NB1', root: 'notes/nb1' }];
const row: CompilationRow = { id: 'row-1', path: 'notes/nb1/reading.compilation.yml', name: 'Reading', view: 'stack', notebookId: 'nb1', kind: 'custom', items: [{ id: 'item-1', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/a.md' }, { id: 'item-2', kind: 'note', notebookId: 'nb1', path: 'notes/nb1/gone.md' }, { id: 'item-3', kind: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0, title: 'A talk' }] };
const study: StudyController = { study: emptyStudyWorkspace(), save: async () => false, action: async () => false, reload: async () => {}, loading: false, saving: false, error: '', writable: false };

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ revision: REVISION, notes: [{ id: 'notes/nb1/a.md', path: 'notes/nb1/a.md', notebookId: 'nb1', title: 'Note A', tags: [], metadata: {}, content: '# Chapter One\n\nThe body of note A.' }] }), { headers: { 'Content-Type': 'application/json' } })));
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  setNoteQueryScope({ sourceId: 'github:me/notes', revisions: { 'github:me/notes': REVISION }, repositories: {}, drafts: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);
const stack = (props: Partial<Parameters<typeof CompilationStack>[0]> = {}) => createElement(CompilationStack, { row, study, notebooks, assets: [], onOpen: () => {}, disabled: false, readOnly: true, ...props });

it('lays the items out in order as sections: the full note, a missing notice in place, the video player', async () => {
  render(stack(), { wrapper });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Chapter One' })).toBeInTheDocument());
  expect(screen.getByText('The body of note A.')).toBeInTheDocument();
  const sections = [...document.querySelectorAll<HTMLElement>('.screen-stack > .screen-card')];
  expect(sections.map(section => section.dataset.screenItem)).toEqual(['item-1', 'item-2', 'item-3']);
  expect(within(sections[1]).getByText('This item may have moved or been deleted.')).toBeInTheDocument();
  expect(within(sections[2]).getByLabelText('Play video: A talk')).toBeInTheDocument();
});

it('opens an item from its title bar', async () => {
  const onOpen = vi.fn();
  render(stack({ onOpen }), { wrapper });
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Note A' })));
  expect(onOpen).toHaveBeenCalledWith(row.kind === 'custom' ? row.items[0] : undefined, expect.objectContaining({ path: 'notes/nb1/a.md' }));
});

it('is read-only: no drag handle or unpin control', async () => {
  render(stack(), { wrapper });
  await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());
  expect(screen.queryByLabelText('Move item: Note A')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Unpin: Note A')).not.toBeInTheDocument();
});
