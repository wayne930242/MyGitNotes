// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkspaceLinks } from './WorkspaceLinks.js';

const navigate = vi.fn();
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

let client: QueryClient;
let windowOpen: ReturnType<typeof vi.fn>;
beforeEach(() => {
  navigate.mockClear();
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

const link = (href: string) => createElement('span', {
  tabIndex: 0, 'data-testid': 'link', 'data-workspace-link': href, 'data-source-path': 'notes/a.md',
}, 'Link');

const workspace = (href: string) => createElement(WorkspaceLinks, { notebooks: [], folders: [], onOpenNote: () => {}, children: link(href) });

it('routes a same-origin absolute URL through the router instead of opening a new window', async () => {
  const { getByTestId } = render(workspace(`${window.location.origin}/notebooks/nb1/notes/a.md`), { wrapper });
  await act(async () => { fireEvent.click(getByTestId('link')); });
  expect(navigate).toHaveBeenCalledWith('/notebooks/nb1/notes/a.md');
  expect(windowOpen).not.toHaveBeenCalled();
});

it('still opens a cross-origin absolute URL in a new window', async () => {
  const { getByTestId } = render(workspace('https://elsewhere.example/notebooks/nb1/notes/a.md'), { wrapper });
  await act(async () => { fireEvent.click(getByTestId('link')); });
  expect(windowOpen).toHaveBeenCalledWith('https://elsewhere.example/notebooks/nb1/notes/a.md', '_blank', 'noopener,noreferrer');
  expect(navigate).not.toHaveBeenCalled();
});

it('opens a same-origin absolute URL in a new tab on a modifier click', async () => {
  const { getByTestId } = render(workspace(`${window.location.origin}/notebooks/nb1/notes/a.md`), { wrapper });
  await act(async () => { fireEvent.click(getByTestId('link'), { ctrlKey: true }); });
  expect(windowOpen).toHaveBeenCalledWith('/notebooks/nb1/notes/a.md', '_blank', 'noopener,noreferrer');
  expect(navigate).not.toHaveBeenCalled();
});
