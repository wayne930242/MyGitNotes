import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseNoteContent, parseWorkspaceConfig, resolveNoteStatuses } from '../packages/core/src/index.js';

const product = process.cwd();
let core: string;
let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const coreGit = (...args: string[]) => execFileSync('git', args, { cwd: core, encoding: 'utf8', stdio: 'pipe' }).trim();
const bootstrap = (...args: string[]) => execFileSync(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/bootstrap-workspace.ts'), ...args], { cwd: core, stdio: 'pipe' });
const write = (name: string, content: string, base = root) => {
  const target = path.join(base, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const files = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
beforeEach(() => {
  core = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-bootstrap-'));
  root = path.join(core, 'workspace');
  write('.gitignore', fs.readFileSync(path.join(product, '.gitignore'), 'utf8'), core);
  write('packages/core/.keep', '', core);
  write('packages/core/assets/mygitnotes-core-sync.yml', fs.readFileSync(path.join(product, 'packages/core/assets/mygitnotes-core-sync.yml'), 'utf8'), core);
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n', core);
  write('examples/workspace-agent-system/AGENTS.md', '# 工作區指引\n', core);
  write('examples/workspace-agent-system/.agents/skills/workspace/SKILL.md', '# 工作區技能\n', core);
  fs.cpSync(path.join(product, 'examples/demo-workspace'), path.join(core, 'examples/demo-workspace'), { recursive: true });
  coreGit('init', '-b', 'core');
  coreGit('config', 'user.name', 'Test');
  coreGit('config', 'user.email', 'test@example.com');
  coreGit('add', '.');
  coreGit('commit', '-m', 'product fixture');
});
afterEach(() => {
  for (const dir of [core, root]) fs.rmSync(dir, { recursive: true, force: true });
});
/** A content-only main that already exists, as a converted workspace or a clone of one has it. */
const existingMain = (files: Record<string, string>) => {
  coreGit('worktree', 'add', '--orphan', '-b', 'main', root);
  for (const [file, content] of Object.entries(files)) write(file, content);
  git('add', '.');
  git('commit', '-m', 'existing workspace');
};

describe('canonical starter workspace CLI', () => {
  it('creates an orphan content-only main worktree from Core examples in one commit and preserves edits on rerun', () => {
    const output = bootstrap().toString();
    expect(fs.readFileSync(path.join(core, '.env'), 'utf8')).toBe(`MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=workspace\n`);
    expect(coreGit('status', '--porcelain')).toBe('');
    expect(coreGit('branch', '--show-current')).toBe('core');
    expect(fs.readFileSync(path.join(root, '.github/workflows/mygitnotes-core-sync.yml'), 'utf8')).toBe(fs.readFileSync(path.join(product, 'packages/core/assets/mygitnotes-core-sync.yml'), 'utf8'));
    expect(git('ls-files', '--', 'pnpm-workspace.yaml', 'packages', 'examples')).toBe('');
    expect(git('rev-list', '--max-parents=0', 'HEAD')).toBe(git('rev-parse', 'HEAD'));
    for (const step of ['deploy-vercel-sparse.yml', 'Git integration', 'gh variable set VERCEL_ORG_ID', 'gh variable set VERCEL_PROJECT_ID', 'gh secret set VERCEL_TOKEN', 'MYGITNOTES_VERCEL_DEPLOY --body git-integration']) expect(output).toContain(step);
    expect(output).not.toMatch(/gh secret set VERCEL_TOKEN --body/);
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('rev-list', '--count', 'HEAD')).toBe('1');
    expect(git('ls-tree', '-r', '--name-only', 'core', '--', 'notes', '.mygitnotes.yaml')).toBe('');
    expect(git('ls-tree', '-r', '--name-only', 'core', '--', 'AGENTS.md', '.agents', '.codex')).toBe('');
    expect(git('ls-files', '--', 'AGENTS.md', '.agents')).toContain('AGENTS.md');
    expect(git('ls-files', '--', '.agents')).toContain('.agents/skills/workspace/SKILL.md');
    const template = path.join(core, 'examples/demo-workspace');
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toBe(fs.readFileSync(path.join(template, '.mygitnotes.yaml'), 'utf8'));
    for (const source of files(path.join(template, 'notes'))) expect(fs.readFileSync(path.join(root, path.relative(template, source)))).toEqual(fs.readFileSync(source));
    const head = git('rev-parse', 'HEAD');
    write('notes/example/welcome.md', '# My own welcome\n');
    write('AGENTS.md', '# 自訂指引\n');
    write('.agents/skills/workspace/SKILL.md', '# 自訂技能\n');
    bootstrap();
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('# 自訂指引\n');
    expect(fs.readFileSync(path.join(root, '.agents/skills/workspace/SKILL.md'), 'utf8')).toBe('# 自訂技能\n');
    expect(fs.readFileSync(path.join(root, 'notes/example/welcome.md'), 'utf8')).toBe('# My own welcome\n');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(fs.existsSync(path.join(root, 'notes/.mygitnotes.yaml'))).toBe(false);
  });

  it('initializes an empty workspace without examples when --no-examples is passed', () => {
    root = path.join(core, '..', `${path.basename(core)}-custom`);
    bootstrap('--no-examples', '--path', root);
    expect(fs.readFileSync(path.join(core, '.env'), 'utf8')).toBe(`MYGITNOTES_SOURCE=local\nMYGITNOTES_LOCAL_PATH=../${path.basename(root)}\n`);
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('rev-list', '--count', 'HEAD')).toBe('1');
    const config = parseWorkspaceConfig(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8'));
    expect(config.notebooks.map(notebook => notebook.id)).toEqual(['personal']);
    expect(config.workspace.default_notebook).toBe('personal');
    expect(fs.existsSync(path.join(root, 'notes/example'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/learning'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.github-notes-screen.yaml'))).toBe(false);
    expect(git('ls-files', '--', 'AGENTS.md', '.agents')).toContain('.agents/skills/workspace/SKILL.md');
  });

  it('respects an existing root manifest and does not add an unconfigured notebook', () => {
    const manifest = 'schema_version: 1\nworkspace:\n  title: Personal\n  default_notebook: personal\nnotebooks:\n  - id: personal\n    title: Personal\n    root: notes/personal\n';
    existingMain({ '.mygitnotes.yaml': manifest, 'notes/personal/mine.md': '# Mine' });
    fs.rmSync(root, { recursive: true, force: true });
    coreGit('worktree', 'prune');
    bootstrap();
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toBe(manifest);
    expect(fs.existsSync(path.join(root, 'notes/.mygitnotes.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/example'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes/personal/mine.md'), 'utf8')).toBe('# Mine');
  });

  it('respects an existing legacy-named root manifest and does not create a second manifest', () => {
    const manifest = 'schema_version: 1\nworkspace:\n  title: Legacy\n  default_notebook: personal\nnotebooks:\n  - id: personal\n    title: Personal\n    root: notes/personal\n';
    existingMain({ '.github-notes.yaml': manifest, 'notes/personal/mine.md': '# Mine' });
    bootstrap();
    expect(fs.readFileSync(path.join(root, '.github-notes.yaml'), 'utf8')).toBe(manifest);
    expect(fs.existsSync(path.join(root, '.mygitnotes.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/.mygitnotes.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/example'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes/personal/mine.md'), 'utf8')).toBe('# Mine');
  });

  it('rejects a notes directory symlink that escapes the workspace', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-bootstrap-outside-'));
    try {
      coreGit('worktree', 'add', '--orphan', '-b', 'main', root);
      fs.symlinkSync(outside, path.join(root, 'notes'));
      expect(() => bootstrap()).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses a main that still carries the product', () => {
    coreGit('branch', 'main');
    expect(() => bootstrap()).toThrow(/pnpm convert-workspace/);
    coreGit('checkout', 'main');
    expect(() => bootstrap()).toThrow(/pnpm convert-workspace/);
    expect(fs.existsSync(root)).toBe(false);
  });

  it('tracks the remote main of a cloned workspace instead of creating an orphan', () => {
    existingMain({ '.mygitnotes.yaml': 'schema_version: 1\nworkspace:\n  title: Mine\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n', 'notes/a/mine.md': '# Mine\n' });
    const remoteHead = git('rev-parse', 'HEAD');
    coreGit('worktree', 'remove', root);
    coreGit('remote', 'add', 'origin', core);
    coreGit('update-ref', 'refs/remotes/origin/main', 'main');
    coreGit('branch', '-D', 'main');
    bootstrap();
    expect(git('merge-base', '--is-ancestor', remoteHead, 'HEAD')).toBe('');
    expect(git('rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main');
    expect(fs.readFileSync(path.join(root, 'notes/a/mine.md'), 'utf8')).toBe('# Mine\n');
  });

  it('renames a MyGitNotes origin to upstream so origin is free for the user repository', () => {
    coreGit('remote', 'add', 'origin', 'https://github.com/wayne930242/MyGitNotes.git');
    coreGit('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const output = bootstrap().toString();
    expect(coreGit('remote')).toBe('upstream');
    expect(coreGit('remote', 'get-url', 'upstream')).toBe('https://github.com/wayne930242/MyGitNotes.git');
    expect(git('rev-list', '--max-parents=0', 'HEAD')).toBe(git('rev-parse', 'HEAD'));
    expect(output).toContain('git remote add origin <your-repository-url>');
    coreGit('remote', 'add', 'origin', 'git@github.com:someone/notes.git');
    bootstrap();
    expect(coreGit('remote').split('\n').sort()).toEqual(['origin', 'upstream']);
  });

  it('adds a MyGitNotes upstream beside an origin that is the user repository', () => {
    coreGit('remote', 'add', 'origin', 'git@github.com:someone/notes.git');
    const output = bootstrap().toString();
    expect(coreGit('remote').split('\n').sort()).toEqual(['origin', 'upstream']);
    expect(coreGit('remote', 'get-url', 'origin')).toBe('git@github.com:someone/notes.git');
    expect(coreGit('config', '--get', 'remote.upstream.url')).toBe('https://github.com/wayne930242/MyGitNotes.git');
    expect(coreGit('config', '--get', 'remote.upstream.fetch')).toBe('+refs/heads/core:refs/remotes/upstream/core');
    expect(output).toContain("Added remote 'upstream'");
    expect(output).not.toContain('git remote add origin');
  });

  it('keeps an existing upstream remote', () => {
    coreGit('remote', 'add', 'upstream', 'git@github.com:someone/fork.git');
    bootstrap();
    expect(coreGit('remote')).toBe('upstream');
    expect(coreGit('remote', 'get-url', 'upstream')).toBe('git@github.com:someone/fork.git');
  });

  it('keeps unrelated .env settings when pointing at the workspace', () => {
    write('.env', 'GEMINI_API_KEY=x\nMYGITNOTES_LOCAL_PATH=.\n', core);
    bootstrap();
    expect(fs.readFileSync(path.join(core, '.env'), 'utf8')).toBe(`GEMINI_API_KEY=x\nMYGITNOTES_LOCAL_PATH=workspace\nMYGITNOTES_SOURCE=local\n`);
  });

  it('uses exactly the default statuses and valid relative tutorial links', () => {
    const template = path.join(core, 'examples/demo-workspace');
    const config = parseWorkspaceConfig(fs.readFileSync(path.join(template, '.mygitnotes.yaml'), 'utf8'));
    expect(config.notebooks[0].statuses).toBeUndefined();
    const seen = new Set<string>();
    for (const file of files(path.join(template, 'notes')).filter(file => file.endsWith('.md'))) {
      const raw = fs.readFileSync(file, 'utf8');
      const note = parseNoteContent(raw);
      seen.add(String(note.metadata.status));
      if (note.metadata.status === 'archived') expect(note.metadata.hiden).toBe(true);
      for (const match of raw.matchAll(/\]\(([^)]+\.md)\)/g)) expect(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${file}: ${match[1]}`).toBe(true);
    }
    expect([...seen].sort()).toEqual(resolveNoteStatuses(config.notebooks[0]).sort());
  });
});
