// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { discardStash, readStash, stashText } from './history-stash.js';

const target = { notebookId: 'kb~life', repository: 'local:/notes', path: 'notes/a.md' };
const legacyKey = `github-notes:history-stash:${JSON.stringify(['life', 'local:/notes', 'notes/a.md'])}`;
beforeEach(() => localStorage.clear());

it('keeps texts stashed before notebook keys under the key, and a discard stays discarded', () => {
  localStorage.setItem(legacyKey, JSON.stringify([{ id: 'old', saved: '2026-10-01T00:00:00.000Z', content: 'before' }]));
  expect(readStash(target).map(entry => entry.content)).toEqual(['before']);
  expect(localStorage.getItem(legacyKey)).toBeNull();
  stashText(target, 'after', new Date('2026-10-09T00:00:00.000Z'));
  expect(readStash(target).map(entry => entry.content)).toEqual(['after', 'before']);
  for (const entry of readStash(target)) discardStash(target, entry.id);
  expect(readStash(target)).toEqual([]);
});
