import { z } from 'zod';

export const StudyProgressionSchema = z.object({
  stages: z.array(z.object({ status: z.string().trim().min(1).max(200), intervalDays: z.number().finite().min(1 / 1440).max(3650) }).strict()).min(1).max(20),
  easy: z.enum(['two', 'last']).default('two'),
}).strict().refine(value => new Set(value.stages.map(stage => stage.status)).size === value.stages.length, 'Stage statuses must be unique.');
export type StudyProgression = z.infer<typeof StudyProgressionSchema>;
export type Familiarity = 1 | 2 | 3 | 4;

export function nextStudyStage(progression: StudyProgression, status: string | undefined, rating: Familiarity) {
  const plan = StudyProgressionSchema.parse(progression);
  const current = Math.max(0, plan.stages.findIndex(stage => stage.status === status));
  const index = rating === 1 ? 0 : rating === 2 ? current : rating === 3 ? current + 1
    : plan.easy === 'last' ? plan.stages.length - 1 : current + 2;
  return plan.stages[Math.min(index, plan.stages.length - 1)];
}

export function defaultStudyProgression(statuses: string[]): StudyProgression {
  const values = [...new Set(statuses)].slice(0, 20);
  return { stages: (values.length ? values : ['inbox', 'working', 'done', 'archived']).map((status, index) => ({
    status, intervalDays: [1, 3, 7, 14, 30][Math.min(index, 4)],
  })), easy: 'two' };
}

export const StudyLaneActionSchema = z.object({
  laneId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), notebookId: z.string().min(1).max(128),
  path: z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..')),
  revision: z.string().min(1), expected: z.object({ content: z.string().max(5 * 1024 * 1024), metadata: z.record(z.unknown()) }).strict(),
  action: z.enum(['stage-review', 'stage-read', 'stage-postpone', 'undo']),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  due: z.string().datetime().optional(), eventId: z.string().optional(),
}).strict();
