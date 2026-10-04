// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { FileManager } from './FileManagerView.js';
import { useFileManager } from './useFileManager.js';
import { FileManagerDialog } from './FileManagerDialog.js';
import type { FileManagerProps } from './types.js';
import { fetchFiles, type FileEntry, type FileListing, mutateFile, readFile } from '../../lib/files-api.js';

vi.mock('../../lib/files-api.js', async original => ({ ...await original<typeof import('../../lib/files-api.js')>(), fetchFiles: vi.fn(), mutateFile: vi.fn(), readFile: vi.fn() }));
vi.mock('../../lib/r2-api.js', async original => ({ ...await original<typeof import('../../lib/r2-api.js')>(), fetchR2: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../FileSourceEditor.js', () => ({ FileSourceEditor: ({ content, label, onChange }: { content: string; label: string; onChange: (value: string) => void; }) => <textarea aria-label={label} value={content} onChange={event => onChange(event.target.value)} /> }));
const entry = (path: string, directory = false): FileEntry => ({ path, name: path.split('/').at(-1)!, directory, size: directory ? 0 : 42, hidden: path.includes('/.'), presentation: 'file', noteDirectory: directory });
const listing: FileListing = { root: 'notes/a', revision: 'r1', writable: true, remote: false, entries: [entry('notes/a/one', true), entry('notes/a/one/nested', true), entry('notes/a/two', true), entry('notes/a/one/note.md'), entry('notes/a/one/nested/inside.md'), entry('notes/a/one/nested/.hidden'), entry('notes/a/one/nested/_dir.yml'), entry('notes/a/one/config.json')] };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function() {
    this.removeAttribute('open');
  };
  vi.mocked(fetchFiles).mockResolvedValue(listing);
  vi.mocked(readFile).mockImplementation(async (_id, path) => ({ path, content: 'original', revision: 'r1' }));
  vi.mocked(mutateFile).mockResolvedValue({ revision: 'r2', selectedPath: 'notes/a', pathMap: {}, deletedPaths: [] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const mount = (props: Partial<FileManagerProps> = {}) => render(<FileManager notebookId='a' writable layout='dialog' initialPath='notes/a/one' {...props} />);
const select = async (name: string) => {
  const button = await screen.findByRole('button', { name: `Select file: ${name}` });
  fireEvent.click(button);
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
};
const operation = (name: string) => within(screen.getByRole('dialog', { name }));

it('shows documents only for folder-context browsing, retaining asset and image-picker defaults', async () => {
  const first = mount({ showDocuments: true });
  expect(await screen.findByRole('button', { name: 'Select file: note.md' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show Markdown files' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('navigation', { name: 'Location' })).toHaveTextContent('Notebook root / one');
  first.unmount();
  const second = mount();
  await screen.findByRole('button', { name: 'Select file: config.json' });
  expect(screen.queryByRole('button', { name: 'Select file: note.md' })).not.toBeInTheDocument();
  second.unmount();
  mount({ mode: 'pick-image', showDocuments: true });
  await screen.findByRole('button', { name: 'Select file: config.json' });
  expect(screen.queryByRole('button', { name: 'Select file: note.md' })).not.toBeInTheDocument();
});
it('single-click selects without opening, double-click and Enter open folders, and Up returns to the parent', async () => {
  mount({ showDocuments: true });
  await select('nested');
  expect(screen.getByRole('button', { name: 'Select file: nested' })).toHaveAttribute('aria-pressed', 'true');
  expect(readFile).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Select file: inside.md' })).not.toBeInTheDocument();
  fireEvent.doubleClick(screen.getByRole('button', { name: 'Select file: nested' }));
  expect(await screen.findByRole('button', { name: 'Select file: inside.md' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Up' }));
  const folder = await screen.findByRole('button', { name: 'Select file: nested' });
  fireEvent.keyDown(folder, { key: 'Enter' });
  expect(await screen.findByRole('button', { name: 'Select file: inside.md' })).toBeInTheDocument();
});
it('selects a document without reading it and opens its editor on Enter; details collapse without losing edits', async () => {
  mount({ showDocuments: true });
  await select('note.md');
  expect(readFile).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Select file: note.md' }), { key: 'Enter' });
  const source = await screen.findByRole('textbox', { name: 'File source code' });
  fireEvent.change(source, { target: { value: 'changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'File details' }));
  expect(screen.queryByRole('textbox', { name: 'File source code' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'File details' }));
  expect(await screen.findByRole('textbox', { name: 'File source code' })).toHaveValue('changed');
});
it.each(['move', 'remove-directory'] as const)('opens requested %s directly for the exact nested folder and cancels without mutation', async initialOperation => {
  mount({ initialPath: 'notes/a/one/nested', initialOperation, showDocuments: true });
  const dialog = await screen.findByRole('dialog', { name: initialOperation === 'move' ? 'Move' : 'Delete folder' });
  expect(dialog).toHaveTextContent('notes/a/one/nested');
  expect(within(dialog).getByLabelText('Destination folder')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mutateFile).not.toHaveBeenCalled();
});
it('renames in place and moves to an existing destination with distinct forms and unchanged names', async () => {
  mount();
  await select('nested');
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  const rename = await screen.findByRole('dialog', { name: 'Rename' });
  expect(within(rename).queryByLabelText('Destination folder')).not.toBeInTheDocument();
  fireEvent.change(within(rename).getByLabelText('File or folder name'), { target: { value: 'renamed' } });
  fireEvent.click(within(rename).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mutateFile).toHaveBeenCalledWith({ notebookId: 'a', kind: 'move', path: 'notes/a/one/nested', destination: 'notes/a/one/renamed' }, 'r1'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.doubleClick(await screen.findByRole('button', { name: 'Select file: one' }));
  await select('nested');
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));
  const move = await screen.findByRole('dialog', { name: 'Move' });
  expect(within(move).queryByLabelText('File or folder name')).not.toBeInTheDocument();
  const destination = within(move).getByLabelText('Destination folder');
  expect(within(destination).queryByRole('option', { name: 'one/nested' })).not.toBeInTheDocument();
  fireEvent.change(destination, { target: { value: 'notes/a/two' } });
  fireEvent.click(within(move).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mutateFile).toHaveBeenLastCalledWith({ notebookId: 'a', kind: 'move', path: 'notes/a/one/nested', destination: 'notes/a/two/nested' }, 'r1'));
});
it('defaults folder deletion to preserving contents and uses the selected existing destination', async () => {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  mount({ initialPath: 'notes/a/one/nested', initialOperation: 'remove-directory', onChanged });
  await screen.findByRole('dialog', { name: 'Delete folder' });
  const dialog = operation('Delete folder');
  expect(dialog.getByLabelText('Keep contents: move them to another folder')).toBeChecked();
  expect(dialog.getByRole('list')).toHaveTextContent('.hidden');
  fireEvent.change(dialog.getByLabelText('Destination folder'), { target: { value: 'notes/a/two' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(mutateFile).toHaveBeenCalledWith({ notebookId: 'a', kind: 'remove-directory', path: 'notes/a/one/nested', destination: 'notes/a/two' }, 'r1'));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
});
it('lists recursive scope including hidden files and metadata, requires explicit confirmation, and resets it after switching modes', async () => {
  mount({ initialPath: 'notes/a/one/nested', initialOperation: 'remove-directory' });
  await screen.findByRole('dialog', { name: 'Delete folder' });
  const dialog = operation('Delete folder');
  fireEvent.click(dialog.getByLabelText('Delete this folder and all contents'));
  expect(dialog.getByRole('list')).toHaveTextContent('_dir.yml');
  expect(dialog.getByRole('list')).toHaveTextContent('.hidden');
  expect(dialog.queryByLabelText('Destination folder')).not.toBeInTheDocument();
  expect(dialog.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  fireEvent.submit(dialog.getByRole('form'));
  expect(mutateFile).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('checkbox'));
  fireEvent.click(dialog.getByLabelText('Keep contents: move them to another folder'));
  fireEvent.click(dialog.getByLabelText('Delete this folder and all contents'));
  expect(dialog.getByRole('checkbox')).not.toBeChecked();
  fireEvent.click(dialog.getByRole('checkbox'));
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(mutateFile).toHaveBeenCalledWith({ notebookId: 'a', kind: 'delete-directory', path: 'notes/a/one/nested' }, 'r1'));
});
it('cancels destructive choice with Escape without a mutation', async () => {
  mount({ initialPath: 'notes/a/one/nested', initialOperation: 'remove-directory' });
  const dialog = await screen.findByRole('dialog', { name: 'Delete folder' });
  fireEvent.click(within(dialog).getByLabelText('Delete this folder and all contents'));
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mutateFile).not.toHaveBeenCalled();
});
it('keeps dirty editor navigation and dialog-close guards; cancelling keeps contents and discard proceeds', async () => {
  const onClose = vi.fn();
  render(<FileManagerDialog notebookId='a' writable initialPath='notes/a/one/config.json' onClose={onClose} />);
  const source = await screen.findByRole('textbox', { name: 'File source code' });
  fireEvent.change(source, { target: { value: 'dirty' } });
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Files' })).getByRole('button', { name: 'Close' }));
  const leave = await screen.findByRole('dialog', { name: 'Unsaved changes' });
  fireEvent.click(within(leave).getByRole('button', { name: 'Keep editing' }));
  expect(onClose).not.toHaveBeenCalled();
  expect(source).toHaveValue('dirty');
  fireEvent.click(screen.getByRole('button', { name: 'Select file: nested' }));
  await screen.findByRole('dialog', { name: 'Unsaved changes' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select file: nested' })).toHaveAttribute('aria-pressed', 'true'));
  expect(mutateFile).not.toHaveBeenCalled();
});
it('blocks mutation when parent editor flush rejects and displays the error inside the operation dialog', async () => {
  const beforeChange = vi.fn().mockRejectedValue(new Error('Pending note drafts'));
  mount({ initialPath: 'notes/a/one/nested', initialOperation: 'remove-directory', beforeChange });
  await screen.findByRole('dialog', { name: 'Delete folder' });
  fireEvent.click(operation('Delete folder').getByRole('button', { name: 'Confirm deletion' }));
  expect(await operation('Delete folder').findByRole('alert')).toHaveTextContent('Pending note drafts');
  expect(mutateFile).not.toHaveBeenCalled();
});
it('never submits an unseen R2 deletion scope after reading metadata; reload requires a new explicit confirmation', async () => {
  let catalog = listing;
  let newFileExists = true;
  const added = entry('notes/a/one/nested/new.md');
  vi.mocked(fetchFiles).mockImplementation(async () => catalog);
  vi.mocked(readFile).mockImplementation(async (_id, path) => ({ path, revision: catalog.revision, metadata: { title: 'Nested', order: 0 } }));
  vi.mocked(mutateFile).mockImplementation(async (command, revision) => {
    if (revision !== catalog.revision) throw new Error('The workspace changed. Reload before saving.');
    if (command.kind === 'delete-directory') newFileExists = false;
    return { revision: 'r3', selectedPath: 'notes/a', pathMap: {}, deletedPaths: [] };
  });
  mount({ showDocuments: true });
  await select('nested');
  catalog = { ...listing, revision: 'r2', entries: [...listing.entries, added] };
  fireEvent.click(within(screen.getByRole('region', { name: 'File details' })).getByRole('button', { name: 'Folder information' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Display name' })).toBeEnabled());
  fireEvent.click(within(screen.getByRole('form', { name: 'Folder information' })).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('dialog', { name: 'Delete folder' });
  let dialog = operation('Delete folder');
  fireEvent.click(dialog.getByLabelText('Delete this folder and all contents'));
  expect(dialog.getByRole('list')).not.toHaveTextContent('new.md');
  fireEvent.click(dialog.getByRole('checkbox'));
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(mutateFile).toHaveBeenCalledWith({ kind: 'delete-directory', notebookId: 'a', path: 'notes/a/one/nested' }, 'r1'));
  expect(await dialog.findByRole('alert')).toHaveTextContent('workspace changed');
  expect(newFileExists).toBe(true);
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
  await waitFor(() => expect(fetchFiles).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('dialog', { name: 'Delete folder' });
  dialog = operation('Delete folder');
  fireEvent.click(dialog.getByLabelText('Delete this folder and all contents'));
  expect(dialog.getByRole('list')).toHaveTextContent('new.md');
  expect(dialog.getByRole('checkbox')).not.toBeChecked();
  expect(dialog.getByRole('button', { name: 'Confirm deletion' })).toBeDisabled();
  expect(newFileExists).toBe(true);
  fireEvent.click(dialog.getByRole('checkbox'));
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm deletion' }));
  await waitFor(() => expect(mutateFile).toHaveBeenLastCalledWith({ kind: 'delete-directory', notebookId: 'a', path: 'notes/a/one/nested' }, 'r2'));
  expect(newFileExists).toBe(false);
});

const managerHook = async () => {
  const hook = renderHook(() => useFileManager({ notebookId: 'a', writable: true, initialPath: 'notes/a/one', layout: 'dialog' }, null));
  await waitFor(() => expect(hook.result.current.listing).toBe(listing));
  await act(async () => {
    await hook.result.current.selectEntry('notes/a/one/nested');
  });
  return hook;
};
it('invalidates recursive confirmation when the full catalog is replaced or the selected scope changes', async () => {
  const { result } = await managerHook();
  await act(async () => {
    await result.current.openOperation('remove-directory');
  });
  act(() => {
    result.current.setDeleteMode('contents');
    result.current.setDeleteConfirmed(true);
  });
  expect(result.current.deleteConfirmed).toBe(true);
  const newer = { ...listing, revision: 'r2', entries: [...listing.entries, entry('notes/a/one/nested/new.md')] };
  vi.mocked(fetchFiles).mockResolvedValue(newer);
  await act(async () => {
    await result.current.refresh();
  });
  expect(result.current.listing).toBe(newer);
  expect(result.current.deleteConfirmed).toBe(false);
  await act(async () => {
    await result.current.submit();
  });
  expect(mutateFile).not.toHaveBeenCalled();
  act(() => {
    result.current.setDeleteConfirmed(true);
  });
  act(() => {
    result.current.setSelected('notes/a/two');
  });
  expect(result.current.deleteConfirmed).toBe(false);
});
it('saves metadata with its own read revision while leaving the catalog snapshot untouched until the successful refresh', async () => {
  const { result } = await managerHook();
  vi.mocked(readFile).mockImplementation(async (_id, path) => ({ path, revision: 'r2', metadata: { title: 'Current title', order: 4 } }));
  await act(async () => {
    await result.current.openOperation('metadata');
  });
  expect(result.current.listing).toBe(listing);
  expect(result.current.title).toBe('Current title');
  act(() => {
    result.current.setTitle('Edited title');
  });
  const refreshed = { ...listing, revision: 'r3', entries: [...listing.entries, entry('notes/a/one/nested/new.md')] };
  vi.mocked(fetchFiles).mockResolvedValue(refreshed);
  await act(async () => {
    await result.current.submit();
  });
  expect(mutateFile).toHaveBeenCalledWith({ kind: 'metadata', notebookId: 'a', path: 'notes/a/one/nested', title: 'Edited title', description: '', order: 4 }, 'r2');
  expect(result.current.listing).toBe(refreshed);
});
it('keeps a metadata edit stale even if a later catalog refresh observes a newer revision', async () => {
  const { result } = await managerHook();
  vi.mocked(readFile).mockImplementation(async (_id, path) => ({ path, revision: 'r2', metadata: { title: 'Read at R2', order: 0 } }));
  await act(async () => {
    await result.current.openOperation('metadata');
  });
  vi.mocked(fetchFiles).mockResolvedValue({ ...listing, revision: 'r3' });
  await act(async () => {
    await result.current.refresh();
  });
  vi.mocked(mutateFile).mockRejectedValue(new Error('Stale metadata'));
  await act(async () => {
    await result.current.submit();
  });
  expect(mutateFile).toHaveBeenCalledWith(expect.objectContaining({ kind: 'metadata', title: 'Read at R2' }), 'r2');
  expect(result.current.error).toBe('Stale metadata');
  expect(result.current.operation).toBe('metadata');
});
it('does not reuse a previous metadata revision after a failed read for another folder', async () => {
  const { result } = await managerHook();
  await act(async () => {
    await result.current.openOperation('metadata');
  });
  await act(async () => {
    await result.current.selectEntry('notes/a/two');
  });
  vi.mocked(readFile).mockRejectedValue(new Error('Metadata unavailable'));
  await act(async () => {
    await result.current.openOperation('metadata');
  });
  expect(result.current.error).toBe('Metadata unavailable');
  await act(async () => {
    await result.current.submit();
  });
  expect(mutateFile).not.toHaveBeenCalled();
});
it('disables metadata Save after a read failure while keeping cancellation available', async () => {
  mount();
  await select('nested');
  vi.mocked(readFile).mockRejectedValue(new Error('Metadata unavailable'));
  fireEvent.click(within(screen.getByRole('region', { name: 'File details' })).getByRole('button', { name: 'Folder information' }));
  const form = await screen.findByRole('form', { name: 'Folder information' });
  expect(await within(form).findByRole('alert')).toHaveTextContent('Metadata unavailable');
  expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.submit(form);
  expect(mutateFile).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Folder information' })).not.toBeInTheDocument();
});
it('keeps text reads and writes on their own revision without promoting the catalog', async () => {
  const { result } = await managerHook();
  vi.mocked(readFile).mockImplementation(async (_id, path) => ({ path, revision: 'r2', content: 'R2 text' }));
  await act(async () => {
    await result.current.loadDetail('notes/a/one/config.json');
  });
  expect(result.current.listing).toBe(listing);
  expect(result.current.detail?.revision).toBe('r2');
  act(() => {
    result.current.setContent('Edited text');
  });
  vi.mocked(mutateFile).mockRejectedValue(new Error('Stale text'));
  await act(async () => {
    await result.current.save();
  });
  expect(mutateFile).toHaveBeenCalledWith({ kind: 'write', notebookId: 'a', path: 'notes/a/one/config.json', content: 'Edited text' }, 'r2');
  expect(result.current.listing).toBe(listing);
  expect(result.current.dirty).toBe(true);
});

it('pairs saved text with its returned revision without promoting a catalog whose refresh failed', async () => {
  const { result } = await managerHook();
  vi.mocked(readFile).mockImplementation(async (_id, path) => ({ path, revision: 'r2', content: 'R2 text' }));
  await act(async () => {
    await result.current.loadDetail('notes/a/one/config.json');
  });
  act(() => {
    result.current.setContent('Saved text');
  });
  vi.mocked(mutateFile).mockResolvedValue({ revision: 'r3', selectedPath: 'notes/a/one/config.json', pathMap: {}, deletedPaths: [] });
  vi.mocked(fetchFiles).mockRejectedValue(new Error('Catalog unavailable'));
  await act(async () => {
    await result.current.save();
  });
  expect(result.current.detail).toMatchObject({ path: 'notes/a/one/config.json', content: 'Saved text', revision: 'r3' });
  expect(result.current.dirty).toBe(false);
  expect(result.current.listing).toBe(listing);
  expect(result.current.error).toBe('Catalog unavailable');
  await act(async () => {
    await result.current.selectEntry('notes/a/one/nested');
  });
  await act(async () => {
    await result.current.openOperation('remove-directory');
  });
  act(() => {
    result.current.setDeleteMode('contents');
    result.current.setDeleteConfirmed(true);
  });
  vi.mocked(mutateFile).mockRejectedValue(new Error('Stale catalog'));
  await act(async () => {
    await result.current.submit();
  });
  expect(mutateFile).toHaveBeenLastCalledWith({ kind: 'delete-directory', notebookId: 'a', path: 'notes/a/one/nested' }, 'r1');
});

it('keeps folder operations unavailable in read-only mode', async () => {
  mount({ writable: false, initialPath: 'notes/a/one/nested', initialOperation: 'remove-directory' });
  await screen.findByRole('button', { name: 'Select file: nested' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  expect(mutateFile).not.toHaveBeenCalled();
});
