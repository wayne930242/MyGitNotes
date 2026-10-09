// @vitest-environment jsdom
import { createElement, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NotebookConfig } from './types.js';
import { linkedNote, linkScope, useLinkedNotePreload } from './use-linked-note-preload.js';
import { noteLookupOptions, setNoteQueryScope } from './use-note-queries.js';

const notebooks: NotebookConfig[] = [{ id: 'kb~n', title: 'Notes', root: 'notes' }];
const scope = { sourceId: 'local:test', revisions: {}, repositories: {}, drafts: {} };
let client: QueryClient;
let idle: Map<number, IdleRequestCallback>;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  let id = 0;
  idle = new Map();
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    idle.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelIdleCallback', (key: number) => idle.delete(key));
  fetcher = vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => ({ revision: '', notes: JSON.parse(init.body as string).notes.map(({ notebookId, path }: { notebookId: string; path: string; }) => ({ notebookId, path, content: '# Target' })) }) }));
  vi.stubGlobal('fetch', fetcher);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  setNoteQueryScope(scope);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});
function Surface({ count = 12 }: { count?: number; }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  useLinkedNotePreload(surfaceRef, notebooks);
  return <div ref={surfaceRef}>{Array.from({ length: count }, (_, index) => <a key={index} data-source-path='notes/source.md' data-workspace-link={`target-${index}.md`} />)}</div>;
}
const mount = (count?: number) => render(createElement(QueryClientProvider, { client }, createElement(Surface, { count })));
const tick = async () => {
  await act(async () => {
    const callbacks = [...idle.values()];
    idle.clear();
    callbacks.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 50 }));
  });
};

it('resolves note paths, aliases and same-origin note routes while excluding other destinations', () => {
  const source = document.createElement('a');
  source.dataset.sourcePath = 'notes/source.md';
  const reach = linkScope(source, notebooks, { 'kb~n': 'repo' }, 'repo');
  const target = { notebookId: 'kb~n', path: 'notes/target.md' };
  expect(linkedNote('target.md#heading', 'notes/source.md', reach, 'https://notes.test')).toEqual(target);
  expect(linkedNote('https://notes.test/notebooks/kb~n/notes/target.md', 'notes/source.md', reach, 'https://notes.test')).toEqual(target);
  // A link written before notebook keys names the bare id and reaches the notebook it stands for.
  expect(linkedNote('https://notes.test/notebooks/n/notes/target.md', 'notes/source.md', reach, 'https://notes.test')).toEqual(target);
  const aliased = [{ ...notebooks[0], pathAliases: { '@/*': 'notes/*' } }];
  expect(linkedNote('@/target.md', 'notes/source.md', linkScope(source, aliased, {}, 'repo'), 'https://notes.test')).toEqual(target);
  for (const href of ['#heading', 'source.md', 'image.png', 'folder', 'https://other.test/a.md', '../../outside.md', '/graph']) expect(linkedNote(href, 'notes/source.md', reach, 'https://notes.test')).toBeNull();
});

it('keeps equal roots and note paths in the source repository and never preloads a foreign route', () => {
  const shared = [{ id: 'home~n', root: 'notes', title: 'Home' }, { id: 'other~n', root: 'notes', title: 'Other' }] as NotebookConfig[];
  const source = document.createElement('div');
  source.dataset.sourceNotebook = 'home~n';
  const element = document.createElement('a');
  element.dataset.sourcePath = 'notes/source.md';
  source.append(element);
  const reach = linkScope(element, shared, { 'home~n': 'repo-home', 'other~n': 'repo-other' }, 'repo-home');
  expect(linkedNote('target.md', 'notes/source.md', reach, 'https://notes.test')).toEqual({ notebookId: 'home~n', path: 'notes/target.md' });
  expect(linkedNote('/notebooks/other~n/notes/target.md', 'notes/source.md', reach, 'https://notes.test')).toBeNull();
  // A bare id two repositories share resolves to the default (home) repository's notebook.
  expect(linkedNote('/notebooks/n/notes/target.md', 'notes/source.md', reach, 'https://notes.test')).toEqual({ notebookId: 'home~n', path: 'notes/target.md' });
});

it('waits for idle, bounds reads to eight and shares the editor body cache', async () => {
  mount();
  expect(fetcher).not.toHaveBeenCalled();
  for (let index = 0; index < 12; index++) await tick();
  expect(fetcher).toHaveBeenCalledTimes(8);
  for (const [, init] of fetcher.mock.calls) expect(JSON.parse(init.body as string).content).toBe(true);
  await client.fetchQuery(noteLookupOptions(scope, [{ notebookId: 'kb~n', path: 'notes/target-0.md' }], true));
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it('allows only one in-flight read and cancels queued work on unmount', async () => {
  let release!: () => void;
  fetcher.mockImplementationOnce(() =>
    new Promise(resolve => {
      release = () => resolve({ ok: true, json: async () => ({ revision: '', notes: [] }) });
    })
  );
  const view = mount();
  await tick();
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => release());
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('skips speculative reads on data-saving connections', async () => {
  Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
  try {
    mount();
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(navigator, 'connection');
  }
});

it('leaves a failed speculative read retryable by an explicit open', async () => {
  fetcher.mockRejectedValueOnce(new Error('offline'));
  mount(1);
  await tick();
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await client.fetchQuery(noteLookupOptions(scope, [{ notebookId: 'kb~n', path: 'notes/target-0.md' }], true));
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('separates preloaded bodies by workspace revision', async () => {
  mount(1);
  await tick();
  await act(async () => setNoteQueryScope({ ...scope, revisions: { 'github:me/notes': 'next' } }));
  await tick();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body as string).revisions).toEqual({ 'github:me/notes': 'next' });
  expect(client.getQueryData(noteLookupOptions(scope, [{ notebookId: 'kb~n', path: 'notes/target-0.md' }], true).queryKey)).toBeDefined();
  expect(client.getQueryData(noteLookupOptions({ ...scope, revisions: { 'github:me/notes': 'next' } }, [{ notebookId: 'kb~n', path: 'notes/target-0.md' }], true).queryKey)).toBeDefined();
});

it('pauses idle reads in hidden tabs and resumes when visible', async () => {
  const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  try {
    mount(1);
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    state.mockRestore();
  }
});
