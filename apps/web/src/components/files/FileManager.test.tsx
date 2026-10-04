// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { FileManager } from './FileManagerView.js';
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
it('keeps folder operations unavailable in read-only mode', async () => {
  mount({ writable: false, initialPath: 'notes/a/one/nested', initialOperation: 'remove-directory' });
  await screen.findByRole('button', { name: 'Select file: nested' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  expect(mutateFile).not.toHaveBeenCalled();
});
