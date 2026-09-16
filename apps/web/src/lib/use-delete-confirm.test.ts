import { describe, expect, it } from 'vitest';
import { nextDeleteConfirmState } from './use-delete-confirm.js';

describe('nextDeleteConfirmState', () => {
  it('deletes immediately when confirmation is not required', () => {
    expect(nextDeleteConfirmState(null, 'a.md', false)).toEqual({ pendingPath: null, shouldDelete: true });
  });

  it('arms the path on the first request when confirmation is required', () => {
    expect(nextDeleteConfirmState(null, 'a.md', true)).toEqual({ pendingPath: 'a.md', shouldDelete: false });
  });

  it('deletes on a second request for the same armed path', () => {
    expect(nextDeleteConfirmState('a.md', 'a.md', true)).toEqual({ pendingPath: null, shouldDelete: true });
  });

  it('re-arms for a different path instead of deleting the previously armed one', () => {
    expect(nextDeleteConfirmState('a.md', 'b.md', true)).toEqual({ pendingPath: 'b.md', shouldDelete: false });
  });
});
