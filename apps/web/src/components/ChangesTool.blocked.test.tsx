// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { ChangesTool } from './ChangesTool.js';
import type { FileChange } from '../lib/types.js';
vi.mock('../lib/api.js', () => ({ fetchFileChanges: vi.fn(), fetchFileDiff: vi.fn() }));
const blocked: FileChange = { path: 'notes/gone.md', staged: false, unstaged: true, kind: 'conflict', tracked: true, revision: 'r1', available: false };
const editable: FileChange = { path: 'notes/keep.md', staged: false, unstaged: true, kind: 'modified', tracked: true, revision: 'r2', available: true };
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const mount = (onOpenCommitModal: (request?: { action: string; paths: string[]; }) => void) =>
  render(
    <I18nProvider>
      <ChangesTool writable gitStatus={null} deletedNotes={[]} remoteChanges={[blocked, editable]} getPreview={file => `--- a/${file}\n+++ b/${file}\n+draft line\n`} onRestoreNote={() => {}} onOpenCommitModal={onOpenCommitModal as never} />
    </I18nProvider>,
  );
describe('A remote change the repository refuses, in the Changes rail', () => {
  it('offers its own discard, which is the only way out of the state', () => {
    const open = vi.fn();
    mount(open);
    const discard = screen.getByRole('button', { name: 'Restore notes/gone.md' });
    expect((discard as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(discard);
    expect(open).toHaveBeenCalledWith({ action: 'restore', paths: ['notes/gone.md'] });
  });
  it('is carried by Restore all rather than left behind by it', () => {
    const open = vi.fn();
    mount(open);
    fireEvent.click(screen.getByRole('button', { name: /Restore all/ }));
    expect(open).toHaveBeenCalledWith({ action: 'restore', paths: ['notes/gone.md', 'notes/keep.md'] });
  });
  it('shows the draft it would throw away instead of only the reason it is refused', async () => {
    mount(vi.fn());
    fireEvent.click(screen.getByTitle('notes/gone.md'));
    await screen.findByText('+draft line');
  });
});
