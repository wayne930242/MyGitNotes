import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommittedNotes, deletionEntry, readStoredWorkingNotes, readWorkingNotes, updateWorkingNote, workingDiff, workingNotesKey } from './working-notes.js';
import type { NoteItem } from './types.js';

const base: NoteItem = { id: 'a', path: 'notes/ex/a.md', notebookId: 'kb~ex', title: 'A', content: '# A\n', metadata: { custom: 'keep' }, tags: [], revision: 'one' };
beforeEach(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe('working note diff previews', () => {
  it('shows a single changed line in a large note with nearby context', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}`);
    const original = { ...base, content: lines.join('\n') + '\n' };
    lines[249] = 'Updated line 250';
    const note = { ...original, content: lines.join('\n') + '\n' };
    const diff = workingDiff({ [note.path]: { base: original, note } });
    expect(diff).toBe(['--- notes/ex/a.md', '+++ notes/ex/a.md', '@@ -250,7 +250,7 @@', ' Line 247', ' Line 248', ' Line 249', '-Line 250', '+Updated line 250', ' Line 251', ' Line 252', ' Line 253', ''].join('\n'));
  });

  it('includes metadata changes and omits unchanged entries', () => {
    const note = { ...base, metadata: { custom: 'updated' } };
    const diff = workingDiff({ [base.path]: { base, note }, unchanged: { base, note: base } });
    expect(diff).toContain('-custom: keep\n+custom: updated\n');
    expect(diff.match(/^--- notes\/ex\/a.md$/gm)).toHaveLength(1);
    expect(workingDiff({ [base.path]: { base, note: base } })).toBe('');
    expect(workingDiff({})).toBe('');
  });

  it('shows a new note as additions including its frontmatter', () => {
    expect(workingDiff({ [base.path]: { base: null, note: base } })).toBe(['--- /dev/null', '+++ notes/ex/a.md', '@@ -0,0 +1,4 @@', '+---', '+custom: keep', '+---', '+# A', ''].join('\n'));
  });
});
const main = { scope: 'repo:main', alias: 'kb' };
describe('browser working notes', () => {
  it('restores pending notes, keeps their baseline and separates source branches', () => {
    const draft = { base, note: { ...base, content: '# Edited\n' } };
    updateWorkingNote(main, base.path, draft);
    expect(readWorkingNotes(main)[base.path]).toEqual(draft);
    expect(readWorkingNotes({ scope: 'other:main', alias: 'kb' })).toEqual({});
  });
  it('clears only the committed version and retains edits made during a request', () => {
    const sent = { base, note: { ...base, content: '# First\n' } };
    updateWorkingNote(main, base.path, sent);
    updateWorkingNote(main, base.path, { ...sent, note: { ...base, content: '# Later\n' } });
    expect(clearCommittedNotes(main, { [base.path]: sent })[base.path].note.content).toBe('# Later\n');
    const current = readWorkingNotes(main);
    expect(clearCommittedNotes(main, current)).toEqual({});
  });
  it('treats a return to baseline as clean and reports storage failure', () => {
    updateWorkingNote(main, base.path, { base, note: { ...base, content: 'changed' } });
    expect(updateWorkingNote(main, base.path, { base, note: base })).toEqual({});
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('Storage full');
      },
    });
    expect(() => updateWorkingNote(main, base.path, { base, note: { ...base, content: 'changed' } })).toThrow('Storage full');
  });
});

describe('drafts saved before notebook keys', () => {
  const local = { ...base, notebookId: 'ex' };
  it('stores local notebook ids under the unchanged storage key and reads them under keys', () => {
    updateWorkingNote(main, base.path, { base, note: { ...base, content: '# Edited\n' } });
    expect(JSON.parse(localStorage.getItem(workingNotesKey('repo:main'))!)[base.path].note.notebookId).toBe('ex');
    expect(readStoredWorkingNotes('repo:main')[base.path].base?.notebookId).toBe('ex');
    expect(readWorkingNotes(main)[base.path].note.notebookId).toBe('kb~ex');
  });
  it('loads an old note, deletion and new-note draft under keys and clears them after their commit', () => {
    const stored = { [base.path]: { base: local, note: { ...local, content: '# Old\n' } }, 'notes/ex/b.md': { base: { ...local, path: 'notes/ex/b.md' }, note: { ...local, path: 'notes/ex/b.md' }, deleted: true }, 'notes/ex/c.md': { base: null, note: { ...local, path: 'notes/ex/c.md' } } };
    localStorage.setItem(workingNotesKey('repo:main'), JSON.stringify(stored));
    const loaded = readWorkingNotes(main);
    expect(Object.values(loaded).map(entry => [entry.note.notebookId, entry.base?.notebookId ?? null, entry.deleted ?? false])).toEqual([['kb~ex', 'kb~ex', false], ['kb~ex', 'kb~ex', true], ['kb~ex', null, false]]);
    expect(clearCommittedNotes(main, loaded)).toEqual({});
  });
  it('keeps a draft whose notebook ids cannot be read as stored, for recovery', () => {
    const malformed = { note: { ...local, notebookId: 'not a notebook' }, base: local };
    localStorage.setItem(workingNotesKey('repo:main'), JSON.stringify({ [base.path]: malformed }));
    expect(readWorkingNotes(main)[base.path]).toEqual(malformed);
    updateWorkingNote(main, 'notes/ex/other.md', { base: null, note: { ...base, path: 'notes/ex/other.md' } });
    expect(readStoredWorkingNotes('repo:main')[base.path]).toEqual(malformed);
  });
});

describe('deletions', () => {
  it('keeps a deletion, whose note equals its base, and diffs it as a removed file', () => {
    const entries = updateWorkingNote({ scope: 'scope', alias: 'kb' }, base.path, deletionEntry(base));
    expect(entries[base.path]).toEqual({ note: base, base, deleted: true });
    const diff = workingDiff(entries);
    expect(diff).toContain('-# A');
    expect(diff).not.toContain('+# A');
  });
});
