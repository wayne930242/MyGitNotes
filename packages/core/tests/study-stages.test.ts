import { describe, expect, it } from 'vitest';
import { nextStudyStage, StudyProgressionSchema } from '../src/study-stages.js';
import { applyStageAction, createStudyNote, emptyStudyWorkspace, studyDue, undoStudyAction } from '../src/study.js';
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
