import { describe, expect, it } from 'vitest';
import { pushTagOperationRecord } from './use-tag-operations.js';

describe('pushTagOperationRecord', () => {
  it('prepends a record carrying the full plan, so undo can invert it later', () => {
    const plan = { affected: [{ path: 'a.md', notebookId: 'nb', previousTags: ['x'], nextTags: ['y'] }] };
    const history = pushTagOperationRecord([], 'rename', 'x -> y', plan);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: 'rename', label: 'x -> y', plan });
  });

  it('gives each record a distinct id and keeps newest first', () => {
    const plan = { affected: [] };
    const history = pushTagOperationRecord(pushTagOperationRecord([], 'delete', 'first', plan), 'delete', 'second', plan);
    expect(history.map(r => r.label)).toEqual(['second', 'first']);
    expect(history[0].id).not.toBe(history[1].id);
  });
});
