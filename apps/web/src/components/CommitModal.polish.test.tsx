// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../lib/i18n/index.js';
import { type NoteChangeFacts } from '../lib/commit-summary.js';
import { type WebFeature, WebFeaturesProvider } from '../lib/web-features.js';
import { CommitModal } from './CommitModal.js';
import type { FileChange } from '../lib/types.js';
vi.mock('../lib/api.js', () => ({ commitStagedChanges: vi.fn(), fetchFileChanges: vi.fn(), fetchFileDiff: vi.fn(), generateSemanticCommit: vi.fn(), manageFileChange: vi.fn() }));
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

const file = (path: string): FileChange => ({ path, staged: false, unstaged: true, kind: 'modified', tracked: true, revision: path, available: true });
const facts = (path: string, title: string): NoteChangeFacts => ({ path, title, added: false, tagsAdded: [], tagsRemoved: [], sectionsAdded: [], sectionsRemoved: [], tasksDone: 0, tasksReopened: 0, tasksAdded: 0, textDelta: 40, statusFrom: 'working', statusTo: 'done' });
const describeChanges = (files: FileChange[]) => ({ notes: files.map(change => facts(change.path, change.path.replace(/^notes\/|\.md$/g, ''))), documents: [] });

function mount(features: WebFeature[], commitFiles: (files: FileChange[], message: string) => Promise<void> = vi.fn()) {
  return render(
    <I18nProvider>
      <WebFeaturesProvider features={features}>
        <CommitModal isOpen writable gitStatus={null} remoteChanges={[file('notes/a.md'), file('notes/b.md')]} getPreview={() => ''} describeChanges={describeChanges} restoreFile={vi.fn()} commitFiles={commitFiles} onChanged={async () => {}} onCommitted={async () => {}} onClose={() => {}} />
      </WebFeaturesProvider>
    </I18nProvider>,
  );
}
const subject = () => screen.getByRole('textbox', { name: 'Commit Message' }) as HTMLInputElement;
const commit = () => fireEvent.click(screen.getByRole('button', { name: /Commit to remote repository/ }));

describe('The commit dialog polish button', () => {
  it('is absent without an edition that supplies a polish', () => {
    mount([{ id: 'plain' }]);
    expect(screen.getByRole('button', { name: 'Generate message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'AI polish' })).toBeNull();
  });

  it('sends the facts and the whole message, and always regenerates the trailers from the facts', async () => {
    const commitFiles = vi.fn().mockResolvedValue(undefined);
    const commitMessagePolish = vi.fn().mockResolvedValue('Finish the weekly notes\n\nBoth notes are done.\n\nNote-Modified: notes/invented.md');
    mount([{ id: 'ai', commitMessagePolish }], commitFiles);
    fireEvent.click(screen.getByRole('button', { name: 'AI polish' }));
    await waitFor(() => expect(subject().value).toBe('Finish the weekly notes'));
    expect(commitMessagePolish).toHaveBeenCalledTimes(1);
    const input = commitMessagePolish.mock.calls[0][0];
    expect(input.facts.map((entry: NoteChangeFacts) => entry.path)).toEqual(['notes/a.md', 'notes/b.md']);
    expect(input.message).toMatch(/^Update 2 files: a, b\n\n- a: status working → done/);
    expect(input.message).toMatch(/Note-Modified: notes\/a\.md\nNote-Modified: notes\/b\.md$/);
    commit();
    await waitFor(() => expect(commitFiles).toHaveBeenCalled());
    expect(commitFiles.mock.calls[0][1]).toBe('Finish the weekly notes\n\nBoth notes are done.\n\nNote-Modified: notes/a.md\nNote-Modified: notes/b.md');
  });

  it('restores a trailer the polish dropped', async () => {
    const commitFiles = vi.fn().mockResolvedValue(undefined);
    mount([{ id: 'ai', commitMessagePolish: async () => 'Only a subject' }], commitFiles);
    fireEvent.click(screen.getByRole('button', { name: 'AI polish' }));
    await waitFor(() => expect(subject().value).toBe('Only a subject'));
    commit();
    await waitFor(() => expect(commitFiles).toHaveBeenCalled());
    expect(commitFiles.mock.calls[0][1]).toBe('Only a subject\n\nNote-Modified: notes/a.md\nNote-Modified: notes/b.md');
  });

  it('keeps the message and reports the error when the polish fails', async () => {
    mount([{
      id: 'ai',
      commitMessagePolish: async () => {
        throw new Error('Add an API key in Settings.');
      },
    }]);
    const before = subject().value;
    fireEvent.click(screen.getByRole('button', { name: 'AI polish' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Add an API key in Settings.');
    expect(subject().value).toBe(before);
  });

  it('goes back to the generated body when the selection changes after a polish', async () => {
    const commitFiles = vi.fn().mockResolvedValue(undefined);
    mount([{ id: 'ai', commitMessagePolish: async () => 'Subject\n\nPolished body for two notes.' }], commitFiles);
    fireEvent.click(screen.getByRole('button', { name: 'AI polish' }));
    await waitFor(() => expect(subject().value).toBe('Subject'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select notes/b.md' }));
    commit();
    await waitFor(() => expect(commitFiles).toHaveBeenCalled());
    expect(commitFiles.mock.calls[0][1]).toBe('Subject\n\nNote-Modified: notes/a.md');
  });

  it('shows the gate reason instead of the button, and never calls the polish', () => {
    const commitMessagePolish = vi.fn();
    mount([{ id: 'ai', commitMessagePolish, gate: id => id === 'commit-polish' ? { allowed: false, reason: 'Upgrade to Pro to polish messages.' } : { allowed: true } }]);
    expect(screen.queryByRole('button', { name: 'AI polish' })).toBeNull();
    expect(screen.getByText('Upgrade to Pro to polish messages.')).toBeTruthy();
    expect(commitMessagePolish).not.toHaveBeenCalled();
  });
});
