import { expect, it } from 'vitest';
import { parseNoteFile } from '@mygitnotes/core/note-file';
import { currentNoteFile } from './current-note-file.js';

const latest = '---\ntitle: Plan\nupdated: 2026-10-07T08:00:00.000Z\n---\n\n# Plan\none\n';

it('reads the same text the same way every time, keeping the note’s own updated stamp', () => {
  const { metadata, content } = parseNoteFile(latest, 'notes/ex/plan.md');
  const first = currentNoteFile('notes/ex/plan.md', metadata, content, latest, new Date('2026-10-08T01:00:00Z'));
  const later = currentNoteFile('notes/ex/plan.md', metadata, content, latest, new Date('2026-10-08T02:00:00Z'));
  expect(first).toBe(latest);
  expect(later).toBe(first);
  const edited = currentNoteFile('notes/ex/plan.md', metadata, '# Plan\ntwo\n', latest, new Date());
  expect(edited).toMatch(/updated: "?2026-10-07T08:00:00.000Z/);
  expect(edited).toContain('two');
});

it('uses the given stamp for a note without one', () => {
  const at = new Date('2026-10-08T01:00:00Z');
  const text = currentNoteFile('notes/ex/new.md', { title: 'New' }, '# New\n', null, at);
  expect(text).toBe(currentNoteFile('notes/ex/new.md', { title: 'New' }, '# New\n', null, at));
  expect(text).toContain(at.toISOString());
});
