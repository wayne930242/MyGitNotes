// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { NoteHistoryPanel, type NoteHistoryPanelProps } from './NoteHistoryPanel.js';

const commit = (n: number) => String(n).repeat(40);
const api = vi.hoisted(() => ({ fetchHistory: vi.fn(), fetchHistoryContent: vi.fn(), changeVersion: vi.fn(), fetchCommitFiles: vi.fn() }));
vi.mock('../lib/history-api.js', async original => ({ ...(await original<typeof import('../lib/history-api.js')>()), ...api }));

const texts: Record<string, string> = { [commit(1)]: '# Plan\none\n', [commit(2)]: '# Plan\none\ntwo\n' };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  api.fetchHistory.mockResolvedValue({ path: 'notes/a/plan.md', repository: 'local', more: false, writable: true, entries: [{ commit: commit(2), parents: [commit(1)], date: '2026-10-07T02:00:00Z', author: 'Tester', subject: 'docs(notes): edit plan.md (Agent, 2026-10-07)', body: 'Agent-Edit: 2026-10-07', path: 'notes/a/plan.md', agent: true }, { commit: commit(1), parents: [], date: '2026-10-07T01:00:00Z', author: 'Tester', subject: 'Start the plan', body: '', path: 'notes/a/plan.md', agent: false }], versions: [{ blob: 'b'.repeat(40), commit: commit(1), authored: '2026-10-07T01:00:00Z', sequence: 1, date: '2026.10.07', name: 'Outline', created: '2026-10-07T03:00:00Z' }] });
  api.fetchHistoryContent.mockImplementation(async (_target: unknown, at: { commit: string; }) => ({ blob: at.commit, content: texts[at.commit] }));
  api.fetchCommitFiles.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const target = { path: 'notes/a/plan.md', notebookId: 'a' };
// Inside the app's provider, as the panel always is, so translations keep one identity between renders.
const panel = (props: NoteHistoryPanelProps) => createElement(I18nProvider, null, createElement(NoteHistoryPanel, props));

it('lists versions and saved changes, and opens one to its full text before any comparison', async () => {
  render(panel({ target }));
  const row = await screen.findByRole('button', { name: /edit plan\.md/ });
  expect(row).toHaveTextContent('Agent');
  expect(row).toHaveTextContent('Latest');
  // The version is listed on its own and as a badge on the change it marks.
  expect(screen.getAllByRole('button', { name: /v1.*Outline/ })).toHaveLength(2);
  // Each change has a small button to give it a version number, except one that already has one.
  expect(screen.getAllByRole('button', { name: 'Give this change a version number' })).toHaveLength(1);

  fireEvent.click(row);
  const reader = await screen.findByRole('dialog');
  await waitFor(() => expect(within(reader).getByText(/two/)).toBeInTheDocument());
  expect(reader.querySelector('pre.history-text')).toHaveTextContent('# Plan one two');
  expect(within(reader).queryByRole('combobox')).toBeNull();

  fireEvent.click(within(reader).getByRole('button', { name: 'Compare' }));
  expect(within(reader).getByRole('combobox', { name: 'Compare with' })).toHaveTextContent('Previous change');
  await waitFor(() => expect(reader.querySelector('.diff-line.diff-added')).toHaveTextContent('+two'));
  expect(api.fetchHistoryContent).toHaveBeenCalledWith(target, { commit: commit(1), path: 'notes/a/plan.md' });
});

it('gives a past change a version number from its row, and offers Commit as a new version only for uncommitted changes', async () => {
  api.changeVersion.mockResolvedValue([]);
  const view = render(panel({ target, onCommitVersion: vi.fn() }));
  fireEvent.click(await screen.findByRole('button', { name: 'Give this change a version number' }));
  expect(screen.queryByRole('button', { name: 'Commit as a new version' })).toBeNull();
  const dialog = await screen.findByRole('dialog', { name: 'Add version number' });
  expect(within(dialog).getByText('v2')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Version name' }), { target: { value: 'Second' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.changeVersion).toHaveBeenCalledWith(target, { action: 'create', commit: commit(2), at: 'notes/a/plan.md', include: [], name: 'Second', note: '' }));

  api.fetchHistory.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Reload history' }));
  await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledTimes(1));

  const onCommitVersion = vi.fn().mockResolvedValue(undefined);
  view.rerender(panel({ target, dirty: true, onCommitVersion }));
  fireEvent.click(await screen.findByRole('button', { name: 'Commit as a new version' }));
  const commitDialog = await screen.findByRole('dialog', { name: 'Commit as a new version' });
  fireEvent.click(within(commitDialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onCommitVersion).toHaveBeenCalledWith({ name: '', note: '', include: [] }));
});

it('reads the history again once changes it was told about are committed', async () => {
  const view = render(panel({ target, dirty: true, onCommitVersion: vi.fn() }));
  expect(await screen.findByText('This note has changes that are not in its history yet.')).toBeInTheDocument();
  expect(api.fetchHistory).toHaveBeenCalledTimes(1);
  view.rerender(panel({ target, dirty: false }));
  await waitFor(() => expect(api.fetchHistory).toHaveBeenCalledTimes(2));
});

it('compares with the current text, and keeps it on this device before restoring an older version', async () => {
  localStorage.clear();
  const onRestore = vi.fn();
  render(panel({ target, dirty: true, current: () => '# Plan\none\ntwo\nthree\n', onRestore }));
  fireEvent.click(await screen.findByRole('button', { name: /Start the plan/ }));
  const reader = await screen.findByRole('dialog');
  await waitFor(() => expect(reader.querySelector('pre.history-text')).toHaveTextContent('# Plan one'));

  fireEvent.click(within(reader).getByRole('button', { name: 'Compare' }));
  const compareWith = within(reader).getByRole('combobox', { name: 'Compare with' });
  fireEvent.click(compareWith);
  const options = screen.getAllByRole('option').map(option => option.textContent);
  expect(options.slice(0, 3)).toEqual(['Previous change', expect.stringMatching(/^Latest version · /), 'Current text (not committed)']);
  fireEvent.click(screen.getByRole('option', { name: 'Current text (not committed)' }));
  await waitFor(() => expect([...reader.querySelectorAll('.diff-line.diff-added')].map(line => line.textContent?.trim())).toEqual(['+two', '+three']));

  fireEvent.click(within(reader).getByRole('button', { name: 'Compare' }));
  fireEvent.click(await within(reader).findByRole('button', { name: 'Restore this version' }));
  await waitFor(() => expect(onRestore).toHaveBeenCalledWith('# Plan\none\n'));
  const kept = JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('github-notes:history-stash:'))!)!);
  expect(kept).toEqual([expect.objectContaining({ content: '# Plan\none\ntwo\nthree\n' })]);
  expect(await screen.findByRole('heading', { name: 'Text before restoring (kept on this device)' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Discard this kept text' }));
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  expect(screen.queryByRole('heading', { name: 'Text before restoring (kept on this device)' })).toBeNull();
  expect(Object.keys(localStorage).filter(key => key.startsWith('github-notes:history-stash:'))).toEqual([]);
});
