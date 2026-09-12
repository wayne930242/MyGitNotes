import { describe, expect, it } from 'vitest';
import { mergeNote } from './merge-note.js';
const draft = (content: string, metadata: Record<string, unknown> = {}) => ({ content, metadata });
describe('remote note reconciliation', () => {
  it('merges independent line and metadata edits, preserving CRLF', () => {
    const base = draft('one\r\ntwo\r\nthree\r\n', { title: 'old', nested: { a: 1, b: 1 } });
    const local = draft('ONE\r\ntwo\r\nthree\r\n', { title: 'new', nested: { a: 2, b: 1 } });
    const remote = draft('one\r\ntwo\r\nTHREE\r\n', { title: 'old', nested: { a: 1, b: 2 } });
    expect(mergeNote(base, local, remote)).toEqual({ conflict: false, draft: draft('ONE\r\ntwo\r\nTHREE\r\n', { title: 'new', nested: { a: 2, b: 2 } }) });
  });
  it('rejects overlapping content and metadata edits without mutating the draft', () => {
    const local = draft('local');
    expect(mergeNote(draft('base'), local, draft('remote'))).toEqual({ conflict: true });
    expect(local.content).toBe('local');
    expect(mergeNote(draft('', { title: 'base' }), draft('', { title: 'local' }), draft('', { title: 'remote' }))).toEqual({ conflict: true });
  });
  it('accepts identical edits and handles deletion versus modification', () => {
    expect(mergeNote(draft('base'), draft('same'), draft('same'))).toEqual({ conflict: false, draft: draft('same') });
    expect(mergeNote(draft('', { a: 1, b: 2 }), draft('', { b: 2 }), draft('', { a: 1, b: 3 }))).toEqual({ conflict: false, draft: draft('', { b: 3 }) });
    expect(mergeNote(draft('', { a: 1 }), draft('', {}), draft('', { a: 2 }))).toEqual({ conflict: true });
  });
});
