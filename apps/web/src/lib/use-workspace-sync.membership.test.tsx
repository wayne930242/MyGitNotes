// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { NOTE_QUERY_KEY } from './use-note-queries.js';

const preferences = { defaultYoutubeDisplayMode: 'thumbnail', defaultShowLineNumbers: false, defaultFocusMode: false };
const repository = (alias: string) => ({ id: `local:/work/${alias}`, alias, branch: 'main', notebooks: [`${alias}~${alias}`], revision: '', write: true, title: alias, defaultNotebook: `${alias}~${alias}`, preferences, config: null, configRevision: 'c1' });
/** The workspace a request gets: both repositories until `journal` is hidden in another tab. */
const server = vi.hoisted(() => ({ hidden: false, requests: [] as boolean[], events: [] as EventTarget[] }));
vi.mock('./api.js', () => ({
  fetchWorkspace: async (fresh: boolean) => {
    server.requests.push(fresh);
    const repositories = server.hidden ? [repository('kb')] : [repository('kb'), repository('journal')];
    return { defaultRepository: 'local:/work/kb', local: true, repoRoot: '/work/kb', keyedConfig: { workspace: { title: 'KB', default_notebook: 'kb~kb' }, notebooks: repositories.map(entry => ({ id: entry.notebooks[0], title: entry.alias, root: `notes/${entry.alias}` })) }, repositories };
  },
  fetchFolders: async () => [],
  fetchAssets: async () => [],
  fetchGitStatus: async () => null,
  openWorkspaceEvents: () => {
    const events = Object.assign(new EventTarget(), { close() {} });
    server.events.push(events);
    return events;
  },
}));
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));

const { useWorkspaceSync } = await import('./use-workspace-sync.js');

it('drops a repository hidden in another tab when the server says the members changed, refetching past the cache and resetting note results', async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(() => useWorkspaceSync({}), { wrapper });
  await waitFor(() => expect(result.current.repositories.map(entry => entry.alias)).toEqual(['kb', 'journal']));
  client.setQueryData([...NOTE_QUERY_KEY, 'journal results'], ['journal note']);
  server.hidden = true;
  server.requests.length = 0;
  act(() => {
    server.events.at(-1)!.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ membership: true }) }));
  });
  await waitFor(() => expect(result.current.repositories.map(entry => entry.alias)).toEqual(['kb']));
  expect(result.current.config?.notebooks.map(notebook => notebook.id)).toEqual(['kb~kb']);
  expect(server.requests).toEqual([true]);
  await waitFor(() => expect(client.getQueryData([...NOTE_QUERY_KEY, 'journal results'])).toBeUndefined());
});
