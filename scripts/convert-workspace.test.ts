import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-convert-')); dirs.push(dir); return dir; };
const gitIn = (cwd: string) => (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (root: string, files: Record<string, string>) => { for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); } };
const convert = (cwd: string) => execFileSync(process.execPath, [path.resolve('scripts/convert-workspace.mjs')], { cwd, encoding: 'utf8', stdio: 'pipe' });

function forkWorkspace() {
  const upstream = temp();
  const up = gitIn(upstream);
  up('init', '-b', 'core'); up('config', 'user.name', 'Core'); up('config', 'user.email', 'core@example.com');
  write(upstream, {
    '.github/vercel-sparse-paths.txt': '# list\n.github/vercel-sparse-paths.txt\napps\npackage.json\npnpm-workspace.yaml\nscripts/lib\n',
    '.github/workflows/deploy-vercel-sparse.yml': 'name: deploy\n', '.gitignore': 'node_modules/\n',
    'apps/web/a.ts': 'export {};\n', 'package.json': '{}\n', 'pnpm-workspace.yaml': 'packages: []\n', 'scripts/lib/x.mjs': '', 'scripts/tool.mjs': '',
    'docs/CONTEXT.md': '# Core terms\n', 'docs/agent/index.md': '# Product\n', 'README.md': '# Core\n', 'examples/demo.md': '# Demo\n',
  });
  up('add', '.'); up('commit', '-m', 'core');
  const workspace = temp();
  const git = gitIn(workspace);
  execFileSync('git', ['clone', '-q', '-b', 'core', upstream, workspace], { stdio: 'pipe' });
  git('config', 'user.name', 'User'); git('config', 'user.email', 'user@example.com');
  git('remote', 'rename', 'origin', 'upstream'); git('checkout', '-q', '-b', 'main');
  write(workspace, {
    '.mygitnotes.yaml': 'schema_version: 1\n', 'notes/a/n.md': '# Note\n', 'AGENTS.md': '# Rules\n', '.agents/skills/s/SKILL.md': '# Skill\n',
    'docs/specs/plan.md': '# Plan\n', 'docs/CONTEXT.md': '# Core terms\n# Workspace terms\n', '.gitignore': 'node_modules/\nblog/.vercel\n',
    '.github/workflows/blog-ci.yml': 'name: blog\n', 'blog/index.md': '# Blog\n', 'apps/web/local-patch.ts': 'export {};\n', 'scripts/tool.mjs': 'patched\n',
  });
  git('add', '.'); git('commit', '-m', 'workspace');
  // Core moves on after the last merge; files main still has from the merged Core must go too.
  write(upstream, { 'README.md': '# Core v2\n', 'docs/agent/index.md': '# Product v2\n' });
  up('commit', '-am', 'core v2');
  return { workspace, git };
}

it('removes product files from main in one commit and keeps workspace-owned files', () => {
  const { workspace, git } = forkWorkspace();
  const before = git('rev-parse', 'HEAD');
  const output = convert(workspace);
  expect(git('rev-parse', 'HEAD~1')).toBe(before);
  expect(git('ls-files').split('\n').sort()).toEqual([
    '.agents/skills/s/SKILL.md', '.github/workflows/blog-ci.yml', '.gitignore', '.mygitnotes.yaml', 'AGENTS.md',
    'blog/index.md', 'docs/CONTEXT.md', 'docs/specs/plan.md', 'notes/a/n.md', 'scripts/tool.mjs',
  ]);
  expect(output).toMatch(/Kept workspace-owned files inside Core namespaces:[\s\S]*docs\/specs\/plan\.md/);
  expect(git('status', '--porcelain')).toBe('');
  expect(() => convert(workspace)).toThrow(/already holds only workspace content/);
}, 20000);

it('refuses a dirty tree or a branch other than main', () => {
  const { workspace, git } = forkWorkspace();
  const head = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(workspace, 'notes/a/n.md'), 'dirty');
  expect(() => convert(workspace)).toThrow(/Commit or clean/);
  git('checkout', '--', '.'); git('checkout', '-q', 'core');
  expect(() => convert(workspace)).toThrow(/branch 'main'/);
  expect(git('rev-parse', 'main')).toBe(head);
}, 20000);
