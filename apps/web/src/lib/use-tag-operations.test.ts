import { describe, expect, it } from 'vitest';
import { pushTagOperationRecord } from './use-tag-operations.js';

describe('pushTagOperationRecord', () => {
  it('prepends a record carrying the full plan, so undo can invert it later', () => {
    const plan = { affected: [{ path: 'a.md', notebookId: 'nb', previousTags: ['x'], nextTags: ['y'] }] };
    const history = pushTagOperationRecord([], 'rename', { key: 'sidebar.tagRenamedLabel', params: { from: 'x', to: 'y', count: 1 } }, plan);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: 'rename', label: { key: 'sidebar.tagRenamedLabel', params: { from: 'x', to: 'y', count: 1 } }, plan });
  });

  it('keeps the label as a translation key and params so the toast follows a later language switch', () => {
    const plan = { affected: [] };
    const label = { key: 'bulk.tagAddedLabel' as const, params: { tag: 'x', count: 2 } };
    const [record] = pushTagOperationRecord([], 'add', label, plan);
    expect(record.label).toEqual(label);
  });

  it('gives each record a distinct id and keeps newest first', () => {
    const plan = { affected: [] };
    const history = pushTagOperationRecord(pushTagOperationRecord([], 'delete', { key: 'sidebar.tagDeletedLabel', params: { tag: 'first', count: 0 } }, plan), 'delete', { key: 'sidebar.tagDeletedLabel', params: { tag: 'second', count: 0 } }, plan);
    expect(history.map(r => r.label.params.tag)).toEqual(['second', 'first']);
    expect(history[0].id).not.toBe(history[1].id);
  });
});
