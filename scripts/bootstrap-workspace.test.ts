import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseNoteContent, parseWorkspaceConfig, resolveNoteStatuses } from '../packages/core/src/index.js';

const product = process.cwd();
let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
const bootstrap = (...args: string[]) => execFileSync(process.execPath, [path.join(product, 'node_modules/tsx/dist/cli.mjs'), path.join(product, 'scripts/bootstrap-workspace.ts'), ...args], { cwd: root, stdio: 'pipe' });
const write = (name: string, content: string) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
const files = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-notes-bootstrap-'));
  write('packages/core/.keep', '');
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write('examples/workspace-agent-system/AGENTS.md', '# 工作區指引\n');
  write('examples/workspace-agent-system/.agents/skills/workspace/SKILL.md', '# 工作區技能\n');
  fs.cpSync(path.join(product, 'examples/demo-workspace'), path.join(root, 'examples/demo-workspace'), { recursive: true });
  git('init', '-b', 'core'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-m', 'product fixture');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('canonical starter workspace CLI', () => {
  it('initializes main from Core examples in one commit and preserves edits on rerun', () => {
    bootstrap();
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
    expect(git('ls-tree', '-r', '--name-only', 'core', '--', 'notes', '.mygitnotes.yaml')).toBe('');
    expect(git('ls-tree', '-r', '--name-only', 'core', '--', 'AGENTS.md', '.agents', '.codex')).toBe('');
    expect(git('ls-files', '--', 'AGENTS.md', '.agents')).toContain('AGENTS.md');
    expect(git('ls-files', '--', '.agents')).toContain('.agents/skills/workspace/SKILL.md');
    const template = path.join(root, 'examples/demo-workspace');
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
    bootstrap('--no-examples');
    expect(git('branch', '--show-current')).toBe('main');
    expect(git('rev-list', '--count', 'HEAD')).toBe('2');
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
    write('.mygitnotes.yaml', manifest); write('notes/personal/mine.md', '# Mine');
    bootstrap();
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toBe(manifest);
    expect(fs.existsSync(path.join(root, 'notes/.mygitnotes.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'notes/example'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'notes/personal/mine.md'), 'utf8')).toBe('# Mine');
  });

  it('respects an existing legacy-named root manifest and does not create a second manifest', () => {
    const manifest = 'schema_version: 1\nworkspace:\n  title: Legacy\n  default_notebook: personal\nnotebooks:\n  - id: personal\n    title: Personal\n    root: notes/personal\n';
    write('.github-notes.yaml', manifest); write('notes/personal/mine.md', '# Mine');
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
      fs.symlinkSync(outside, path.join(root, 'notes'));
      expect(() => bootstrap()).toThrow();
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('uses exactly the default statuses and valid relative tutorial links', () => {
    const template = path.join(root, 'examples/demo-workspace');
    const config = parseWorkspaceConfig(fs.readFileSync(path.join(template, '.mygitnotes.yaml'), 'utf8'));
    expect(config.notebooks[0].statuses).toBeUndefined();
    const seen = new Set<string>();
    for (const file of files(path.join(template, 'notes')).filter(file => file.endsWith('.md'))) {
      const raw = fs.readFileSync(file, 'utf8'); const note = parseNoteContent(raw);
      seen.add(String(note.metadata.status));
      if (note.metadata.status === 'archived') expect(note.metadata.hiden).toBe(true);
      for (const match of raw.matchAll(/\]\(([^)]+\.md)\)/g)) expect(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${file}: ${match[1]}`).toBe(true);
    }
    expect([...seen].sort()).toEqual(resolveNoteStatuses(config.notebooks[0]).sort());
  });
});
