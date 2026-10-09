import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { deploymentConfigSource } from '../packages/core/src/index.js';

const product = process.cwd();
/** Core's YAML parser; the product root does not depend on it directly. */
const YAML = createRequire(path.join(product, 'packages/core/package.json'))('yaml') as typeof import('yaml');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const env = { ...process.env };
for (const key of ['MYGITNOTES_LOCAL_PATH', 'GITHUB_NOTES_LOCAL_PATH', 'MYGITNOTES_SOURCE', 'GITHUB_NOTES_SOURCE', 'REPO_ROOT', 'MYGITNOTES_SERVER_CONFIG', 'GITHUB_NOTES_SERVER_CONFIG']) env[key] = '';
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

/** A Git worktree on main with `files` committed. */
function worktree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-convert-'));
  dirs.push(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'user.email', 'test@example.com']);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}
/** A Core checkout whose .env names `home` and whose server configuration maps `mappings`. */
function checkout(home: string, mappings: Record<string, string>): string {
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-convert-core-'));
  dirs.push(core);
  fs.writeFileSync(path.join(core, '.env'), `MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=${home}\n`);
  fs.writeFileSync(path.join(core, 'mygitnotes.server.yaml'), `# Notebook repositories checked out beside the workspace.\nrepositories:\n${Object.entries(mappings).map(([repository, worktree]) => `  - type: github\n    repository: ${repository}\n    path: ${worktree}\n`).join('')}`);
  return core;
}
const run = (cwd: string, args: string[] = []) => spawnSync(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/convert-sources.ts'), ...args], { cwd, encoding: 'utf8', env });
const commits = (root: string) => git(root, ['log', '--format=%s']).trim().split('\n');
const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8');

const focus = 'version: 1\nfocuses:\n  - id: campaign\n    notebookId: trpg\n    name: Campaign\n    division: single\n    panes:\n      - tabs: []\n';
const study = 'version: 1\nnotes: []\n';
/** The Focus and Study files the trpg repository already has of its own. */
const trpgFocus = 'version: 1\nfocuses:\n  - id: table\n    notebookId: trpg\n    name: Table\n    division: single\n    panes:\n      - tabs: []\n';
const trpgStudy = 'version: 1\nnotes:\n  - path: notes/life/b.md\n';
const homeManifest = `schema_version: 3
# The owner's notebooks.
workspace:
  title: Home
  default_notebook: life
preferences:
  defaultShowLineNumbers: true
notebooks:
  - id: life
    title: Life
    root: notes/life
  - id: trpg
    title: TRPG
    root: notes/life
    statuses: [draft, done]
    source: { type: github, repository: owner/trpg }
  - id: lore
    title: Lore
    root: notes/lore
    source: { type: github, repository: owner/lore }
`;
const loreManifest = 'schema_version: 3\nworkspace:\n  title: Lore library\n  default_notebook: books\npreferences:\n  defaultFocusMode: true\nnotebooks:\n  - id: books\n    title: Books\n    root: notes/books\n';

/** The owner's workspace: a home repository with two notebooks in other repositories, one with a manifest of its own. */
function fixture() {
  const home = worktree({ '.mygitnotes.yaml': homeManifest, 'notes/life/a.md': '# A\n', '.github-notes-focus.yaml': focus, '.github-notes-study.yaml': study });
  const trpg = worktree({ 'notes/life/b.md': '# B\n', '.github-notes-focus.yaml': trpgFocus, '.github-notes-study.yaml': trpgStudy });
  const lore = worktree({ '.mygitnotes.yaml': loreManifest, 'notes/lore/c.md': '# C\n' });
  return { home, trpg, lore, core: checkout(home, { 'owner/trpg': trpg, 'owner/lore': lore }) };
}

it('moves each notebook with source into its own repository, one commit per repository, after showing the plan', async () => {
  const { home, trpg, lore, core } = fixture();
  const shown = run(core);
  expect(shown.status).toBe(0);
  expect(shown.stdout).toContain('Nothing was written. Run again with --yes');
  // A new manifest is shown in full before anything is written.
  expect(shown.stdout).toMatch(/owner\/trpg .*adds notebook\(s\) trpg, creating \.mygitnotes\.yaml:\n {6}schema_version: 4\n {6}workspace:\n {8}title: trpg/);
  expect(shown.stdout).toContain('owner/lore');
  expect(shown.stdout).toContain('keeping its title, default notebook and preferences');
  expect(shown.stdout).toContain('.github-notes-focus.yaml in ' + home + ' names notebook trpg 1 time(s)');
  expect(commits(home)).toEqual(['fixture']);
  expect(fs.existsSync(path.join(trpg, '.mygitnotes.yaml'))).toBe(false);

  const result = run(core, ['--yes']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const converted = YAML.parse(read(home, '.mygitnotes.yaml'));
  expect(converted).toMatchObject({ schema_version: 4, workspace: { title: 'Home', default_notebook: 'life' }, notebooks: [{ id: 'life', root: 'notes/life' }] });
  expect(converted.notebooks).toHaveLength(1);
  expect(read(home, '.mygitnotes.yaml')).toContain("# The owner's notebooks.");
  expect(YAML.parse(read(trpg, '.mygitnotes.yaml'))).toEqual({ schema_version: 4, workspace: { title: 'trpg', default_notebook: 'trpg' }, notebooks: [{ id: 'trpg', title: 'TRPG', root: 'notes/life', statuses: ['draft', 'done'] }], preferences: { defaultShowLineNumbers: true } });
  // An existing manifest keeps its title, default notebook and preferences.
  expect(YAML.parse(read(lore, '.mygitnotes.yaml'))).toEqual({ schema_version: 4, workspace: { title: 'Lore library', default_notebook: 'books' }, preferences: { defaultFocusMode: true }, notebooks: [{ id: 'books', title: 'Books', root: 'notes/books' }, { id: 'lore', title: 'Lore', root: 'notes/lore' }] });
  for (const root of [home, trpg, lore]) {
    expect(commits(root)).toHaveLength(2);
    expect(git(root, ['status', '--porcelain'])).toBe('');
  }
  // Focus and Study files stay as they were in both repositories.
  expect(read(home, '.github-notes-focus.yaml')).toBe(focus);
  expect(read(home, '.github-notes-study.yaml')).toBe(study);
  expect(read(trpg, '.github-notes-focus.yaml')).toBe(trpgFocus);
  expect(read(trpg, '.github-notes-study.yaml')).toBe(trpgStudy);
  expect(run(core, ['--yes']).stdout).toContain('has no notebook with source; nothing to convert');
}, 60000);

it('refuses before writing anything when a target cannot take a notebook', async () => {
  const unmapped = fixture();
  fs.writeFileSync(path.join(unmapped.core, 'mygitnotes.server.yaml'), `repositories:\n  - type: github\n    repository: owner/trpg\n    path: ${unmapped.trpg}\n`);
  const refused = run(unmapped.core, ['--yes']);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain('Notebook lore names owner/lore, which mygitnotes.server.yaml maps to no worktree');
  expect(fs.existsSync(path.join(unmapped.trpg, '.mygitnotes.yaml'))).toBe(false);

  for (const [lore, message] of [[loreManifest + '  - id: lore\n    title: Other lore\n    root: notes/other\n', 'already has a different notebook lore'], [loreManifest.replace('root: notes/books', 'root: notes/lore/books'), 'Notebook roots overlap']]) {
    const { home, trpg, lore: loreRoot, core } = fixture();
    fs.writeFileSync(path.join(loreRoot, '.mygitnotes.yaml'), lore);
    git(loreRoot, ['commit', '-am', 'edit']);
    const result = run(core, ['--yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
    expect(fs.existsSync(path.join(trpg, '.mygitnotes.yaml'))).toBe(false);
    expect(read(home, '.mygitnotes.yaml')).toBe(homeManifest);
    expect(commits(loreRoot)).toHaveLength(2);
  }
}, 60000);

it('asks for the schema 3 migration first when a manifest it touches is older', async () => {
  for (const older of ['home', 'lore'] as const) {
    const repositories = fixture();
    const root = repositories[older];
    fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), read(root, '.mygitnotes.yaml').replace('schema_version: 3', 'schema_version: 2'));
    git(root, ['commit', '-am', 'schema 2']);
    const refused = run(repositories.core, ['--yes']);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`${path.join(root, '.mygitnotes.yaml')} uses schema_version 2. Run pnpm migrate-workspace from a Core checkout at fd0fd42`);
    expect(fs.existsSync(path.join(repositories.trpg, '.mygitnotes.yaml'))).toBe(false);
  }
}, 60000);

it('names the default notebook that changes when the one the converting manifest opens at moves away', async () => {
  const { home, core } = fixture();
  fs.writeFileSync(path.join(home, '.mygitnotes.yaml'), homeManifest.replace('default_notebook: life', 'default_notebook: trpg'));
  git(home, ['commit', '-am', 'open at trpg']);
  const shown = run(core);
  expect(shown.stdout).toContain('default_notebook changes from trpg, which moves to another repository, to life.');
  expect(run(core, ['--yes']).status).toBe(0);
  expect(YAML.parse(read(home, '.mygitnotes.yaml')).workspace.default_notebook).toBe('life');
}, 60000);

it('stops when every notebook would leave the converting manifest, unless asked to delete it', async () => {
  const { trpg, lore, core } = fixture();
  // A mapped repository whose manifest only declares notebooks of other repositories.
  const hub = worktree({ '.mygitnotes.yaml': 'schema_version: 3\nworkspace:\n  title: Hub\n  default_notebook: trpg\nnotebooks:\n  - id: trpg\n    title: TRPG\n    root: notes/life\n    source: { type: github, repository: owner/trpg }\n' });
  fs.appendFileSync(path.join(core, 'mygitnotes.server.yaml'), `  - type: github\n    repository: owner/hub\n    path: ${hub}\n`);
  const stopped = run(core, ['--workspace', hub, '--yes']);
  expect(stopped.status).toBe(1);
  expect(stopped.stderr).toContain('pnpm convert-sources --remove-emptied');
  expect(fs.existsSync(path.join(trpg, '.mygitnotes.yaml'))).toBe(false);

  const removed = run(core, ['--workspace', hub, '--yes', '--remove-emptied']);
  expect(removed.stderr).toBe('');
  expect(removed.status).toBe(0);
  expect(fs.existsSync(path.join(hub, '.mygitnotes.yaml'))).toBe(false);
  expect(commits(hub)).toHaveLength(2);
  expect(git(hub, ['status', '--porcelain'])).toBe('');
  expect(YAML.parse(read(trpg, '.mygitnotes.yaml')).notebooks.map((notebook: { id: string; }) => notebook.id)).toEqual(['trpg']);
  const server = read(core, 'mygitnotes.server.yaml');
  expect(server).not.toContain('owner/hub');
  expect(server).toContain('# Notebook repositories checked out beside the workspace.');
  expect(server).toContain(lore);
}, 60000);

it("refuses to delete an emptied manifest of the deployment's own source", async () => {
  const { home, trpg, core } = fixture();
  fs.writeFileSync(path.join(home, '.mygitnotes.yaml'), 'schema_version: 3\nworkspace:\n  title: Home\n  default_notebook: trpg\nnotebooks:\n  - id: trpg\n    title: TRPG\n    root: notes/life\n    source: { type: github, repository: owner/trpg }\n');
  git(home, ['commit', '-am', 'only trpg']);
  const refused = run(core, ['--yes', '--remove-emptied']);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain("is this deployment's own source");
  expect(refused.stderr).toContain('MYGITNOTES_LOCAL_PATH');
  expect(fs.existsSync(path.join(trpg, '.mygitnotes.yaml'))).toBe(false);
  expect(fs.existsSync(path.join(home, '.mygitnotes.yaml'))).toBe(true);
}, 60000);

it('finishes on a second run after a commit fails part way, skipping notebooks already moved', async () => {
  const { home, trpg, lore, core } = fixture();
  // The second repository refuses the commit.
  const hook = path.join(lore, '.git/hooks/pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\necho injected failure >&2\nexit 1\n', { mode: 0o755 });
  const failed = run(core, ['--yes']);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain(`${lore}: .mygitnotes.yaml was written but not committed`);
  expect(commits(trpg)).toHaveLength(2);
  expect(read(home, '.mygitnotes.yaml')).toBe(homeManifest);
  const command = failed.stderr.split('\n').find(line => line.trim().startsWith('git -C'))!;
  fs.rmSync(hook);
  execFileSync('/bin/sh', ['-c', command], { stdio: 'pipe' });

  const finished = run(core, ['--yes']);
  expect(finished.stderr).toBe('');
  expect(finished.status).toBe(0);
  expect(finished.stdout).toContain('already has trpg from an earlier run');
  for (const root of [home, trpg, lore]) expect(commits(root)).toHaveLength(2);
  expect(YAML.parse(read(home, '.mygitnotes.yaml')).notebooks.map((notebook: { id: string; }) => notebook.id)).toEqual(['life']);
}, 60000);

it('refuses a second run while a manifest an earlier run wrote is still uncommitted, and names the command that commits it', async () => {
  const { home, lore, core } = fixture();
  const hook = path.join(lore, '.git/hooks/pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  expect(run(core, ['--yes']).status).toBe(1);
  fs.rmSync(hook);
  const refused = run(core, ['--yes']);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain(`${lore} has uncommitted changes in .mygitnotes.yaml, which an earlier pnpm convert-sources wrote with notebook(s) lore. Commit it`);
  // The converting repository is not committed while a target still lacks its commit.
  expect(read(home, '.mygitnotes.yaml')).toBe(homeManifest);
  expect(commits(home)).toEqual(['fixture']);
  const command = refused.stderr.split('\n').find(line => line.trim().startsWith('git -C'))!;
  execFileSync('/bin/sh', ['-c', command], { stdio: 'pipe' });
  expect(commits(lore)[0]).toBe("chore(workspace): take notebook(s) lore into this repository's manifest");
  const finished = run(core, ['--yes']);
  expect(finished.status).toBe(0);
  expect(commits(home)).toHaveLength(2);
}, 60000);

it('orders repositories so each keeps the alias it had from the order the home manifest named them', async () => {
  const home = worktree({ '.mygitnotes.yaml': homeManifest.replace('repository: owner/trpg', 'repository: alpha/notes').replace('repository: owner/lore', 'repository: beta/notes'), 'notes/life/a.md': '# A\n' });
  const alpha = worktree({ 'notes/life/b.md': '# B\n' });
  const beta = worktree({ 'notes/lore/c.md': '# C\n' });
  const gamma = worktree({ '.mygitnotes.yaml': loreManifest.replace('schema_version: 3', 'schema_version: 4') });
  // Listed in another order than the manifest names them, with a repository no notebook names in between.
  const core = checkout(home, { 'beta/notes': beta, 'gamma/notes': gamma, 'alpha/notes': alpha });
  const shown = run(core);
  expect(shown.stdout).toContain('lists repositories as alpha/notes, beta/notes, gamma/notes');
  expect(shown.stdout).toMatch(/Aliases after the conversion: [^,]+, notes \(github:alpha\/notes@main\), notes-2 \(github:beta\/notes@main\), notes-3 \(github:gamma\/notes@main\)\./);
  expect(read(core, 'mygitnotes.server.yaml')).toMatch(/beta\/notes[\s\S]*gamma\/notes[\s\S]*alpha\/notes/);
  const converted = run(core, ['--yes']);
  expect(converted.status).toBe(0);
  const server = read(core, 'mygitnotes.server.yaml');
  expect(server).toContain('# Notebook repositories checked out beside the workspace.');
  const settings = await deploymentConfigSource(core, { MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: home }).settings({ headers: {} });
  expect(settings.members.slice(1).map(member => [member.alias, member.ref.id])).toEqual([['notes', 'github:alpha/notes@main'], ['notes-2', 'github:beta/notes@main'], ['notes-3', 'github:gamma/notes@main']]);
}, 60000);
