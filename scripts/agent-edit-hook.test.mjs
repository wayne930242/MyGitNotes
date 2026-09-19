import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editedPaths } from './agent-edit-hook.mjs';
import { root } from './source-tools.mjs';

describe('edit hook payloads', () => {
  let fixture;
  const write = (name, content) => {
    const file = path.join(fixture, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    return file;
  };
  const invoke = event => {
    const result = spawnSync(process.execPath, [path.join(fixture, 'scripts/agent-edit-hook.mjs')], { cwd: fixture, input: JSON.stringify({ cwd: fixture, hook_event_name: 'PostToolUse', ...event }), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    return result.stdout;
  };
  beforeAll(() => {
    fixture = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'edit-hooks-test-')));
    execFileSync('git', ['init', '--quiet', fixture]);
    for (const file of ['scripts/source-tools.mjs', 'scripts/agent-edit-hook.mjs', 'dprint.json', '.oxlintrc.json']) {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      cpSync(path.join(root, file), path.join(fixture, file));
    }
    symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    write('.gitignore', '.cache/\nnode_modules/\n');
    write('apps/web/package.json', '{"type":"module"}');
    write('apps/web/tsconfig.json', '{"compilerOptions":{"target":"es2022","module":"esnext","noEmit":true,"strict":true},"include":["src/**/*.ts"]}');
  });
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  it('extracts Add, Update and Move destinations and skips Delete', () => {
    expect(editedPaths({ hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Add File: scripts/a.mjs\n+x\n*** Update File: scripts/b.mjs\n@@\n-x\n+y\n*** Update File: scripts/old.mjs\n*** Move to: scripts/new.mjs\n*** Delete File: scripts/deleted.mjs\n*** End Patch' } })).toEqual(['scripts/a.mjs', 'scripts/b.mjs', 'scripts/new.mjs']);
  });

  it('applies safe fixes and formatting and adds type diagnostics without replacing tool output', () => {
    const file = write('apps/web/src/probe.ts', 'export const answer:number = "bad";\nexport const regex = /\\a/;\n');
    const output = JSON.parse(invoke({ tool_name: 'Write', tool_input: { file_path: file }, tool_response: { type: 'create', filePath: file } }));
    expect(output.hookSpecificOutput.additionalContext).toContain('TS2322');
    expect(output.decision).toBeUndefined();
    expect(readFileSync(file, 'utf8')).toContain("answer: number = 'bad'");
    expect(readFileSync(file, 'utf8')).toContain('/a/');
    writeFileSync(file, 'export const answer:number = 1;\nexport const regex = /a/;\n');
    expect(invoke({ tool_name: 'Edit', tool_input: { file_path: file } })).toBe('');
  });

  it('runs real patch payloads for Add, Update, Move and Delete without package checks for scripts', () => {
    for (const operation of ['Add File', 'Update File', 'Move to']) {
      const file = write('scripts/probe.mjs', 'export const regex=/\\q/;\n');
      const command = `*** Begin Patch\n${operation === 'Move to' ? '*** Update File: scripts/old.mjs\n' : ''}*** ${operation}: scripts/probe.mjs\n*** End Patch`;
      expect(invoke({ tool_name: 'apply_patch', tool_input: { command }, tool_response: 'Success. Updated the following files.' })).toBe('');
      expect(readFileSync(file, 'utf8')).toBe('export const regex = /q/;\n');
    }
    const untouched = write('scripts/deleted.mjs', 'export const regex=/[c]/;\n');
    expect(invoke({ tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Delete File: scripts/deleted.mjs\n*** End Patch' } })).toBe('');
    expect(readFileSync(untouched, 'utf8')).toContain('/[c]/');
  });

  it('ignores user files, generated files, symlinks and unrelated events', () => {
    for (const name of ['notes/probe.ts', 'scratch/probe.ts', 'probe.ts', 'apps/web/dist/probe.ts', 'examples/probe.ts', 'scripts/probe.md']) {
      const file = write(name, 'unformatted=1');
      expect(invoke({ tool_name: 'Write', tool_input: { file_path: file } })).toBe('');
      expect(readFileSync(file, 'utf8')).toBe('unformatted=1');
    }
    symlinkSync(path.join(fixture, 'notes/probe.ts'), path.join(fixture, 'apps/web/src/link.ts'));
    expect(invoke({ tool_name: 'Write', tool_input: { file_path: path.join(fixture, 'apps/web/src/link.ts') } })).toBe('');
    rmSync(path.join(fixture, 'apps/web/src/link.ts'));
    expect(invoke({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(fixture, 'apps/web/src/probe.ts') } })).toBe('');
  });

  it('formats scoped CSS without trying to parse lint JSON for it', () => {
    const file = write('apps/web/src/components/split-styles.css', '.probe {\n color: red;\n padding: 0;\n}\n');
    expect(invoke({ tool_name: 'Write', tool_input: { file_path: file } })).toBe('');
    expect(readFileSync(file, 'utf8')).toBe('.probe { color: red; padding: 0; }\n');
  });

  it('reports remaining lint diagnostics as model context', () => {
    const file = write('scripts/bad.mjs', 'export function bad() { return 1; return 2; }\n');
    expect(JSON.parse(invoke({ tool_name: 'MultiEdit', tool_input: { file_path: file } })).hookSpecificOutput.additionalContext).toContain('no-unreachable');
  });
});
