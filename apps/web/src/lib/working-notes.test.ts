import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommittedNotes, overlayWorkingNotes, readWorkingNotes, updateWorkingNote, workingDiff } from './working-notes.js';
import type { NoteItem } from './types.js';

const base: NoteItem = { id: 'a', path: 'notes/ex/a.md', notebookId: 'ex', title: 'A', content: '# A\n', metadata: { custom: 'keep' }, tags: [], revision: 'one' };
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
    expect(diff).toBe([
      '--- notes/ex/a.md', '+++ notes/ex/a.md', '@@ -250,7 +250,7 @@',
      ' Line 247', ' Line 248', ' Line 249', '-Line 250', '+Updated line 250',
      ' Line 251', ' Line 252', ' Line 253', '',
    ].join('\n'));
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
    expect(workingDiff({ [base.path]: { base: null, note: base } })).toBe([
      '--- /dev/null', '+++ notes/ex/a.md', '@@ -0,0 +1,4 @@',
      '+---', '+custom: keep', '+---', '+# A', '',
    ].join('\n'));
  });
});
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
