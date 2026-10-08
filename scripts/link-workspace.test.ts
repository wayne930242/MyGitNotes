import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { loadEnvDefaults, loadSourceConfig, SUPPORTED_SCHEMA_VERSION } from '../packages/core/src/index.js';

const product = process.cwd();
let core: string;
let workspace: string;
let env: NodeJS.ProcessEnv;
const manifest = (version = SUPPORTED_SCHEMA_VERSION) => `schema_version: ${version}\nworkspace:\n  title: Existing\n  default_notebook: personal\nnotebooks:\n  - id: personal\n    title: Personal\n    root: notes\n`;
const run = (...args: string[]) => spawnSync('pnpm', args, { cwd: core, env, encoding: 'utf8', timeout: 15_000 });
const config = () => fs.readFileSync(path.join(core, '.env'), 'utf8');

beforeEach(() => {
  // The script records real paths, and macOS's temporary directory is behind the /var symlink.
  core = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-link-')));
  workspace = path.join(core, 'existing 筆記 # "quoted"');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, '.mygitnotes.yaml'), manifest());
  fs.mkdirSync(path.join(workspace, 'notes'));
  fs.writeFileSync(path.join(workspace, 'notes/note.md'), '# Leave me unchanged\n');
  for (const directory of ['scripts', 'packages', 'node_modules']) fs.symlinkSync(path.join(product, directory), path.join(core, directory), 'dir');
  fs.copyFileSync(path.join(product, 'package.json'), path.join(core, 'package.json'));
  // Fixtures reuse installed tools; pnpm must not reinstall through the node_modules symlink.
  fs.writeFileSync(path.join(core, 'pnpm-workspace.yaml'), 'packages: []\nverifyDepsBeforeRun: false\n');
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(MYGITNOTES_|GITHUB_NOTES_|REPO_ROOT$|VERCEL$)/.test(key)));
});
afterEach(() => fs.rmSync(core, { recursive: true, force: true }));

describe('link-workspace CLI', () => {
  it('persistently selects an existing workspace without changing its content or Git configuration', () => {
    for (const cwd of [core, workspace]) {
      expect(spawnSync('git', ['init', '-q'], { cwd }).status).toBe(0);
      expect(spawnSync('git', ['remote', 'add', 'origin', 'https://example.com/notes.git'], { cwd }).status).toBe(0);
    }
    const snapshot = (cwd: string) => ['remote -v', 'worktree list --porcelain', 'status --porcelain'].map(command => spawnSync('git', command.split(' '), { cwd, encoding: 'utf8' }).stdout);
    const beforeWorkspace = snapshot(workspace);
    const beforeCore = snapshot(core).slice(0, 2);
    const result = run('link-workspace', path.relative(core, workspace));
    expect(result.status, result.stderr).toBe(0);
    const persisted = {};
    loadEnvDefaults(path.join(core, '.env'), persisted);
    expect(loadSourceConfig(core, persisted)).toEqual({ type: 'local', path: workspace });
    expect(snapshot(workspace)).toEqual(beforeWorkspace);
    expect(snapshot(core).slice(0, 2)).toEqual(beforeCore);
    expect(fs.readFileSync(path.join(workspace, '.mygitnotes.yaml'), 'utf8')).toBe(manifest());
    expect(fs.readFileSync(path.join(workspace, 'notes/note.md'), 'utf8')).toBe('# Leave me unchanged\n');
    const once = config();
    expect(run('link-workspace', workspace).status).toBe(0);
    expect(config()).toBe(once);
  });

  it('preserves unrelated multiline values and overrides duplicate/exported assignments', () => {
    const previous = '# deployment\nexport MYGITNOTES_SOURCE = github\nMYGITNOTES_SOURCE=gitlab\nexport MYGITNOTES_LOCAL_PATH="old path"\nMYGITNOTES_LOCAL_PATH=other\nMULTILINE="first\nMYGITNOTES_SOURCE=inside-value\nlast"\nOTHER=keep # comment\n';
    fs.writeFileSync(path.join(core, '.env'), previous);
    expect(run('link-workspace', workspace).status).toBe(0);
    expect(config().startsWith(previous)).toBe(true);
    expect(parseEnv(config())).toEqual({ ...parseEnv(previous), MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: workspace });
  });

  it.each([false, true])('repairs stale REPO_ROOT when canonical keys already match: %s', canonicalMatches => {
    const previous = `MYGITNOTES_SOURCE=${canonicalMatches ? 'local' : 'github'}\nMYGITNOTES_LOCAL_PATH='${canonicalMatches ? workspace : 'old-path'}'\nREPO_ROOT=older-path\nexport REPO_ROOT='missing-old-workspace'\nOTHER="keep\nREPO_ROOT=inside-value"\n`;
    fs.writeFileSync(path.join(core, '.env'), previous);
    const check = (shell = env) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-dev-workspace.ts'], { cwd: core, env: shell, encoding: 'utf8', timeout: 15_000 });
    expect(check().status).not.toBe(0);
    expect(run('link-workspace', workspace).status).toBe(0);
    const linked = config();
    expect(linked.startsWith(previous)).toBe(true);
    expect(parseEnv(linked)).toEqual({ ...parseEnv(previous), MYGITNOTES_SOURCE: 'local', MYGITNOTES_LOCAL_PATH: workspace, REPO_ROOT: workspace });
    const result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(run('link-workspace', workspace).status).toBe(0);
    expect(config()).toBe(linked);
    const overridden = check({ ...env, REPO_ROOT: path.join(core, 'shell-override-missing') });
    expect(overridden.status).not.toBe(0);
    expect(overridden.stderr).toContain('shell-override-missing');
    expect(config()).toBe(linked);
  });

  it.each(['', 'REPO_ROOT=\n'])('does not introduce REPO_ROOT when absent or empty: %j', previous => {
    fs.writeFileSync(path.join(core, '.env'), previous);
    expect(run('link-workspace', workspace).status).toBe(0);
    const linked = config();
    expect(parseEnv(linked).REPO_ROOT).toBe(parseEnv(previous).REPO_ROOT);
    expect(run('link-workspace', workspace).status).toBe(0);
    expect(config()).toBe(linked);
  });

  it('refuses an unsafe dotenv update without changing the file', () => {
    const previous = "OTHER='unterminated";
    fs.writeFileSync(path.join(core, '.env'), previous);
    const result = run('link-workspace', workspace);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot safely update .env');
    expect(config()).toBe(previous);
  });

  it('accepts a legacy notes manifest and leaves server configuration unchanged', () => {
    fs.renameSync(path.join(workspace, '.mygitnotes.yaml'), path.join(workspace, 'notes/.github-notes.yaml'));
    const server = 'source:\n  type: github\n  repository: owner/notes\n  branch: main\n';
    fs.writeFileSync(path.join(core, 'mygitnotes.server.yaml'), server);
    expect(run('link-workspace', workspace).status).toBe(0);
    expect(loadSourceConfig(core, parseEnv(config()))).toEqual({ type: 'local', path: workspace });
    expect(fs.readFileSync(path.join(core, 'mygitnotes.server.yaml'), 'utf8')).toBe(server);
  });

  it.each(['missing', 'file', 'no-manifest', 'malformed', 'invalid', 'old', 'new'])('refuses %s workspace without mutating configuration', kind => {
    let target = workspace;
    if (kind === 'missing') target = path.join(core, 'absent');
    if (kind === 'file') target = path.join(workspace, 'notes/note.md');
    if (kind === 'no-manifest') fs.unlinkSync(path.join(workspace, '.mygitnotes.yaml'));
    if (kind === 'malformed') fs.writeFileSync(path.join(workspace, '.mygitnotes.yaml'), '[');
    if (kind === 'invalid') fs.writeFileSync(path.join(workspace, '.mygitnotes.yaml'), `schema_version: ${SUPPORTED_SCHEMA_VERSION}\nnotebooks: invalid\n`);
    if (kind === 'old' || kind === 'new') fs.writeFileSync(path.join(workspace, '.mygitnotes.yaml'), manifest(SUPPORTED_SCHEMA_VERSION + (kind === 'old' ? -1 : 1)));
    const previous = 'OTHER=preserved\nMYGITNOTES_SOURCE=github\n';
    fs.writeFileSync(path.join(core, '.env'), previous);
    expect(run('link-workspace', target).status).not.toBe(0);
    expect(config()).toBe(previous);
    fs.unlinkSync(path.join(core, '.env'));
    expect(run('link-workspace', target).status).not.toBe(0);
    expect(fs.existsSync(path.join(core, '.env'))).toBe(false);
  });

  it('rejects missing or extra arguments without creating configuration', () => {
    for (const args of [[], [workspace, 'extra']]) {
      const result = run('link-workspace', ...args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Usage: pnpm link-workspace <path>');
      expect(fs.existsSync(path.join(core, '.env'))).toBe(false);
    }
  });

  it.each(['dev', 'dev:remote'])('%s reports actionable guidance before starting services', command => {
    for (const previous of ['', 'MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=absent\n']) {
      fs.writeFileSync(path.join(core, '.env'), previous);
      const result = run(command);
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('pnpm link-workspace <path>');
      expect(result.stderr).not.toContain('tailscale is not installed');
      expect(config()).toBe(previous);
    }
  });
});
