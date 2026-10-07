import { describe, expect, it } from 'vitest';
import { callNoteShell } from '../src/note-shell.js';
import { agentEditMessage, placeVersions, readVersionFile, versionFilePath } from '../src/note-versions.js';
import { gitBlobId } from '../src/remote-cache.js';
import { githubFixture } from './fixtures/github.js';

const versions = (f: ReturnType<typeof githubFixture>, file: string) => readVersionFile(f.text(versionFilePath(file)) ?? null).versions;

// Remote writes are spaced a second apart, as GitHub asks, so tests with several writes take a few seconds.
describe('remote note history', { timeout: 20_000 }, () => {
  it('lists the commits that changed a note and reads the note as each one held it', async () => {
    const f = githubFixture({}, { hexIds: true });
    const start = f.head();
    await callNoteShell(f.reader(), 'write', { path: 'notes/ex/a.md', content: '# Alpha\nsecond\n', revision: f.head() }, true);
    const second = f.head();
    await callNoteShell(f.reader(), 'write', { path: 'notes/ex/work/b.md', content: '# Beta\nelsewhere\n', revision: f.head() }, true);
    await callNoteShell(f.reader(), 'append', { path: 'notes/ex/a.md', content: 'third\n', revision: f.head() }, true);
    const third = f.head();

    const { entries, more } = await f.reader().fileHistory('notes/ex/a.md', 1, 50);
    expect(entries.map(entry => entry.commit)).toEqual([third, second, start]);
    expect(more).toBe(false);
    expect(entries[0]).toMatchObject({ subject: `docs(notes): append a.md (Agent, ${new Date().toISOString().slice(0, 10)})`, agent: true, parents: [expect.any(String)], path: 'notes/ex/a.md', author: 'Tester' });
    expect(entries[2].agent).toBe(false);
    expect(await f.reader().readFileAt(second, 'notes/ex/a.md')).toMatchObject({ content: '# Alpha\nsecond\n' });
    expect(await f.reader().readFileAt(start, 'notes/ex/missing.md')).toBeUndefined();
    expect(await f.reader().commitDetails(second)).toMatchObject({ paths: ['notes/ex/a.md'] });
    const paged = await f.reader().fileHistory('notes/ex/a.md', 1, 2);
    expect(paged.more).toBe(true);
  });

  it('records a new version in the same commit as the note, naming the head it was made on', async () => {
    const f = githubFixture({}, { hexIds: true });
    const before = f.head();
    const receipt = await f.reader().commitNotes([{ path: 'notes/ex/a.md', content: '# Alpha\nrevised\n', metadata: { custom: 'retained' } }], before, 'Revise alpha', [], { path: 'notes/ex/a.md', label: { name: 'Draft', note: 'First pass.' }, today: '2026-10-07' });
    expect(receipt.changedPaths).toEqual([versionFilePath('notes/ex/a.md'), 'notes/ex/a.md'].sort());
    const [version] = versions(f, 'notes/ex/a.md');
    expect(version).toMatchObject({ parent: before, sequence: 1, date: '2026.10.07', name: 'Draft', note: 'First pass.', blob: gitBlobId(Buffer.from(f.text('notes/ex/a.md')!), 40) });
    expect(version.commit).toBeUndefined();
    // The history entry of that one commit carries the version.
    const { entries } = await f.reader().fileHistory('notes/ex/a.md', 1, 50);
    expect(placeVersions([version], entries).get(f.head())).toEqual([version]);
    await expect(f.reader().commitNotes([{ path: 'notes/ex/a.md', content: 'x', metadata: {} }, { path: 'notes/ex/work/b.md', content: 'y', metadata: {} }], f.head(), 'Both', [], { path: 'notes/ex/a.md', label: {}, today: '2026-10-07' })).rejects.toThrow('alone');
  });

  it('writes version files only in the versions scope, and lets other scopes move or delete them', async () => {
    const f = githubFixture({}, { hexIds: true });
    const file = versionFilePath('notes/ex/a.md');
    await expect(f.reader().commitChanges([{ path: file, content: 'versions: []\n' }], f.head(), 'save', 'files')).rejects.toMatchObject({ status: 403 });
    await expect(f.reader().commitChanges([{ path: 'notes/ex/a.md', content: 'x' }], f.head(), 'save', 'versions')).rejects.toMatchObject({ status: 403 });
    await f.reader().commitChanges([{ path: file, content: 'versions: []\n' }], f.head(), 'save', 'versions', 'docs(versions): test');
    expect(f.text(file)).toBe('versions: []\n');
  });

  it('carries a note’s version file along an MCP move and removal', async () => {
    const f = githubFixture({ [versionFilePath('notes/ex/work/b.md')]: 'versions: []\n' }, { hexIds: true });
    await callNoteShell(f.reader(), 'mv', { source: 'notes/ex/work', destination: 'notes/ex/done', recursive: true, revision: f.head() }, true);
    expect(f.files()).toContain(versionFilePath('notes/ex/done/b.md'));
    expect(f.files()).not.toContain(versionFilePath('notes/ex/work/b.md'));
    await callNoteShell(f.reader(), 'rm', { paths: ['notes/ex/done/b.md'], revision: f.head() }, true);
    expect(f.files()).not.toContain(versionFilePath('notes/ex/done/b.md'));
  });

  it('lets an agent edit the AGENTS.md files the system prompt reads, marked as an agent edit', async () => {
    const f = githubFixture({ 'notes/ex/AGENTS.md': '# Rules\n' }, { hexIds: true });
    const receipt: any = await callNoteShell(f.reader(), 'edit', { path: 'notes/ex/AGENTS.md', startLine: 1, endLine: 1, content: '# House rules', revision: f.head() }, true);
    expect(receipt.commit.message).toBe(agentEditMessage('docs(agents): edit AGENTS.md'));
    expect(f.text('notes/ex/AGENTS.md')).toBe('# House rules\n');
    const created: any = await callNoteShell(f.reader(), 'write', { path: 'AGENTS.md', content: '# Root\n', revision: f.head() }, true);
    expect(created.changedPaths).toEqual(['AGENTS.md']);
    await expect(callNoteShell(f.reader(), 'write', { path: 'notes/ex/.hidden/AGENTS.md', content: 'x', revision: f.head() }, true)).rejects.toMatchObject({ status: 403 });
  });
});
