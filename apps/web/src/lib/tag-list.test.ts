import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterAndSortTags, getSavedTagSort, saveTagSort, TAG_SORT_STORAGE_KEY } from './tag-list.js';

afterEach(() => vi.unstubAllGlobals());

describe('tag list', () => {
  const counts = { 'Chapter 10': 1, Handout: 5, 'Chapter 2': 1, 備團: 3, 原稿筆記: 8 };

  it('searches tag names without case sensitivity or surrounding whitespace', () => {
    expect(filterAndSortTags(counts, '  hAnD ', 'name-asc', 'en')).toEqual(['Handout']);
    expect(filterAndSortTags(counts, '原稿', 'name-asc', 'zh-TW')).toEqual(['原稿筆記']);
    expect(filterAndSortTags(counts, 'missing', 'count-desc', 'en')).toEqual([]);
    expect(filterAndSortTags({}, '', 'name-asc', 'en')).toEqual([]);
  });

  it('sorts names naturally in either direction', () => {
    expect(filterAndSortTags(counts, 'chapter', 'name-asc', 'en')).toEqual(['Chapter 2', 'Chapter 10']);
    expect(filterAndSortTags(counts, 'chapter', 'name-desc', 'en')).toEqual(['Chapter 10', 'Chapter 2']);
  });

  it('sorts by note counts and uses names to break ties without mutating counts', () => {
    const before = { ...counts };
    expect(filterAndSortTags(counts, '', 'count-desc', 'en')).toEqual(['原稿筆記', 'Handout', '備團', 'Chapter 2', 'Chapter 10']);
    expect(filterAndSortTags(counts, '', 'count-asc', 'en')).toEqual(['Chapter 2', 'Chapter 10', '備團', 'Handout', '原稿筆記']);
    expect(counts).toEqual(before);
  });

  it('remembers the tag order independently of note sorting', () => {
    const storage = new Map([['github-notes:sort-field', 'updated']]);
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    expect(getSavedTagSort()).toBe('name-asc');
    saveTagSort('count-desc');
    expect(getSavedTagSort()).toBe('count-desc');
    expect(storage.get('github-notes:sort-field')).toBe('updated');
    storage.set(TAG_SORT_STORAGE_KEY, 'invalid');
    expect(getSavedTagSort()).toBe('name-asc');
  });

  it('remains usable when browser storage is unavailable', () => {
    expect(getSavedTagSort()).toBe('name-asc');
    expect(() => saveTagSort('count-desc')).not.toThrow();
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('Storage blocked');
      },
    });
    expect(getSavedTagSort()).toBe('name-asc');
    expect(() => saveTagSort('count-desc')).not.toThrow();
  });
});
