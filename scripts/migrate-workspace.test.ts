import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const product = process.cwd();
const dirs: string[] = [];
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-migrate-cli-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const env = { ...process.env };
// Empty keys, as a shell or .env.example leaves them, must not hide the checkout .env.
for (const key of ['MYGITNOTES_LOCAL_PATH', 'GITHUB_NOTES_LOCAL_PATH', 'MYGITNOTES_SOURCE', 'GITHUB_NOTES_SOURCE', 'REPO_ROOT']) env[key] = '';
const run = (cwd: string, args: string[] = []) => execFileSync(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/migrate-workspace.ts'), ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env });

it('migrates the workspace named by the Core checkout .env', () => {
  const core = temp(), notes = temp();
  fs.writeFileSync(path.join(core, '.env'), `MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=${notes}\n`);
  fs.writeFileSync(path.join(notes, '.mygitnotes.yaml'), 'workspace:\n  title: N\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n');
  expect(run(core)).toContain(`Migrated ${notes}`);
  expect(fs.readFileSync(path.join(notes, '.mygitnotes.yaml'), 'utf8')).toMatch(/^schema_version: 1$/m);
  expect(run(core, ['--workspace', notes])).toContain('already current');
}, 15000);
