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
    expect(readFilterQuery('?tagMode=broken&view=broken&folders=../secret&folders=notes/a/valid')).toMatchObject({ tagMode: 'any', view: 'flat', folders: ['notes/a/valid'] });
    expect(writeFilterQuery('?q=hi&tag=old&keep=yes', { q: '', tag: [], neighbors: false })).toBe('?keep=yes');
  });
});
