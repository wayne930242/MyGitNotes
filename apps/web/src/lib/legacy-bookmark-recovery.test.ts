// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { discardLegacyBookmarkRecovery, legacyBookmarkDraftKey, legacyBookmarkRecoveries } from './legacy-bookmark-recovery.js';

const page = { version: 1, notebooks: [] };
const envelope = ' { "page": {"version":1,"notebooks":[]}, "base": {"version":1,"notebooks":[]}, "revision":"original-head", "id":"draft-id", "ancestors":["older-id"], "futureField":true }\n';
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it('discovers inactive and unavailable configured repositories and preserves exact envelope/base/revision/unknown fields', () => {
  localStorage.setItem(legacyBookmarkDraftKey('inactive'), envelope);
  localStorage.setItem(legacyBookmarkDraftKey('unavailable'), JSON.stringify({ page, base: page, revision: 'other-head' }));
  localStorage.setItem(legacyBookmarkDraftKey('not-configured'), 'private to another workspace');
  const writes = vi.spyOn(Storage.prototype, 'setItem'), removes = vi.spyOn(Storage.prototype, 'removeItem');
  const recoveries = legacyBookmarkRecoveries(['active', 'inactive', 'unavailable', 'inactive']);
  expect(recoveries.map(item => item.repository)).toEqual(['inactive', 'unavailable']);
  expect(recoveries[0]).toEqual({ repository: 'inactive', raw: envelope, malformed: false });
  expect(JSON.parse(recoveries[0].raw)).toMatchObject({ base: page, revision: 'original-head', id: 'draft-id', ancestors: ['older-id'], futureField: true });
  expect(writes).not.toHaveBeenCalled();
  expect(removes).not.toHaveBeenCalled();
});
it.each(['', '{ malformed raw', '{"page":{"version":99}}', JSON.stringify({ page, revision: 'unpaired-no-base' })])('keeps malformed envelopes exportable without substituting a new base: %j', raw => {
  localStorage.setItem(legacyBookmarkDraftKey('a'), raw);
  expect(legacyBookmarkRecoveries(['a'])).toEqual([{ repository: 'a', raw, malformed: true }]);
  expect(localStorage.getItem(legacyBookmarkDraftKey('a'))).toBe(raw);
});
it('cancel/read alone does nothing; discard requires exact repository confirmation and cannot delete a later draft', () => {
  localStorage.setItem(legacyBookmarkDraftKey('a'), envelope);
  localStorage.setItem(legacyBookmarkDraftKey('b'), envelope);
  const [recovery] = legacyBookmarkRecoveries(['a', 'b']);
  expect(localStorage.getItem(legacyBookmarkDraftKey('a'))).toBe(envelope);
  expect(() => discardLegacyBookmarkRecovery(recovery, 'b')).toThrow(/Confirm/);
  localStorage.setItem(legacyBookmarkDraftKey('a'), envelope + ' ');
  expect(() => discardLegacyBookmarkRecovery(recovery, 'a')).toThrow(/changed/);
  expect(localStorage.getItem(legacyBookmarkDraftKey('a'))).toBe(envelope + ' ');
  discardLegacyBookmarkRecovery(legacyBookmarkRecoveries(['a'])[0], 'a');
  expect(localStorage.getItem(legacyBookmarkDraftKey('a'))).toBeNull();
  expect(localStorage.getItem(legacyBookmarkDraftKey('b'))).toBe(envelope);
});
it('reports unavailable storage instead of pretending no recoveries exist', () => {
  expect(() =>
    legacyBookmarkRecoveries(['a'], {
      getItem: () => {
        throw new Error('Storage unavailable');
      },
    })
  ).toThrow('Storage unavailable');
});
