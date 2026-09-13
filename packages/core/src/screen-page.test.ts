import { describe, expect, it } from 'vitest';
import { ScreenPageSchema, moveScreenItem, moveScreenRow, parseYouTubeUrl } from './screen-page.js';

const note = { id: 'a', kind: 'note', notebookId: 'one', path: 'notes/one/a.md' };
const page = { version: 1, rows: [
  { id: 'first', name: '閱讀', view: 'small', kind: 'custom', items: [note] },
  { id: 'second', name: '參考', view: 'medium', kind: 'custom', items: [{ ...note, id: 'b', notebookId: 'two', path: 'notes/two/b.md' }] },
  { id: 'live', name: '動態標籤', view: 'thumbnail', kind: 'dynamic', source: { kind: 'tag', tag: 'clue' } },
] };
describe('Screen Page swimlanes', () => {
  it('moves references across custom rows without changing notebook identity', () => {
    const config = ScreenPageSchema.parse(page);
    const moved = moveScreenItem(config, 'a', 'second', 1);
    expect(moved.rows[0]).toMatchObject({ items: [] });
    expect(moved.rows[1]).toMatchObject({ items: [{ id: 'b' }, note] });
    expect(config.rows[0]).toMatchObject({ items: [note] });
    expect(moveScreenRow(config, 'live', 0).rows.map(r => r.id)).toEqual(['live', 'first', 'second']);
    expect(() => moveScreenItem(config, 'a', 'live', 0)).toThrow();
  });
  it('rejects traversal, duplicate identities, dynamic-row contents and unknown layout fields', () => {
    for (const item of [{ ...note, path: '../private' }, { ...note, path: '/etc/passwd' }, { ...note, x: 1 }, { ...note, path: 'notes\\one' }]) {
      expect(ScreenPageSchema.safeParse({ version: 1, rows: [{ ...page.rows[0], items: [item] }] }).success).toBe(false);
    }
    expect(ScreenPageSchema.safeParse({ version: 1, rows: [page.rows[0], page.rows[0]] }).success).toBe(false);
    expect(ScreenPageSchema.safeParse({ version: 1, rows: [{ ...page.rows[2], items: [note] }] }).success).toBe(false);
  });
  it('accepts only recognized YouTube URLs and extracts playback start time', () => {
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toEqual({ videoId: 'dQw4w9WgXcQ', start: 90 });
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', start: 0 });
    for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=bad', 'https://u:p@youtube.com/watch?v=dQw4w9WgXcQ']) expect(parseYouTubeUrl(url)).toBeNull();
  });
});
