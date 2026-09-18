import { describe, expect, it } from 'vitest';
import { readFilterQuery, writeFilterQuery } from './filter-query.js';
import { noteReturnRoute, parseWorkspaceRoute } from './routes.js';

describe('shared nuqs query contract', () => {
  it('round trips repeated tags and folder paths without splitting punctuation', () => {
    const state = { tag: ['a,b', '繁體中文 + #?%', 'x&y'], folders: ['notes/a/研究 & 記錄', 'notes/b/same'], tagMode: 'all' as const, descendants: false, neighbors: true, q: 'hello #?' };
    const search = writeFilterQuery('?keep=unchanged', state);
    expect(readFilterQuery(search)).toMatchObject(state);
    expect(new URLSearchParams(search).get('keep')).toBe('unchanged');
    const origin = '/graph' + search;
    const returned = new URL(noteReturnRoute('?' + new URLSearchParams({ returnTo: origin }), 'a'), 'https://workspace.test');
    expect(returned.pathname).toBe('/graph');
    expect(readFilterQuery(returned.search)).toMatchObject(state);
  });
  it('reads legacy filters and defaults malformed values safely', () => {
    expect(parseWorkspaceRoute('/notebooks/a/folders/projects', '?tag=demo')).toMatchObject({ folder: 'projects', tags: ['demo'], tagMode: 'any', descendants: true });
    expect(readFilterQuery('?tag=&tag=blue').tag).toEqual(['blue']);
    expect(readFilterQuery('?tagMode=broken&view=broken&folders=../secret&folders=notes/a/valid')).toMatchObject({ tagMode: 'any', view: 'flat', folders: ['notes/a/valid'] });
    expect(writeFilterQuery('?q=hi&tag=old&keep=yes', { q: '', tag: [], neighbors: false })).toBe('?keep=yes');
    expect(readFilterQuery('?allNotebooks=true').allNotebooks).toBe(true);
    expect(writeFilterQuery('?allNotebooks=true&keep=yes', { allNotebooks: false })).toBe('?keep=yes');
  });
  it('preserves the focus parameter, which is not a filter, across clears and changes', () => {
    // Mirrors App.tsx's clearFilters reset.
    expect(writeFilterQuery('?focus=current&q=hi&tag=old', { q: '', tag: [], folders: [], descendants: true, tagMode: 'any', status: null, showHidden: false, neighbors: false })).toBe('?focus=current');
    expect(writeFilterQuery('?focus=focus-1', { q: 'hello' })).toBe('?focus=focus-1&q=hello');
    expect(readFilterQuery('?focus=current&q=hi').q).toBe('hi');
  });
});
