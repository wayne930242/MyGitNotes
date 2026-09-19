import { describe, expect, it } from 'vitest';
import { parseWorkspaceConfig, serializeWorkspaceConfig, validateWorkspaceConfig } from '../src/config.js';
import { isNoteHidden, resolveNoteStatuses, withNoteStatus } from '../src/note-status.js';

const manifest = (statuses?: unknown) => ({ schema_version: 1, workspace: { title: 'Notes', default_notebook: 'personal' }, notebooks: [{ id: 'personal', title: 'Personal', root: 'notes/personal', ...(statuses !== undefined ? { statuses } : {}) }, { id: 'research', title: 'Research', root: 'notes/research' }] });

describe('notebook status vocabulary', () => {
  it('defaults archived to hidden and respects explicit visibility booleans', () => {
    expect(isNoteHidden({ status: 'archived' })).toBe(true);
    expect(isNoteHidden({ status: 'archived', hiden: false })).toBe(false);
    expect(isNoteHidden({ status: 'working', hiden: true })).toBe(true);
    expect(isNoteHidden({ status: 'working' })).toBe(false);
    expect(isNoteHidden({})).toBe(false);
    expect(isNoteHidden({ status: 'working', hiden: 'false' } as any)).toBe(false);
  });

  it('persists archive transitions and preserves manually hidden non-archived notes', () => {
    const metadata = { status: 'working', custom: { keep: true } };
    const archived = withNoteStatus(metadata, 'archived');
    expect(archived).toEqual({ ...metadata, status: 'archived', hiden: true });
    expect(withNoteStatus(archived, 'working')).toEqual({ ...metadata, hiden: false });
    expect(withNoteStatus({ ...metadata, hiden: true }, 'review')).toEqual({ ...metadata, status: 'review', hiden: true });
    expect(withNoteStatus(archived, '')).toEqual({ ...metadata, status: undefined, hiden: false });
    expect(metadata).toEqual({ status: 'working', custom: { keep: true } });
  });

  it('uses note defaults for absent or empty definitions', () => {
    for (const statuses of [undefined, []]) {
      const config = validateWorkspaceConfig(manifest(statuses));
      expect(resolveNoteStatuses(config.notebooks[0])).toEqual(['inbox', 'working', 'done', 'archived']);
    }
  });

  it('round trips custom order and keeps notebooks independent', () => {
    const config = validateWorkspaceConfig(manifest(['capture', 'Review', 'published']));
    const reloaded = parseWorkspaceConfig(serializeWorkspaceConfig(config));
    expect(resolveNoteStatuses(reloaded.notebooks[0])).toEqual(['capture', 'Review', 'published']);
    expect(resolveNoteStatuses(reloaded.notebooks[1])).toEqual(['inbox', 'working', 'done', 'archived']);
    expect(reloaded.notebooks[1]).not.toHaveProperty('statuses');
  });

  it('appends observed legacy and unknown values without rewriting either input', () => {
    const notebook = { statuses: ['capture', 'Review'] };
    const observed = ['doing', 'Review', 'review', undefined, '', 'done', 'doing', '__proto__'];
    const before = JSON.stringify({ notebook, observed });
    expect(resolveNoteStatuses(notebook, observed)).toEqual(['capture', 'Review', '__proto__', 'doing', 'done', 'review']);
    expect(JSON.stringify({ notebook, observed })).toBe(before);
    expect(resolveNoteStatuses({ statuses: [] }, ['doing'])).toContain('doing');
  });

  it.each([null, 'inbox', [42], [''], ['  '], [' inbox'], ['done '], ['inbox', 'inbox']])('rejects malformed status definitions: %j', statuses => {
    expect(() => validateWorkspaceConfig(manifest(statuses))).toThrow(/statuses must be an array/);
  });
});
