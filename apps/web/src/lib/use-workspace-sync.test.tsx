// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { FolderItem } from './types.js';

const folders = vi.hoisted(() => {
  let resolve: (items: FolderItem[]) => void = () => {};
  return { promise: new Promise<FolderItem[]>(done => resolve = done), resolve: (items: FolderItem[]) => resolve(items) };
});
vi.mock('./api.js', () => ({ fetchWorkspace: async () => ({ home: 'local:/notes', local: true, repoRoot: '/notes', configRevision: 'c1', config: { workspace: { title: 'Notes', default_notebook: 'a' }, notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }] }, keyedConfig: { workspace: { title: 'Notes', default_notebook: 'notes~a' }, notebooks: [{ id: 'notes~a', title: 'A', root: 'notes/a' }] }, repositories: [{ id: 'local:/notes', alias: 'notes', branch: 'main', notebooks: ['notes~a'], revision: '', write: true }] }), fetchFolders: () => folders.promise, fetchAssets: async () => [], fetchGitStatus: async () => null, openWorkspaceEvents: () => ({ addEventListener() {}, close() {} }) }));
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));

const { useWorkspaceSync } = await import('./use-workspace-sync.js');

it('shows the workspace as soon as it is known, filling in folders when they arrive', async () => {
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  // Folders are still pending, yet the page (and the note queries it mounts) need not wait for them.
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.config?.notebooks.map(notebook => notebook.id)).toEqual(['notes~a']);
  expect(result.current.folders).toEqual([]);
  expect(result.current.foldersLoading).toBe(true);

  folders.resolve([{ notebookId: 'notes~a', path: 'one' } as FolderItem]);
  await waitFor(() => expect(result.current.folders).toHaveLength(1));
  expect(result.current.foldersLoading).toBe(false);
});

it('selects the notebook an old bare-id route stands for while the redirect replaces the URL', async () => {
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
  const { result } = renderHook(() => useWorkspaceSync({ routeNotebook: 'a' }), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.selectedNotebookId).toBe('notes~a');
  expect(result.current.resolveBareNotebook('a')).toBe('notes~a');
  expect(result.current.resolveBareNotebook('missing')).toBeNull();
});
