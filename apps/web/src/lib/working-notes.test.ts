import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommittedNotes, overlayWorkingNotes, readWorkingNotes, updateWorkingNote } from './working-notes.js';
import type { NoteItem } from './types.js';

const base: NoteItem = { id: 'a', path: 'notes/ex/a.md', notebookId: 'ex', title: 'A', content: '# A\n', metadata: { custom: 'keep' }, tags: [], revision: 'one' };
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
describe('browser working notes', () => {
  it('restores pending notes, keeps their baseline and separates source branches', () => {
    const draft = { base, note: { ...base, content: '# Edited\n' } };
    updateWorkingNote('repo:main', base.path, draft);
    expect(readWorkingNotes('repo:main')[base.path]).toEqual(draft);
    expect(readWorkingNotes('other:main')).toEqual({});
    expect(overlayWorkingNotes([base], readWorkingNotes('repo:main'))[0].content).toBe('# Edited\n');
  });
  it('clears only the committed version and retains edits made during a request', () => {
    const sent = { base, note: { ...base, content: '# First\n' } };
    updateWorkingNote('repo:main', base.path, sent);
    updateWorkingNote('repo:main', base.path, { ...sent, note: { ...base, content: '# Later\n' } });
    expect(clearCommittedNotes('repo:main', { [base.path]: sent })[base.path].note.content).toBe('# Later\n');
    const current = readWorkingNotes('repo:main');
    expect(clearCommittedNotes('repo:main', current)).toEqual({});
  });
  it('treats a return to baseline as clean and reports storage failure', () => {
    updateWorkingNote('repo:main', base.path, { base, note: { ...base, content: 'changed' } });
    expect(updateWorkingNote('repo:main', base.path, { base, note: base })).toEqual({});
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Storage full'); } });
    expect(() => updateWorkingNote('repo:main', base.path, { base, note: { ...base, content: 'changed' } })).toThrow('Storage full');
  });
});
