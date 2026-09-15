import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { parseNoteContent } from '../packages/core/src/index.js';

const execFileAsync = promisify(execFile);
const product = process.cwd();
let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (name: string, content: string) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
const commitAt = async (files: string[], message: string, isoDate: string) => {
  await execFileAsync('git', ['add', '--', ...files], { cwd: root });
  await execFileAsync('git', ['commit', '-m', message], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate } });
};
const backfill = () => execFileSync(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/backfill-note-timestamps.ts')], { cwd: root, stdio: 'pipe', encoding: 'utf8' });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-backfill-'));
  write('.github-notes.yaml', 'schema_version: 1\nworkspace:\n  title: Personal\n  default_notebook: personal\nnotebooks:\n  - id: personal\n    title: Personal\n    root: notes/personal\n');
  git('init', '-b', 'core');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('backfill-note-timestamps CLI', () => {
  it('fills created/updated from git history and never overwrites an existing value or the body', async () => {
    write('notes/personal/no-metadata.md', '# No metadata\n\nBody one.\n');
    await commitAt(['notes/personal/no-metadata.md'], 'add note without metadata', '2026-09-12T09:00:00+00:00');

    write('notes/personal/partial.md', '---\ncreated: "2015-09-17T16:48:45.115Z"\ncustom: keep-me\n---\n\nBody two.\n');
    await commitAt(['notes/personal/partial.md'], 'add partial note', '2026-09-13T10:00:00+00:00');
    write('notes/personal/partial.md', '---\ncreated: "2015-09-17T16:48:45.115Z"\ncustom: keep-me\n---\n\nBody two, edited.\n');
    await commitAt(['notes/personal/partial.md'], 'edit partial note', '2026-09-14T11:30:00+00:00');

    const completeRaw = '---\ncreated: "2010-01-01T00:00:00.000Z"\nupdated: "2010-01-02T00:00:00.000Z"\n---\n\nAlready complete.\n';
    write('notes/personal/complete.md', completeRaw);
    await commitAt(['notes/personal/complete.md'], 'add complete note', '2026-09-15T12:00:00+00:00');

    backfill();

    const noMetadata = parseNoteContent(fs.readFileSync(path.join(root, 'notes/personal/no-metadata.md'), 'utf8'));
    expect(noMetadata.metadata.created).toBe('2026-09-12T09:00:00.000Z');
    expect(noMetadata.metadata.updated).toBe('2026-09-12T09:00:00.000Z');
    expect(noMetadata.content.trim()).toBe('# No metadata\n\nBody one.'.trim());

    const partial = parseNoteContent(fs.readFileSync(path.join(root, 'notes/personal/partial.md'), 'utf8'));
    expect(partial.metadata.created).toBe('2015-09-17T16:48:45.115Z');
    expect(partial.metadata.updated).toBe('2026-09-14T11:30:00.000Z');
    expect(partial.metadata.custom).toBe('keep-me');
    expect(partial.content.trim()).toBe('Body two, edited.');

    expect(fs.readFileSync(path.join(root, 'notes/personal/complete.md'), 'utf8')).toBe(completeRaw);
  });
});
