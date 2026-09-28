import { describe, expect, it } from 'vitest';
import { changeKey, groupChanges } from './file-changes.js';
import { readOnlyReason } from './note-location.js';

describe('Changes by repository', () => {
  const files = [{ path: 'notes/a.md', repository: 'github:me/home@main' }, { path: 'notes/a.md', repository: 'github:me/trpg@main' }, { path: 'notes/b.md', repository: 'github:me/home@main' }];
  it('tells equal paths of two repositories apart', () => {
    expect(new Set(files.map(changeKey)).size).toBe(3);
    expect(changeKey({ path: 'notes/a.md' })).toBe('notes/a.md');
  });
  it('groups by repository in first-seen order only when headings are asked for', () => {
    expect(groupChanges(files)).toEqual([{ key: '', files }]);
    expect(groupChanges(files, id => `heading ${id}`).map(group => [group.heading, group.files.map(file => file.path)])).toEqual([['heading github:me/home@main', ['notes/a.md', 'notes/b.md']], ['heading github:me/trpg@main', ['notes/a.md']]]);
  });
});

describe('read-only reasons', () => {
  it('names why a repository refuses edits', () => {
    expect(readOnlyReason(undefined)).toBe('unavailable');
    expect(readOnlyReason({ unavailable: { reason: 'unmapped' }, branch: 'main', write: false })).toBe('unavailable');
    expect(readOnlyReason({ branch: 'core', write: false })).toBe('core');
    expect(readOnlyReason({ branch: 'draft', write: false })).toBe('branch');
    expect(readOnlyReason({ branch: 'main', write: false })).toBe('no-push');
    expect(readOnlyReason({ branch: 'main', write: true })).toBeUndefined();
  });
});
