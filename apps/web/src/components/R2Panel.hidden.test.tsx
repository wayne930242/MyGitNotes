// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { R2Panel, type R2PanelProps } from './R2Panel.js';

const api = vi.hoisted(() => ({ fetchR2References: vi.fn(), deleteR2: vi.fn(async () => ({ deleted: [] })), moveR2: vi.fn() }));
vi.mock('../lib/r2-api.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/r2-api.js')>(), ...api }));

beforeAll(() => {
  // jsdom does not scroll.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const props: R2PanelProps = { notebookId: 'kb~kb', listing: { prefix: '', objects: [{ key: 'docs/guide.pdf', size: 10, lastModified: '2026-01-01T00:00:00Z' }] }, directory: 'docs', mutable: true, showHidden: false, busy: false, run: async action => (await action(), true), onNavigate: vi.fn(), onRefresh: vi.fn(async () => undefined), onNotesChanged: vi.fn(async () => {}) };

it('names the hidden repositories a delete cannot check and deletes only once the person confirms (decision C7)', async () => {
  api.fetchR2References.mockResolvedValue({ objects: ['docs/guide.pdf'], notes: [], hidden: [{ id: 'local:/work/archive', alias: 'archive', path: '/work/archive' }] });
  render(createElement(I18nProvider, null, createElement(R2Panel, props)));
  fireEvent.click(screen.getByRole('button', { name: /guide\.pdf/ }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
  expect(await screen.findByText(/Hidden repositories are not checked for references to this item: archive \(\/work\/archive\)/)).toBeInTheDocument();
  const confirm = screen.getByRole('button', { name: 'Confirm deletion' });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Go ahead without checking them' }));
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.deleteR2).toHaveBeenCalledWith('kb~kb', 'docs/guide.pdf', false, true));
});

it('asks nothing while no repository is hidden', async () => {
  api.fetchR2References.mockResolvedValue({ objects: ['docs/guide.pdf'], notes: [], hidden: [] });
  render(createElement(I18nProvider, null, createElement(R2Panel, props)));
  fireEvent.click(screen.getByRole('button', { name: /guide\.pdf/ }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
  const confirm = await screen.findByRole('button', { name: 'Confirm deletion' });
  await waitFor(() => expect(confirm).toBeEnabled());
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(confirm);
  await waitFor(() => expect(api.deleteR2).toHaveBeenCalledWith('kb~kb', 'docs/guide.pdf', false, false));
});
