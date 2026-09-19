import { z } from 'zod';
import { DEFAULT_NOTE_STATUSES, resolveNoteStatuses } from './note-status.js';
import type { ScreenRow } from './screen-page.js';
import type { NotebookConfig } from './types.js';

export const StudyProgressionSchema = z.object({ stages: z.array(z.object({ status: z.string().trim().min(1).max(200), intervalDays: z.number().finite().min(1 / 1440).max(3650) }).strict()).min(1).max(20), easy: z.enum(['two', 'last']).default('two') }).strict().refine(value => new Set(value.stages.map(stage => stage.status)).size === value.stages.length, 'Stage statuses must be unique.');
export type StudyProgression = z.infer<typeof StudyProgressionSchema>;
export type Familiarity = 1 | 2 | 3 | 4;

export function nextStudyStage(progression: StudyProgression, status: string | undefined, rating: Familiarity) {
  const plan = StudyProgressionSchema.parse(progression);
  const current = Math.max(0, plan.stages.findIndex(stage => stage.status === status));
  const index = rating === 1 ? 0 : rating === 2 ? current : rating === 3 ? current + 1 : plan.easy === 'last' ? plan.stages.length - 1 : current + 2;
  return plan.stages[Math.min(index, plan.stages.length - 1)];
}

export interface StudyRatingOption {
  rating: Familiarity;
  targetIndex: number;
  targetStage: { status: string; intervalDays: number; };
  starCount: number;
  totalStages: number;
}

export function deduplicatedStudyRatings(progression: StudyProgression, status: string | undefined): StudyRatingOption[] {
  const plan = StudyProgressionSchema.parse(progression);
  const stages = plan.stages;
  const current = Math.max(0, stages.findIndex(stage => stage.status === status));
  const total = stages.length;

  const rawRatings: { rating: Familiarity; targetIndex: number; }[] = [{ rating: 1, targetIndex: 0 }, { rating: 2, targetIndex: current }, { rating: 3, targetIndex: Math.min(current + 1, total - 1) }, { rating: 4, targetIndex: Math.min(plan.easy === 'last' ? total - 1 : current + 2, total - 1) }];

  const chosenByTarget = new Map<number, Familiarity>();
  for (const { rating, targetIndex } of rawRatings) {
    if (!chosenByTarget.has(targetIndex)) {
      chosenByTarget.set(targetIndex, rating);
    } else {
      if (targetIndex === 0 && rating === 1) {
        chosenByTarget.set(targetIndex, 1);
      } else if (targetIndex === total - 1 && current === total - 1) {
        if (rating === 3) chosenByTarget.set(targetIndex, 3);
      } else if (targetIndex > current) {
        if (rating === 3) chosenByTarget.set(targetIndex, 3);
      }
    }
  }

  return Array.from(chosenByTarget.entries()).sort(([a], [b]) => a - b).map(([targetIndex, rating]) => ({ rating, targetIndex, targetStage: stages[targetIndex], starCount: targetIndex + 1, totalStages: total }));
}

/** A lane uses the statuses of the notebook it belongs to. */
export function studyLaneStatuses(lane: ScreenRow, notebooks: Pick<NotebookConfig, 'id' | 'statuses'>[]): string[] {
  return [...new Set(notebooks.filter(notebook => notebook.id === lane.notebookId).flatMap(notebook => resolveNoteStatuses(notebook)))];
}

/** Defaults are editable starting intervals, with no implicit archival transition. */
export function defaultStudyProgression(statuses: string[]): StudyProgression | undefined {
  const values = [...new Set(statuses.length ? statuses : DEFAULT_NOTE_STATUSES)].filter(status => status !== 'archived').slice(0, 20);
  if (!values.length) return undefined;
  return { stages: values.map((status, index) => ({ status, intervalDays: [1, 3, 7, 14, 30][Math.min(index, 4)] })), easy: 'two' };
}

/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
export const StudyLaneActionSchema = z.object({ laneId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), notebookId: z.string().min(1).max(128), path: z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')), revision: z.string().min(1), expected: z.object({ content: z.string().max(5 * 1024 * 1024), metadata: z.record(z.unknown()) }).strict(), action: z.enum(['stage-review', 'stage-read', 'stage-postpone', 'undo']), rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(), due: z.string().datetime().optional(), eventId: z.string().optional() }).strict();
/* eslint-enable no-control-regex */
