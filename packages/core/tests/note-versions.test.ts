import { describe, expect, it } from 'vitest';
import { addVersion, agentEditMessage, isAgentEdit, nextVersionNumbers, type NoteVersionFile, placeVersions, readVersionFile, relabelVersion, relocateVersionFiles, removeVersion, serializeVersionFile, VERSION_FILE_MAX_BYTES, versionedPath, versionFileChanges, versionFilePath } from '../src/note-versions.js';
import { historyFile } from '../src/note-history.js';

const sha = (n: number) => n.toString(16).padStart(40, '0');
const notebooks = [{ id: 'ex', title: 'Example', root: 'notes/ex' }];

describe('version files', () => {
  it('keeps one version file per file under .mygitnotes/versions', () => {
    expect(versionFilePath('notes/ex/會議.md')).toBe('.mygitnotes/versions/notes/ex/會議.md.yaml');
    expect(versionedPath('.mygitnotes/versions/notes/ex/會議.md.yaml')).toBe('notes/ex/會議.md');
    expect(versionedPath('.mygitnotes/versions/../x.yaml')).toBeUndefined();
    expect(versionedPath('notes/ex/a.md')).toBeUndefined();
  });

  it('numbers versions by sequence and by date, with a counter for a second version on one day', () => {
    expect(nextVersionNumbers([], '2026-10-07')).toEqual({ sequence: 1, date: '2026.10.07' });
    expect(nextVersionNumbers([{ sequence: 1, date: '2026.10.07' }], '2026-10-07')).toEqual({ sequence: 2, date: '2026.10.07-2' });
    expect(nextVersionNumbers([{ sequence: 1, date: '2026.10.07' }, { sequence: 4, date: '2026.10.07-3' }], '2026-10-07')).toEqual({ sequence: 5, date: '2026.10.07-4' });
    expect(nextVersionNumbers([{ sequence: 2, date: '2026.10.06' }], '2026-10-07')).toEqual({ sequence: 3, date: '2026.10.07' });
  });

  it('adds, renames and deletes versions without changing their numbers', () => {
    const file: NoteVersionFile = { versions: [] };
    addVersion(file, { blob: sha(1), commit: sha(2), authored: '2026-10-07T01:00:00Z' }, { name: ' First draft ', note: 'Outline only.\n' }, '2026-10-07', new Date('2026-10-07T02:00:00Z'));
    addVersion(file, { blob: sha(3), parent: sha(2), authored: '2026-10-07T03:00:00Z' }, {}, '2026-10-07');
    expect(file.versions.map(({ sequence, date, name, note }) => ({ sequence, date, name, note }))).toEqual([{ sequence: 1, date: '2026.10.07', name: 'First draft', note: 'Outline only.' }, { sequence: 2, date: '2026.10.07-2', name: undefined, note: undefined }]);
    expect(() => addVersion(file, { blob: sha(1), commit: sha(2), authored: '2026-10-07T01:00:00Z' }, {}, '2026-10-07')).toThrow('already');
    relabelVersion(file, 1, { name: 'Final' });
    expect(file.versions[0]).toMatchObject({ sequence: 1, name: 'Final' });
    expect(file.versions[0].note).toBeUndefined();
    removeVersion(file, 2);
    expect(file.versions.map(version => version.sequence)).toEqual([1]);
    expect(readVersionFile(serializeVersionFile(file))).toEqual(file);
    expect(() => relabelVersion(file, 9, {})).toThrow('no longer exists');
  });

  it('refuses a version that names neither or both of its commit and parent, and a file past its size limit', () => {
    expect(() => readVersionFile(`versions:\n  - blob: ${sha(1)}\n    authored: 2026-10-07T00:00:00Z\n    sequence: 1\n    date: 2026.10.07\n    created: 2026-10-07T00:00:00Z\n`)).toThrow();
    expect(() => readVersionFile('x'.repeat(VERSION_FILE_MAX_BYTES + 1))).toThrow('too many versions');
  });

  it('places versions on history entries by commit, by parent, by author date, then by content', () => {
    const entries = [{ commit: sha(30), parents: [sha(20)], date: '2026-10-07T03:00:00+08:00', blob: sha(3) }, { commit: sha(20), parents: [sha(10)], date: '2026-10-07T02:00:00+08:00', blob: sha(2) }, { commit: sha(10), parents: [], date: '2026-10-07T01:00:00+08:00', blob: sha(1) }];
    const base = { sequence: 1, date: '2026.10.07', created: '2026-10-07T00:00:00Z' };
    const byCommit = { ...base, blob: sha(9), commit: sha(10), authored: '2026-01-01T00:00:00Z' };
    const byParent = { ...base, sequence: 2, blob: sha(9), parent: sha(20), authored: '2026-01-01T00:00:00Z' };
    // A rebase changed the ids, but the author date the app set is still there.
    const byDate = { ...base, sequence: 3, blob: sha(9), parent: sha(99), authored: '2026-10-06T17:00:00.000Z' };
    const byBlob = { ...base, sequence: 4, blob: sha(2), commit: sha(98), authored: '2026-01-01T00:00:00Z' };
    const lost = { ...base, sequence: 5, blob: sha(97), commit: sha(96), authored: '2026-01-01T00:00:00Z' };
    const placed = placeVersions([byCommit, byParent, byDate, byBlob, lost], entries);
    expect(placed.get(sha(10))).toEqual([byCommit, byDate]);
    expect(placed.get(sha(30))).toEqual([byParent]);
    expect(placed.get(sha(20))).toEqual([byBlob]);
    expect([...placed.values()].flat()).not.toContain(lost);
  });

  it('carries version files along moves and deletions', () => {
    const relocate = (file: string) => file.replace('notes/ex/old/', 'notes/ex/new/');
    expect(relocateVersionFiles([versionFilePath('notes/ex/old/a.md'), versionFilePath('notes/ex/gone.md'), versionFilePath('notes/ex/kept.md')], relocate, file => file === 'notes/ex/gone.md')).toEqual([{ from: versionFilePath('notes/ex/old/a.md'), to: versionFilePath('notes/ex/new/a.md') }, { from: versionFilePath('notes/ex/gone.md'), to: null }]);
    const entries = [{ path: versionFilePath('notes/ex/old/a.md'), sha: sha(5), type: 'blob' }];
    expect(versionFileChanges(entries, ['notes/ex/old/a.md', 'notes/ex/old/b.md'], relocate, () => false)).toEqual([{ path: versionFilePath('notes/ex/new/a.md'), sha: sha(5) }, { path: versionFilePath('notes/ex/old/a.md'), sha: null }]);
  });
});

describe('agent edit marks', () => {
  it('names the agent and the day in the subject and repeats the day in a trailer', () => {
    const now = new Date('2026-10-07T23:30:00Z');
    expect(agentEditMessage('docs(skills): write SKILL.md', now)).toBe('docs(skills): write SKILL.md (Agent, 2026-10-07)\n\nAgent-Edit: 2026-10-07');
    expect(agentEditMessage('Fix intro\n\nReworded the opening.\n\nNote-Modified: notes/ex/a.md', now)).toBe('Fix intro (Agent, 2026-10-07)\n\nReworded the opening.\n\nNote-Modified: notes/ex/a.md\nAgent-Edit: 2026-10-07');
    expect(isAgentEdit(agentEditMessage('docs(notes): edit a.md', now))).toBe(true);
    expect(isAgentEdit('docs(notes): edit a.md')).toBe(false);
  });
});

describe('history files', () => {
  it('covers notes and agent files but not version files or workspace records', () => {
    expect(historyFile('notes/ex/a.md', notebooks)).toBe(true);
    expect(historyFile('notes/ex/plan.outline.md', notebooks)).toBe(true);
    expect(historyFile('AGENTS.md', notebooks)).toBe(true);
    expect(historyFile('notes/ex/AGENTS.md', notebooks)).toBe(true);
    expect(historyFile('notes/ex/.agents/skills/demo/SKILL.md', notebooks)).toBe(true);
    expect(historyFile(versionFilePath('notes/ex/a.md'), notebooks)).toBe(false);
    expect(historyFile('.github-notes-study.yaml', notebooks)).toBe(false);
    expect(historyFile('notes/ex/../secret.md', notebooks)).toBe(false);
    expect(historyFile('package.json', notebooks)).toBe(false);
  });
});
