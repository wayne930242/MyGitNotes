import { describe, expect, it } from 'vitest';
import { splitNotePages } from '../src/note-pages.js';
import { parseNoteContent } from '../src/frontmatter.js';
import { applyStudyAction, createStudyNote, emptyStudyWorkspace, findStudyNote, matchesStudyFilter,
  previewStudyRating, reconcileStudyNote, rebindStudyNote, studyCardContent, StudyWorkspaceSchema, undoStudyAction } from '../src/study.js';

const now = new Date('2026-09-14T04:00:00.000Z');
const source = { notebookId: 'english', path: 'notes/english/abandon.md', title: 'abandon', metadata: { id: 'stable-note' }, content: 'What does abandon mean?\n\n---\n\nGive up.\n\n---\n\nThey abandoned the plan.' };

describe('Markdown page boundary', () => {
  it('splits only standalone top-level triple dashes and retains empty pages', () => {
    expect(splitNotePages('One\n\n---\n\nTwo\n\n---\n')).toEqual(['One', 'Two', '']);
    expect(splitNotePages('One\n\n***\n\nTwo\n\n----\n\nThree')).toHaveLength(1);
  });
  it('respects frontmatter, Setext headings, nested blocks, HTML and fenced code', () => {
    const body = 'Heading\n---\n\n> Quote\n>\n> ---\n\n- item\n\n  ---\n\n```md\n---\n```\n\n<div>\n---\n</div>\n\n---\n\nAnswer';
    const raw = `---\ntitle: Test\ncustom: preserved\n---\n${body}`;
    expect(splitNotePages(parseNoteContent(raw).content)).toEqual([body.slice(0, body.lastIndexOf('\n\n---')).trim(), 'Answer']);
    expect(parseNoteContent(raw).metadata.custom).toBe('preserved');
    expect(splitNotePages(body.replaceAll('\n', '\r\n'))).toHaveLength(2);
  });
  it('retains reference definitions between tokens', () => {
    expect(splitNotePages('[ref]: https://example.com\n\n[Link][ref]\n\n---\n\nNext')).toEqual(['[ref]: https://example.com\n\n[Link][ref]', 'Next']);
  });
});
describe('Study identity and memory', () => {
  it('uses page IDs for question/answer, and a title for single-page notes', () => {
    const note = createStudyNote(source, now);
    expect(studyCardContent(note, note.cards[0], 'front')).toEqual(['What does abandon mean?']);
    expect(studyCardContent(note, note.cards[0], 'back')).toEqual(['Give up.', 'They abandoned the plan.']);
    const single = createStudyNote({ ...source, content: 'Give up.' }, now);
    expect(studyCardContent(single, single.cards[0], 'front')).toEqual(['abandon']);
  });
  it('keeps independent reverse-card memory and records FSRS results with undo', () => {
    const note = createStudyNote(source, now), forward = note.cards[0];
    note.cards.push({ ...structuredClone(forward), id: 'reverse', kind: 'reverse', front: forward.back, back: forward.front });
    let workspace = applyStudyAction(emptyStudyWorkspace(), note, forward.id, { kind: 'review', rating: 3 }, now);
    expect(workspace.notes[0].cards[0].scheduler.reps).toBe(1);
    expect(workspace.notes[0].cards[1].scheduler.reps).toBe(0);
    expect(workspace.events[0]).toMatchObject({ kind: 'review', rating: 3, algorithm: 'ts-fsrs@5.4.2', at: now.toISOString() });
    workspace = undoStudyAction(workspace, now);
    expect(workspace.notes[0].cards[0].scheduler).toEqual(forward.scheduler);
    expect(workspace.events).toHaveLength(2);
    expect(() => undoStudyAction(workspace, now)).toThrow('No study action');
  });
  it('keeps reading delays and fixed intervals separate from recall state', () => {
    const note = createStudyNote(source, now), card = note.cards[0];
    let workspace = applyStudyAction(emptyStudyWorkspace(), note, card.id, { kind: 'fixed' }, now);
    expect(workspace.notes[0].reading.due).toBe('2026-09-15T04:00:00.000Z');
    expect(workspace.notes[0].cards[0].scheduler).toEqual(card.scheduler);
    expect(workspace.events[0].rating).toBeUndefined();
    workspace = applyStudyAction(workspace, workspace.notes[0], card.id, { kind: 'fixed' }, now);
    expect(workspace.notes[0].reading.due).toBe('2026-09-17T04:00:00.000Z');
    expect(matchesStudyFilter(workspace.notes[0], 'future', now)).toBe(true);
    expect(matchesStudyFilter(workspace.notes[0], 'due', new Date('2026-09-18T04:00:00Z'))).toBe(true);
    expect(() => applyStudyAction(workspace, note, card.id, { kind: 'read', due: now.toISOString() }, now)).toThrow('future');
  });
  it('updates policy for future ratings, preserves schedule on pause and restores it', () => {
    const note = createStudyNote(source, now), card = note.cards[0];
    const reviewed = applyStudyAction(emptyStudyWorkspace(), note, card.id, { kind: 'review', rating: 4 }, now);
    const before = reviewed.notes[0].cards[0];
    const paused = applyStudyAction(reviewed, reviewed.notes[0], card.id, { kind: 'suspend' }, now);
    expect(matchesStudyFilter(paused.notes[0], 'paused', now)).toBe(true);
    expect(paused.notes[0].cards[0].scheduler).toEqual(before.scheduler);
    const resumed = applyStudyAction(paused, paused.notes[0], card.id, { kind: 'resume' }, now);
    expect(resumed.notes[0].cards[0].enabled).toBe(true);
    const later = new Date('2026-09-20T04:00:00Z');
    const lower = previewStudyRating({ ...before, policy: { ...before.policy, retention: .8 } }, 3, later);
    const higher = previewStudyRating({ ...before, policy: { ...before.policy, retention: .95 } }, 3, later);
    expect(Date.parse(higher.due)).toBeLessThan(Date.parse(lower.due));
  });
  it('reconciles unique reordered pages and explicit note renames without moving card identity', () => {
    const note = createStudyNote(source, now);
    const moved = { ...source, path: 'notes/english/moved.md', content: 'They abandoned the plan.\n\n---\n\nWhat does abandon mean?\n\n---\n\nGive up.' };
    const next = reconcileStudyNote(note, moved)!;
    expect(next.cards[0].id).toBe(note.cards[0].id);
    expect(studyCardContent(next, next.cards[0], 'front')).toEqual(['What does abandon mean?']);
    expect(findStudyNote({ version: 1, notes: [note], events: [] }, moved)?.id).toBe(note.id);
    expect(reconcileStudyNote(note, { ...source, content: 'Changed question\n\n---\n\nGive up.' })).toBeNull();
  });
  it('requires remapping for ambiguous duplicates or changed content, with an explicit reset choice', () => {
    const duplicated = { ...source, content: 'A\n\n---\n\nA\n\n---\n\nB' };
    const duplicateNote = createStudyNote(duplicated, now);
    expect(reconcileStudyNote(duplicateNote, duplicated)).not.toBeNull();
    expect(reconcileStudyNote(duplicateNote, { ...duplicated, content: 'A\n\n---\n\nB\n\n---\n\nA' })).toBeNull();
    const note = createStudyNote(source, now);
    const reviewed = applyStudyAction(emptyStudyWorkspace(), note, note.cards[0].id, { kind: 'review', rating: 3 }, now);
    const changed = { ...source, content: 'New question\n\n---\n\nNew answer' };
    const kept = rebindStudyNote(reviewed, reviewed.notes[0], changed, false, now);
    const reset = rebindStudyNote(reviewed, reviewed.notes[0], changed, true, now);
    expect(kept.notes[0].cards[0].scheduler.reps).toBe(1);
    expect(reset.notes[0].cards[0].scheduler.reps).toBe(0);
    expect(reset.notes[0].cards[0].id).toBe(note.cards[0].id);
    expect(reset.events).toHaveLength(2);
  });
  it('validates future cloze mappings and rejects unknown pages and duplicate identities', () => {
    const note = createStudyNote(source, now);
    note.cards[0].kind = 'cloze';
    note.cards[0].masks = [{ pageId: note.pages[1].id, start: 0, end: 4, text: 'Give' }];
    const workspace = { version: 1, notes: [note], events: [] };
    expect(StudyWorkspaceSchema.safeParse(workspace).success).toBe(true);
    note.cards[0].masks[0].text = 'Wrong';
    expect(StudyWorkspaceSchema.safeParse(workspace).success).toBe(false);
    delete note.cards[0].masks;
    note.cards[0].front = ['missing'];
    expect(StudyWorkspaceSchema.safeParse(workspace).success).toBe(false);
  });
});
