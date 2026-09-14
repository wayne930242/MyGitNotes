import { describe, expect, it } from 'vitest';
import { nextStudyStage, StudyProgressionSchema, defaultStudyProgression, studyLaneStatuses } from '../src/study-stages.js';
import { applyStageAction, createStudyNote, emptyStudyWorkspace, studyDue, undoStudyAction, StudyWorkspaceSchema, applyStudyAction, rebindStudyNote } from '../src/study.js';
import { parseNoteContent, replaceNoteStatus } from '../src/frontmatter.js';

const plan = { stages: [{ status: 'new', intervalDays: 1 }, { status: 'learning', intervalDays: 3 }, { status: 'review', intervalDays: 7 }, { status: 'known', intervalDays: 30 }], easy: 'two' as const };
const now = new Date('2026-09-14T04:00:00Z');
const source = { notebookId: 'a', path: 'notes/a/card.md', title: 'Question', content: 'Question\n\n---\n\nAnswer', metadata: { status: 'learning' } };
describe('Lane stage progression', () => {
  it.each([[1, 'new', 1], [2, 'learning', 3], [3, 'review', 7], [4, 'known', 30]] as const)('routes rating %s to its stage interval', (rating, status, intervalDays) => {
    expect(nextStudyStage(plan, 'learning', rating)).toEqual({ status, intervalDays });
    const note = createStudyNote(source, now);
    const result = applyStageAction(emptyStudyWorkspace(), note, 'lane', 'learning', plan, { kind: 'stage-review', rating }, now);
    expect(result.notes[0].stage).toEqual({ laneId: 'lane', status, due: new Date(now.getTime() + intervalDays * 86400000).toISOString() });
    expect(result.notes[0].lastMovedAt).toBe(now.toISOString());
    expect(result.events[0].at).toBe(result.notes[0].lastMovedAt);
    expect(undoStudyAction(result).notes[0].lastMovedAt).toBeUndefined();
    expect(result.events[0].transition).toMatchObject({ fromStatus: 'learning', toStatus: status });
    expect(studyDue(result.notes[0])).toBe(result.notes[0].stage!.due);
    expect(result.notes[0].cards[0].scheduler.reps).toBe(0);
    expect(undoStudyAction(result).notes[0].stage).toBeUndefined();
  });
  it('jumps two stages or directly to the last without multiplying the interval', () => {
    expect(nextStudyStage(plan, 'new', 4)).toEqual(plan.stages[2]);
    expect(nextStudyStage({ ...plan, easy: 'last' }, 'new', 4)).toEqual(plan.stages[3]);
    expect(nextStudyStage(plan, 'known', 4)).toEqual(plan.stages[3]);
  });
  it('validates unique statuses and allows short configured relearning intervals', () => {
    expect(StudyProgressionSchema.safeParse({ ...plan, stages: [{ status: 'new', intervalDays: 1 / 1440 }] }).success).toBe(true);
    expect(StudyProgressionSchema.safeParse({ ...plan, stages: [plan.stages[0], plan.stages[0]] }).success).toBe(false);
  });
  it('records reading and manual postponement independently from recall', () => {
    const note = createStudyNote(source, now);
    const result = applyStageAction(emptyStudyWorkspace(), note, 'lane', 'learning', plan, { kind: 'stage-read', rating: 3 }, now);
    expect(result.events[0].kind).toBe('stage-read');
    const due = new Date(now.getTime() + 3600000).toISOString();
    const postponed = applyStageAction(result, result.notes[0], 'lane', 'review', plan, { kind: 'stage-postpone', due }, now);
    expect(postponed.notes[0].stage).toEqual({ laneId: 'lane', status: 'review', due });
    expect(postponed.events.at(-1)?.rating).toBeUndefined();
  });
  it.each(['\n', '\r\n'])('preserves body and other YAML fields during status changes', newline => {
    const raw = ['---', '# keep comment', 'title: "Literal title"', 'custom: { value: 7 }', 'status: learning', '---', '', 'Question  ', '', '---', '', 'Answer', ''].join(newline);
    const updated = replaceNoteStatus(raw, 'review');
    expect(updated).toContain('# keep comment');
    expect(parseNoteContent(updated).content).toBe(parseNoteContent(raw).content);
    expect(parseNoteContent(updated).metadata).toEqual({ ...parseNoteContent(raw).metadata, status: 'review' });
    expect(parseNoteContent(replaceNoteStatus(updated, null)).metadata.status).toBeUndefined();
  });
});

describe('Default learning strategies', () => {
  it.each([
    [['only'], [1]],
    [['new', 'known'], [1, 3]],
    [['new', 'learning', 'known'], [1, 3, 7]],
    [['a', 'b', 'c', 'd', 'e', 'f'], [1, 3, 7, 14, 30, 30]],
  ])('uses the available status count without inventing stages: %j', (statuses, intervals) => {
    const progression = defaultStudyProgression(statuses as string[])!;
    expect(progression.stages.map(stage => stage.status)).toEqual(statuses);
    expect(progression.stages.map(stage => stage.intervalDays)).toEqual(intervals);
    for (const rating of [1, 2, 3, 4] as const) expect(nextStudyStage(progression, statuses.at(-1) as string, rating)).toEqual(progression.stages[rating === 1 ? 0 : progression.stages.length - 1]);
  });
  it('uses normal default statuses when absent and excludes archival from generated plans', () => {
    expect(defaultStudyProgression([])?.stages).toEqual([{ status: 'inbox', intervalDays: 1 }, { status: 'working', intervalDays: 3 }, { status: 'done', intervalDays: 7 }]);
    expect(defaultStudyProgression(['new', 'archived', 'known', 'new'])?.stages.map(stage => stage.status)).toEqual(['new', 'known']);
    expect(defaultStudyProgression(['archived'])).toBeUndefined();
  });
  it('scopes defaults to the lane notebooks and preserves YAML ordering', () => {
    const notebooks = [{ id: 'a', statuses: ['new', 'known'] }, { id: 'b', statuses: ['todo', 'review', 'done'] }];
    const row = { id: 'lane', name: 'Lane', view: 'small' as const, kind: 'dynamic' as const, source: { kind: 'folder' as const, notebookId: 'b', path: 'notes/b', recursive: true } };
    expect(studyLaneStatuses(row, notebooks)).toEqual(['todo', 'review', 'done']);
    expect(studyLaneStatuses({ ...row, source: { kind: 'tag', tag: 'review', notebookId: 'a' } }, notebooks)).toEqual(['new', 'known']);
    expect(studyLaneStatuses({ ...row, kind: 'custom', items: [{ id: 'note', kind: 'note', notebookId: 'a', path: 'notes/a/test.md' }] }, notebooks)).toEqual(['new', 'known']);
    expect(studyLaneStatuses({ ...row, source: { kind: 'tag', tag: 'review' } }, notebooks)).toEqual(['new', 'known', 'todo', 'review', 'done']);
  });
});


describe('Last learning move time', () => {
  const later = new Date('2026-09-16T09:30:00.000Z');
  const firstMove = () => applyStageAction(emptyStudyWorkspace(), createStudyNote(source, now), 'lane', 'learning', plan, { kind: 'stage-review', rating: 2 }, now);
  const legacy = (workspace: ReturnType<typeof firstMove>) => {
    const copy = structuredClone(workspace);
    for (const note of copy.notes) delete note.lastMovedAt;
    for (const event of copy.events) if (event.before) delete event.before.lastMovedAt;
    return copy;
  };
  it('restarts the interval when a later rating stays in the same stage and restores it on undo', () => {
    const first = firstMove();
    const second = applyStageAction(first, first.notes[0], 'lane', 'learning', plan, { kind: 'stage-review', rating: 2 }, later);
    expect(second.notes[0]).toMatchObject({ lastMovedAt: later.toISOString(), stage: { status: 'learning', due: '2026-09-19T09:30:00.000Z' } });
    expect(second.events.at(-1)?.transition).toMatchObject({ fromStatus: 'learning', toStatus: 'learning' });
    expect(undoStudyAction(second).notes[0]).toEqual(first.notes[0]);
  });
  it('preserves the move time through postponement, legacy configuration and rebinding', () => {
    const first = firstMove();
    const postponed = applyStageAction(first, first.notes[0], 'lane', 'learning', plan, { kind: 'stage-postpone', due: '2026-10-01T00:00:00.000Z' }, later);
    expect(postponed.notes[0].lastMovedAt).toBe(now.toISOString());
    expect(undoStudyAction(postponed).notes[0]).toEqual(first.notes[0]);
    const paused = applyStudyAction(first, first.notes[0], first.notes[0].cards[0].id, { kind: 'suspend' }, later);
    expect(paused.notes[0].lastMovedAt).toBe(now.toISOString());
    expect(undoStudyAction(paused).notes[0]).toEqual(first.notes[0]);
    const rebound = rebindStudyNote(first, first.notes[0], { ...source, content: 'Updated question\n\n---\n\nAnswer' }, true, later);
    expect(rebound.notes[0].lastMovedAt).toBe(now.toISOString());
    const unread = applyStageAction(emptyStudyWorkspace(), createStudyNote(source, now), 'lane', 'learning', plan, { kind: 'stage-postpone', due: '2026-10-01T00:00:00.000Z' }, later);
    expect(unread.notes[0].lastMovedAt).toBeUndefined();
  });
  it('backfills old ratings and undo snapshots without changing the input or inventing missing history', () => {
    const first = firstMove();
    const second = applyStageAction(first, first.notes[0], 'lane', 'learning', plan, { kind: 'stage-read', rating: 2 }, later);
    const old = legacy(second), text = JSON.stringify(old);
    const restored = StudyWorkspaceSchema.parse(old);
    expect(restored.notes[0].lastMovedAt).toBe(later.toISOString());
    expect(restored.events.at(-1)?.before?.lastMovedAt).toBe(now.toISOString());
    expect(undoStudyAction(restored).notes[0]).toEqual(first.notes[0]);
    expect(JSON.stringify(old)).toBe(text);
    expect(StudyWorkspaceSchema.parse(legacy(undoStudyAction(second))).notes[0].lastMovedAt).toBe(now.toISOString());
    expect(StudyWorkspaceSchema.parse(legacy(undoStudyAction(first))).notes[0].lastMovedAt).toBeUndefined();
    const afterUndo = undoStudyAction(second);
    const third = applyStageAction(afterUndo, afterUndo.notes[0], 'lane', 'learning', plan, { kind: 'stage-review', rating: 3 }, new Date('2026-09-17T12:00:00.000Z'));
    expect(StudyWorkspaceSchema.parse(legacy(third)).notes[0].lastMovedAt).toBe('2026-09-17T12:00:00.000Z');
    const unknown = { ...emptyStudyWorkspace(), notes: [createStudyNote(source, now)] };
    expect(StudyWorkspaceSchema.parse(unknown).notes[0].lastMovedAt).toBeUndefined();
  });
  it('keeps explicit timestamps when event history is unavailable and validates them', () => {
    const workspace = firstMove(); workspace.events = [];
    expect(StudyWorkspaceSchema.parse(workspace).notes[0].lastMovedAt).toBe(now.toISOString());
    workspace.notes[0].lastMovedAt = 'invalid';
    expect(StudyWorkspaceSchema.safeParse(workspace).success).toBe(false);
  });
});
