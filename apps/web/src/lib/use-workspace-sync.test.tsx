// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import YAML from 'yaml';
import { expect, it, vi } from 'vitest';
import type { FolderItem } from './types.js';

const folders = vi.hoisted(() => {
  let resolve: (items: FolderItem[]) => void = () => {};
  return { promise: new Promise<FolderItem[]>(done => resolve = done), resolve: (items: FolderItem[]) => resolve(items) };
});
const saved = vi.hoisted(() => ({ yaml: [] as string[], requests: [] as string[][] }));
vi.mock('../components/CoreUpdates.js', () => ({ CoreUpdates: () => null }));
vi.mock('../components/ProductVersion.js', () => ({ ProductVersion: () => null }));
vi.mock('../components/WorkspaceManifestEditor.js', () => ({ WorkspaceManifestEditor: () => null }));
const preferences = { defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false };
const homeManifest = { workspace: { title: 'Notes', default_notebook: 'a' }, notebooks: [{ id: 'a', title: 'A', root: 'notes/a' }] };
vi.mock('./api.js', () => ({ updateWorkspaceConfig: async (repository: string, yaml: string, revision: string) => (saved.yaml.push(yaml), saved.requests.push([repository, revision]), { success: true, configRevision: 'c2' }), fetchWorkspace: async () => ({ defaultRepository: 'local:/notes', local: true, coreUpdate: true, repoRoot: '/notes', keyedConfig: { workspace: { title: 'Notes', default_notebook: 'notes~a' }, notebooks: [{ id: 'notes~a', title: 'A', root: 'notes/a' }, { id: 'code~src', title: 'Source', root: 'src' }] }, repositories: [{ id: 'local:/notes', alias: 'notes', branch: 'main', notebooks: ['notes~a'], revision: '', write: true, title: 'Notes', defaultNotebook: 'notes~a', preferences: { ...preferences, defaultFocusMode: true }, config: homeManifest, configRevision: 'c1' }, { id: 'github:me/code@main', alias: 'code', branch: 'main', notebooks: ['code~src'], revision: '', write: true, title: 'Code', defaultNotebook: 'code~src', preferences: { ...preferences, defaultShowLineNumbers: true }, config: null, configRevision: 'none', manifest: 'derived' }] }), fetchFolders: () => folders.promise, fetchAssets: async () => [], fetchGitStatus: async () => null, openWorkspaceEvents: () => ({ addEventListener() {}, close() {} }) }));
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));

const { useWorkspaceSync } = await import('./use-workspace-sync.js');
const { SettingsModal } = await import('../components/SettingsModal.js');
const { DerivedManifestNotice } = await import('../components/WorkspaceSetup.js');

it('shows the workspace as soon as it is known, filling in folders when they arrive', async () => {
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  // Folders are still pending, yet the page (and the note queries it mounts) need not wait for them.
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.config?.notebooks.map(notebook => notebook.id)).toEqual(['notes~a', 'code~src']);
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

it('hands Settings and "create manifest" the manifest by local id, so both commit YAML the server accepts', async () => {
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  const home = result.current.defaultRepository!;
  expect(result.current.config?.workspace.default_notebook).toBe('notes~a');

  saved.yaml = [];
  saved.requests = [];
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  const settings = render(createElement(SettingsModal, { manifest: { repositories: result.current.repositories, defaultRepository: home.id, initialRepository: home.id, onManifestRevision: () => {} }, onRefreshWorkspace: async () => {}, currentTheme: { familyId: 'flexoki', mode: 'light' }, onSelectTheme: () => {} }));
  fireEvent.click(settings.getByTitle('Save & Commit'));
  await waitFor(() => expect(saved.yaml).toHaveLength(1));
  settings.unmount();
  const created = vi.fn(async () => {});
  const notice = render(createElement(DerivedManifestNotice, { repository: home.id, config: home.config!, configRevision: home.configRevision, canWrite: true, onCreated: created }));
  fireEvent.click(notice.getByText('Create manifest'));
  await waitFor(() => expect(created).toHaveBeenCalled());
  notice.unmount();

  expect(saved.yaml).toHaveLength(2);
  expect(saved.requests).toEqual([['local:/notes', 'c1'], ['local:/notes', 'c1']]);
  for (const yaml of saved.yaml) {
    expect(yaml).not.toContain('~');
    expect(YAML.parse(yaml)).toMatchObject({ workspace: { default_notebook: 'a' }, notebooks: [{ id: 'a' }] });
  }
});

it("gives each notebook its repository's preferences, and the default repository's when no notebook is named", async () => {
  const { notebookPreferences } = await import('./notebook-preferences.js');
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(notebookPreferences('code~src')).toMatchObject({ defaultShowLineNumbers: true, defaultFocusMode: false });
  expect(notebookPreferences('notes~a')).toMatchObject({ defaultShowLineNumbers: false, defaultFocusMode: true });
  expect(notebookPreferences()).toMatchObject({ defaultShowLineNumbers: false, defaultFocusMode: true });
  expect(notebookPreferences('elsewhere~x')).toMatchObject({ defaultFocusMode: true });
});
