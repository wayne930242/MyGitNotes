// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LegacyOutlineDialog } from './LegacyOutlineDialog.js';
import { useLegacyBookmarkRecovery } from '../lib/use-legacy-bookmark-recovery.js';
import { legacyBookmarkDraftKey } from '../lib/legacy-bookmark-recovery.js';
import { WORKSPACE_DOCUMENT_CLIENTS } from '../lib/workspace-document-clients.js';
import { downloadTextFile } from '../lib/note-export.js';
import type { LegacyOutlinePreview } from '../lib/outline-import.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
vi.mock('../lib/note-export.js', () => ({ downloadTextFile: vi.fn() }));
const repositories: WorkspaceRepository[] = [{ id: 'repo-a', alias: 'repo-a', type: 'local', branch: 'main', revision: '', write: true, notebooks: ['a'], title: 'repo-a', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' }, { id: 'repo-b', alias: 'repo-b', type: 'github', branch: 'main', revision: '', write: false, notebooks: ['b'], title: 'repo-b', defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '', unavailable: { reason: 'unmapped', message: 'Unavailable' } }];
const notebooks = [{ id: 'a', title: 'A', root: 'notes/shared' }, { id: 'b', title: 'B', root: 'notes/shared' }];
const entry = { id: 'note', label: 'Guide', groupId: null, target: { kind: 'note' as const, path: 'guide.md' } };
const source = { repository: 'repo-a', path: '.mygitnotes-bookmarks.yaml', revision: 'original', writable: true, base64: 'AP+A', error: null, page: { version: 1, notebooks: [{ notebookId: 'a', groups: [], bookmarks: [entry, { ...entry, id: 'folder', label: 'Folder', target: { kind: 'folder', path: 'chapter' } }] }] } };
const preview: LegacyOutlinePreview = { repository: 'repo-a', notebookId: 'a', path: 'notes/shared/imported.outline.md', markdown: '- [Guide](guide.md)\n', token: 'a'.repeat(64), revision: 'original', writable: true, persistence: 'worktree', convertedIds: ['note'], groups: [], partial: true, retained: [{ notebookId: 'a', entry: { ...entry, id: 'folder', label: 'Folder' }, reason: 'folder' }, { notebookId: 'unknown', entry: { ...entry, id: 'foreign' }, reason: 'other-owner' }] };
const onCreated = vi.fn(async () => {}), onClose = vi.fn();
function Harness() {
  const recovery = useLegacyBookmarkRecovery(repositories.map(repository => repository.id));
  return (
    <>
      <output data-testid='pending'>{recovery.recoveries.length}</output>
      <LegacyOutlineDialog repositories={repositories} notebooks={notebooks} recoveries={recovery.recoveries} recoveryError={recovery.error} onRecoveryChanged={recovery.refresh} onCreated={onCreated} onClose={onClose} />
    </>
  );
}
let requests: { url: string; body: Record<string, unknown> | undefined; }[];
let answer: typeof preview;
let applyStatus: number;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('github-notes:language', 'en');
  requests = [];
  answer = structuredClone(preview);
  applyStatus = 200;
  onCreated.mockClear();
  onClose.mockClear();
  vi.mocked(downloadTextFile).mockClear();
  HTMLDialogElement.prototype.showModal = function() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function() {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/source?')) return Response.json(source);
      if (url.endsWith('/preview')) return Response.json(answer);
      if (url.includes('/notes/read')) return Response.json({ note: { content: 'Originally requested outline' } });
      return Response.json({ error: 'Apply failed' }, { status: applyStatus });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function select(label: string, option: string) {
  const control = screen.getByRole('combobox', { name: label });
  act(() => control.focus());
  fireEvent.keyDown(control, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  act(() => item.focus());
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(control).toHaveTextContent(option));
}
async function fill() {
  await select('Saved source repository', 'repo-a');
  await screen.findByText(/Source revision: original/);
  await select('Destination notebook', 'A · a');
  fireEvent.change(screen.getByLabelText('Note Title'), { target: { value: 'Imported' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Guide · note · note' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Folder · folder · folder' }));
}
async function review() {
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByRole('button', { name: 'Apply partial import' });
}
it('previews explicit selections, retained owners and worktree semantics, requires acknowledgement, and opens only after apply', async () => {
  render(<Harness />);
  await review();
  expect(screen.getByText(/Another or unknown notebook owner/)).toBeInTheDocument();
  expect(screen.getByText(/local worktree file/)).toBeInTheDocument();
  const apply = screen.getByRole('button', { name: 'Apply partial import' });
  expect(apply).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand this is a partial import/ }));
  fireEvent.click(apply);
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  const sent = requests.find(request => request.url === '/api/outline-import')!.body!;
  expect(sent).toEqual({ repository: 'repo-a', notebookId: 'a', path: 'notes/shared/imported.outline.md', title: 'Imported', selectedIds: ['note', 'folder'], token: 'a'.repeat(64), acknowledgePartial: true });
});
it('cancel and editing a preview write nothing', async () => {
  render(<Harness />);
  await review();
  fireEvent.change(screen.getByLabelText('Note Title'), { target: { value: 'Changed' } });
  expect(screen.queryByRole('button', { name: 'Apply partial import' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(requests.some(request => request.url === '/api/outline-import')).toBe(false);
});
it('read-only previews explain a remote one-commit apply but keep it disabled', async () => {
  answer = { ...preview, writable: false, persistence: 'commit' };
  render(<Harness />);
  await review();
  expect(screen.getByText(/one remote commit/)).toBeInTheDocument();
  expect(screen.getByText(/Read-only repository/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
  expect(screen.getByRole('button', { name: 'Apply partial import' })).toBeDisabled();
});
it('a stale refusal invalidates the preview without retrying', async () => {
  applyStatus = 409;
  render(<Harness />);
  await review();
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply partial import' }));
  await screen.findByText('Apply failed');
  expect(screen.queryByRole('button', { name: 'Apply partial import' })).toBeNull();
  expect(requests.filter(request => request.url === '/api/outline-import')).toHaveLength(1);
  expect(onCreated).not.toHaveBeenCalled();
});
it('unknown outcomes freeze the original request and inspect that destination without applying again', async () => {
  applyStatus = 500;
  render(<Harness />);
  await review();
  fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply partial import' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect original destination' }));
  await screen.findByText('Originally requested outline');
  expect(screen.getByLabelText('New outline path (repository-relative)')).toBeDisabled();
  expect(requests.find(request => request.url.includes('/notes/read'))?.url).toBe('/api/notes/read?path=notes%2Fshared%2Fimported.outline.md&notebookId=a');
  expect(requests.filter(request => request.url === '/api/outline-import')).toHaveLength(1);
});
it('detects inactive/unavailable malformed and empty raw envelopes; export/cancel preserve exact bytes and discard is repository-specific', async () => {
  localStorage.setItem(legacyBookmarkDraftKey('repo-a'), '');
  const raw = '  {"page":broken, "base":"do not rebase"}\n';
  localStorage.setItem(legacyBookmarkDraftKey('repo-b'), raw);
  render(<Harness />);
  expect(screen.getByTestId('pending')).toHaveTextContent('2');
  expect(WORKSPACE_DOCUMENT_CLIENTS.map(client => client.document.file)).not.toContain('.mygitnotes-bookmarks.yaml');
  fireEvent.click(screen.getAllByRole('button', { name: 'Export exact browser draft' })[1]);
  expect(downloadTextFile).toHaveBeenCalledWith('legacy-bookmarks-draft.json', raw, 'application/json');
  fireEvent.click(screen.getAllByRole('button', { name: 'Discard browser draft…' })[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(localStorage.getItem(legacyBookmarkDraftKey('repo-b'))).toBe(raw);
  fireEvent.click(screen.getAllByRole('button', { name: 'Discard browser draft…' })[1]);
  fireEvent.change(screen.getByLabelText('Repository ID confirmation'), { target: { value: 'repo-b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  expect(localStorage.getItem(legacyBookmarkDraftKey('repo-b'))).toBeNull();
  expect(localStorage.getItem(legacyBookmarkDraftKey('repo-a'))).toBe('');
  expect(screen.getByTestId('pending')).toHaveTextContent('1');
  expect(requests).toHaveLength(0);
});
it('refuses a changed recovery envelope at discard and refreshes on storage events', async () => {
  localStorage.setItem(legacyBookmarkDraftKey('repo-b'), 'before');
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Discard browser draft…' }));
  localStorage.setItem(legacyBookmarkDraftKey('repo-b'), 'after');
  fireEvent.change(screen.getByLabelText('Repository ID confirmation'), { target: { value: 'repo-b' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
  expect(screen.getByRole('alert')).toHaveTextContent('recovery draft changed');
  expect(localStorage.getItem(legacyBookmarkDraftKey('repo-b'))).toBe('after');
  localStorage.setItem(legacyBookmarkDraftKey('repo-a'), 'new');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: legacyBookmarkDraftKey('repo-a') })));
  expect(screen.getByTestId('pending')).toHaveTextContent('2');
});
it('creates nothing for a preview with no representable selection', async () => {
  answer = { ...preview, markdown: null, convertedIds: [], partial: false };
  render(<Harness />);
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('Nothing selected can be represented. No file will be created.');
  expect(screen.getByRole('button', { name: 'Create outline' })).toBeDisabled();
  expect(requests.some(request => request.url === '/api/outline-import')).toBe(false);
});
it('ignores a late saved-source response after switching repositories', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('repo-a')
        ? new Promise<Response>(resolve => {
          finish = resolve;
        })
        : Promise.resolve(Response.json({ ...source, repository: 'repo-b', revision: 'B only', page: null }))
    ),
  );
  render(<Harness />);
  await select('Saved source repository', 'repo-a');
  await select('Saved source repository', 'repo-b');
  await screen.findByText(/Source revision: B only/);
  await act(async () => finish(Response.json(source)));
  expect(screen.queryByText(/Source revision: original/)).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Destination notebook' })).toBeNull();
});
it('shows storage access failures rather than silently claiming no recoveries', () => {
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(this: Storage, key: string) {
    if (key.startsWith('github-notes:bookmarks-draft:')) throw new Error('Storage unavailable');
    return get.call(this, key);
  });
  render(<Harness />);
  expect(screen.getByRole('alert')).toHaveTextContent('Storage unavailable');
});
it('downloads the saved source as original bytes, not decoded UTF-8', async () => {
  let exported: Blob | undefined;
  URL.createObjectURL = vi.fn(blob => {
    exported = blob as Blob;
    return 'blob:export';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<Harness />);
  await select('Saved source repository', 'repo-a');
  const button = await screen.findByRole('button', { name: 'Export exact saved source' });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  const bytes = await new Promise<ArrayBuffer>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(exported!);
  });
  expect([...new Uint8Array(bytes)]).toEqual([0, 255, 128]);
});
