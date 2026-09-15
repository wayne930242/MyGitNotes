import { describe, expect, it } from 'vitest';
import { parseNoteContent, replaceNoteStatus } from '../src/frontmatter.js';

describe('status edits preserve the original frontmatter text', () => {
  it.each(['\n', '\r\n'])('changes only the status value with %j line endings', eol => {
    const raw = ['---', 'tags: ["規則"]', "title: '原始標題'", 'custom: {x: 1,y: 2}', 'status: learning # keep', '---', '', '正文  ', ''].join(eol);
    expect(replaceNoteStatus(raw, 'review')).toBe(raw.replace('status: learning', 'status: review'));
    expect(replaceNoteStatus(raw, 'learning')).toBe(raw);
    expect(replaceNoteStatus(raw, null)).toBe(raw.replace(`status: learning # keep${eol}`, ''));
  });
  it('appends a missing status without changing existing fields or the closing delimiter', () => {
    const raw = '---\ntags: ["規則"]\n---';
    expect(replaceNoteStatus(raw, 'review')).toBe('---\ntags: ["規則"]\nstatus: review\n---');
    expect(replaceNoteStatus(raw, null)).toBe(raw);
  });
  it('does not mistake nested status or block text for the top-level field', () => {
    const raw = '---\ncustom:\n  status: learning\ndescription: |\n  status: learning\n"status": \'learning\' # keep\ntags: ["規則"]\n---\nbody';
    expect(replaceNoteStatus(raw, 'review')).toBe(raw.replace("'learning'", "'review'"));
  });
  it.each(['status: |\n  learning\n', 'status: [learning, review]\n', 'status:\n'])('replaces a non-inline value: %s', field => {
    const raw = `---\n${field}tags: ["規則"]\n---\nbody`;
    const updated = replaceNoteStatus(raw, 'review');
    expect(parseNoteContent(updated).metadata).toEqual({ status: 'review', tags: ['規則'] });
    expect(updated).toContain('tags: ["規則"]\n---\nbody');
  });
  it.each(['{status: learning, tags: ["規則"]}', '{tags: ["規則"], status: learning}'])('patches flow mappings without reformatting: %s', yaml => {
    const raw = `---\n${yaml}\n---\nbody`;
    expect(replaceNoteStatus(raw, 'review')).toBe(raw.replace('learning', 'review'));
    expect(parseNoteContent(replaceNoteStatus(raw, null)).metadata).toEqual({ tags: ['規則'] });
  });
  it('quotes values that have YAML syntax', () => {
    const raw = '---\nstatus: learning\ntags: ["規則"]\n---\nbody';
    expect(parseNoteContent(replaceNoteStatus(raw, 'a: # b')).metadata.status).toBe('a: # b');
  });
  it('keeps the body separate when deleting the only frontmatter field', () => {
    const raw = '---\n# keep\nstatus: learning\n---\n\nbody  \n';
    const updated = replaceNoteStatus(raw, null);
    expect(parseNoteContent(updated).metadata).toEqual({});
    expect(parseNoteContent(updated).content).toBe(parseNoteContent(raw).content);
    expect(updated).toContain('# keep');
  });
});
