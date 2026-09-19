import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateWorkspace, assertWorkspaceCompatible, WorkspaceCompatibilityError, SUPPORTED_SCHEMA_VERSION } from '../src/workspace-migration.js';

const roots: string[] = [];
const workspace = (manifest: string, files: Record<string, string> = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-migration-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, '.mygitnotes.yaml'), manifest);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
};
const body = 'workspace:\n  title: Notes # keep comment\n  default_notebook: a\nnotebooks:\n  - id: a\n    title: A\n    root: notes/a\n';
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('workspace migration', () => {
  it('sets a missing schema_version while preserving the YAML document', () => {
    const root = workspace(body, { 'notes/a/n.md': '# N\n' });
    const result = migrateWorkspace(root);
    expect(result.migrated).toBe(true);
    const text = fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8');
    expect(text).toMatch(/^schema_version: 1$/m);
    expect(text).toContain('# keep comment');
    expect(result.notesMissingTimestamps).toBe(1);
  });

  it('leaves a current workspace untouched', () => {
    const root = workspace(`schema_version: 1\n${body}`, { 'notes/a/n.md': '---\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n# N\n' });
    const before = fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8');
    expect(migrateWorkspace(root)).toMatchObject({ migrated: false, notesMissingTimestamps: 0 });
    expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toBe(before);
  });

  it('fails fast on an older or newer schema_version', () => {
    expect(() => assertWorkspaceCompatible(workspace(body))).toThrow(/pnpm migrate-workspace/);
    expect(() => assertWorkspaceCompatible(workspace(`schema_version: ${SUPPORTED_SCHEMA_VERSION + 1}\n${body}`))).toThrow(WorkspaceCompatibilityError);
    expect(() => assertWorkspaceCompatible(workspace(`schema_version: ${SUPPORTED_SCHEMA_VERSION + 1}\n${body}`))).toThrow(/newer Core/);
    expect(() => assertWorkspaceCompatible(workspace(`schema_version: 1\n${body}`))).not.toThrow();
  });

  it('refuses a schema_version it has no migration step for', () => {
    for (const version of ['0', '"one"', `${SUPPORTED_SCHEMA_VERSION + 1}`]) {
      const root = workspace(`schema_version: ${version}\n${body}`);
      const before = fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8');
      expect(() => migrateWorkspace(root)).toThrow(WorkspaceCompatibilityError);
      expect(fs.readFileSync(path.join(root, '.mygitnotes.yaml'), 'utf8')).toBe(before);
    }
  });

  it('reports a missing workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygitnotes-migration-'));
    roots.push(root);
    expect(() => assertWorkspaceCompatible(root)).toThrow(/No MyGitNotes workspace/);
  });
});
