import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOOKMARKS_FILE, planFileChange, serializeWorkspaceDocument } from '@mygitnotes/core';
import { applyLocalFilePlan, localFileSnapshot } from '../src/file-manager.js';

it('restores bookmark bytes and moved note bytes after a late local apply failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-rollback-'));
  const raw = serializeWorkspaceDocument({ version: 1, notebooks: [{ notebookId: 'n', groups: [], bookmarks: [{ id: 'a', label: 'A', groupId: null, target: { kind: 'note', path: 'a.md' } }] }] });
  try {
    fs.mkdirSync(path.join(root, 'notes/n'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes/n/a.md'), '# Original\n');
    fs.writeFileSync(path.join(root, BOOKMARKS_FILE), raw);
    const command = { kind: 'move', notebookId: 'n', path: 'notes/n/a.md', destination: 'notes/n/b.md' } as const;
    const before = localFileSnapshot(root, [{ id: 'n', root: 'notes/n', title: 'N' }], command);
    const after = planFileChange(before, command);
    const rename = fs.renameSync;
    let writes = 0;
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (++writes === 2) throw new Error('injected second write failure');
      rename(from, to);
    });
    try {
      expect(() => applyLocalFilePlan(root, before, after)).toThrow('injected second write failure');
    } finally {
      fault.mockRestore();
    }
    expect(writes).toBeGreaterThanOrEqual(3);
    expect(fs.readFileSync(path.join(root, BOOKMARKS_FILE), 'utf8')).toBe(raw);
    expect(fs.readFileSync(path.join(root, 'notes/n/a.md'), 'utf8')).toBe('# Original\n');
    expect(fs.existsSync(path.join(root, 'notes/n/b.md'))).toBe(false);
    expect(fs.readdirSync(path.join(root, 'notes/n'))).toEqual(['a.md']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
