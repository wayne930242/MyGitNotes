import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const product = process.cwd();
const dirs: string[] = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-migrate-cli-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const env = { ...process.env };
// Empty keys, as a shell or .env.example leaves them, must not hide the checkout .env.
for (const key of ['MYGITNOTES_LOCAL_PATH', 'GITHUB_NOTES_LOCAL_PATH', 'MYGITNOTES_SOURCE', 'GITHUB_NOTES_SOURCE', 'REPO_ROOT']) env[key] = '';
const run = (cwd: string, args: string[] = []) => execFileSync(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/migrate-workspace.ts'), ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env });

it('migrates the workspace named by the Core checkout .env', () => {
  const core = temp(), notes = temp();
  fs.writeFileSync(path.join(core, '.env'), `MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=${notes}\n`);
  fs.writeFileSync(path.join(notes, '.mygitnotes.yaml'), 'workspace:\n  title: N\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  expect(run(core)).toContain(`Migrated ${notes}`);
  expect(fs.readFileSync(path.join(notes, '.mygitnotes.yaml'), 'utf8')).toMatch(/^schema_version: 3$/m);
  expect(run(core, ['--workspace', notes])).toContain('already current');
}, 15000);

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
function screenWorkspace() {
  const notes = temp();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(notes, file)), { recursive: true });
    fs.writeFileSync(path.join(notes, file), text);
  };
  write('.mygitnotes.yaml', 'schema_version: 2\nworkspace:\n  title: N\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  write('notes/a/one.md', '---\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# One\n');
  write('.github-notes-screen.yaml', 'version: 2\nrows:\n  - id: reading\n    notebookId: a\n    kind: custom\n    name: Reading\n    view: small\n    items:\n      - id: n1\n        kind: note\n        notebookId: a\n        path: notes/a/one.md\n');
  git(notes, ['init', '-q', '-b', 'main']);
  git(notes, ['add', '--all']);
  git(notes, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']);
  return notes;
}

it('commits the Screen migration of a Git worktree as one commit and leaves the tree clean', () => {
  const core = temp(), notes = screenWorkspace();
  const output = run(core, ['--workspace', notes]);
  expect(output).toContain('1 compilation(s)');
  expect(output).toContain('Committed');
  expect(fs.existsSync(path.join(notes, 'notes/a/reading.compilation.yml'))).toBe(true);
  expect(fs.existsSync(path.join(notes, '.github-notes-screen.yaml'))).toBe(false);
  expect(git(notes, ['status', '--porcelain'])).toBe('');
  expect(git(notes, ['log', '--format=%s'])).toBe('chore: migrate Screen lanes to compilations\ninit\n');
}, 30000);

it('stops without writing when the Screen file has uncommitted changes', () => {
  const core = temp(), notes = screenWorkspace();
  fs.appendFileSync(path.join(notes, '.github-notes-screen.yaml'), '# local edit\n');
  expect(() => run(core, ['--workspace', notes])).toThrow(/uncommitted changes/);
  expect(fs.readFileSync(path.join(notes, '.mygitnotes.yaml'), 'utf8')).toMatch(/^schema_version: 2$/m);
  expect(fs.existsSync(path.join(notes, '.github-notes-screen.yaml'))).toBe(true);
}, 30000);
