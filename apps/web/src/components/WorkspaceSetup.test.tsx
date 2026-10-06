// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DerivedManifestNotice, WorkspaceGate } from './WorkspaceSetup.js';
import type { WorkspaceConfig } from '../lib/types.js';

vi.mock('./AuthControls.js', () => ({ AuthControls: () => createElement('a', { href: '/api/auth/github' }, 'Sign in with GitHub'), ConnectionState: () => createElement('p', null, 'Opening workspace') }));
vi.mock('../lib/api.js', () => ({ updateWorkspaceConfig: vi.fn(async () => ({ success: true, configRevision: 'next' })) }));

let root: Root;
let container: HTMLElement;
let requests: { url: string; init?: RequestInit; }[];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const repositories = { repositories: [{ fullName: 'visitor/notes', defaultBranch: 'main', private: true, updatedAt: '2026-10-01T00:00:00Z' }, { fullName: 'team/handbook', defaultBranch: 'trunk', private: false, updatedAt: '2026-09-01T00:00:00Z' }], total: 2, githubApp: true, installUrl: 'https://github.com/apps/my-notes/installations/new', newRepositoryUrl: 'https://github.com/new?template_owner=wayne930242&template_name=mygitnotes-starter' };
let available = repositories;

function serve(session: unknown) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === '/api/auth/session') return json(session);
    if (url.startsWith('/api/repositories/available')) return json(available);
    if (url === '/api/workspace/choice') return JSON.parse(String(init?.body)).repository === 'team/handbook' ? json({ error: 'Branch nope does not exist in team/handbook.' }, 404) : json({ choice: { repository: 'visitor/notes', branch: 'main' } });
    throw new Error(`Unexpected request ${url}`);
  });
}
/** Lets pending fetches and the state they set settle. */
const settle = () => act(async () => new Promise(resolve => setTimeout(resolve, 0)));
async function render(element: ReturnType<typeof createElement>) {
  await act(async () => root.render(element));
  await settle();
}
const button = (text: string) => [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(text)) as HTMLButtonElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; }).IS_REACT_ACT_ENVIRONMENT = true;
  // The setup screens apply the theme themselves, which follows the system colour scheme.
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  requests = [];
  available = repositories;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('renders the app once the session is known on a deployment with one repository', async () => {
  serve({ authenticated: false, provider: 'github' });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toBe('workspace');
});

it('asks a signed-out visitor to sign in where visitors choose their repository', async () => {
  serve({ authenticated: false, repositoryChoice: true, workspace: null });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).not.toContain('workspace');
  expect(container.querySelector('a[href="/api/auth/github"]')).not.toBeNull();
  // Visitors cannot reach Settings yet, so the screen offers the language and says what the sign-in can reach.
  expect(container.querySelector('[aria-label="Language"]')).not.toBeNull();
  expect(container.textContent).toContain('your sign-in is stored encrypted on this server');
});

it('says a lightweight sign-in stays in the browser', async () => {
  serve({ authenticated: false, storage: 'cookie', repositoryChoice: true, workspace: null });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect(container.textContent).toContain('your sign-in is kept in this browser, not on our server');
});

it('lists repositories, opens the chosen one and shows why a choice failed', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  expect([...container.querySelectorAll('li button')].map(row => row.textContent)).toEqual([expect.stringContaining('visitor/notes'), expect.stringContaining('team/handbook')]);
  expect(container.querySelector('a[href="https://github.com/apps/my-notes/installations/new"]')).not.toBeNull();
  expect(button('Open repository').disabled).toBe(true);
  await act(async () => button('team/handbook').click());
  expect(container.querySelector<HTMLInputElement>('input[placeholder="trunk"]')).not.toBeNull();
  await act(async () => button('Open repository').click());
  await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Branch nope does not exist in team/handbook.');
  await act(async () => button('visitor/notes').click());
  await act(async () => button('Open repository').click());
  await settle();
  expect(JSON.parse(String(requests.filter(request => request.url === '/api/workspace/choice').at(-1)!.init!.body))).toEqual({ repository: 'visitor/notes' });
  expect(assign).toHaveBeenCalledWith('/');
  vi.unstubAllGlobals();
});

it('commits the derived manifest and reloads the workspace', async () => {
  const { updateWorkspaceConfig } = await import('../lib/api.js');
  const onCreated = vi.fn(async () => {});
  const config: WorkspaceConfig = { schema_version: 3, workspace: { title: 'notes', default_notebook: 'journal' }, notebooks: [{ id: 'journal', title: 'journal', root: 'journal' }] };
  await render(createElement(DerivedManifestNotice, { config, configRevision: 'abc', canWrite: true, onCreated }));
  await act(async () => button('Create manifest').click());
  await settle();
  expect(updateWorkspaceConfig).toHaveBeenCalledWith(expect.stringContaining('default_notebook: journal'), 'abc');
  expect(onCreated).toHaveBeenCalled();
});

it('walks a visitor through creating a repository on GitHub and selects it when they return', async () => {
  serve({ authenticated: true, login: 'visitor', repositoryChoice: true, workspace: null });
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  await render(createElement(WorkspaceGate, null, createElement('p', null, 'workspace')));
  await act(async () => button('Create a new notes repository').click());
  await settle();
  expect(open).toHaveBeenCalledWith(repositories.newRepositoryUrl, '_blank', 'noopener');
  expect(container.textContent).toContain('Finish on GitHub');
  expect(container.querySelector('section a[href="https://github.com/apps/my-notes/installations/new"]')).not.toBeNull();
  // Back from GitHub before the repository exists: nothing new to select yet.
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle();
  expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
  available = { ...repositories, repositories: [{ fullName: 'visitor/my-notes', defaultBranch: 'main', private: true, updatedAt: '2026-10-07T00:00:00Z' }, ...repositories.repositories], total: 3 };
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle();
  expect(button('visitor/my-notes').getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).not.toContain('Finish on GitHub');
});
