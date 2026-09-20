// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { CommitModal } from './CommitModal.js';
import type { FileChange } from '../lib/types.js';
vi.mock('../lib/api.js', () => ({ commitStagedChanges: vi.fn(), fetchFileChanges: vi.fn(), fetchFileDiff: vi.fn(), generateSemanticCommit: vi.fn(), manageFileChange: vi.fn() }));
const blocked: FileChange = { path: 'notes/gone.md', staged: false, unstaged: true, kind: 'conflict', tracked: true, revision: 'r1', available: false };
const editable: FileChange = { path: 'notes/keep.md', staged: false, unstaged: true, kind: 'modified', tracked: true, revision: 'r2', available: true };
// jsdom ships no dialog implementation, so the modal shell needs one before it can mount.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function() {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const mount = (restoreFile: (file: FileChange) => Promise<void>) =>
  render(
    <I18nProvider>
      <CommitModal isOpen writable gitStatus={null} remoteChanges={[blocked, editable]} getPreview={file => `--- a/${file}\n+++ b/${file}\n+draft line\n`} restoreFile={restoreFile} commitFiles={vi.fn()} onChanged={async () => {}} onCommitted={async () => {}} onClose={() => {}} />
    </I18nProvider>,
  );
describe('A remote change the repository refuses', () => {
  it('stays out of the commit selection so the other changes remain committable', () => {
    mount(vi.fn());
    expect((screen.getByRole('checkbox', { name: 'Select notes/gone.md' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Select notes/keep.md' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: /Commit to remote repository/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('can still be discarded, which is the only way out of the state', async () => {
    const restoreFile = vi.fn().mockResolvedValue(undefined);
    mount(restoreFile);
    const discard = screen.getByRole('button', { name: 'Restore notes/gone.md' });
    expect((discard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(discard);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    await waitFor(() => expect(restoreFile).toHaveBeenCalledWith(expect.objectContaining({ path: 'notes/gone.md' })));
  });
  it('shows the draft it would throw away instead of only the reason it is refused', async () => {
    mount(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: /^notes\/gone\.md/ }));
    await screen.findByText('+draft line');
  });
});
