import { z } from 'zod';
import { createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs';
import { nextStudyStage, type StudyProgression, type Familiarity } from './study-stages.js';
import { splitNotePages } from './note-pages.js';

export const STUDY_FILE = '.github-notes-study.yaml';
export const STUDY_MAX_BYTES = 4 * 1024 * 1024;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const date = z.string().datetime();
const finite = z.number().finite().nonnegative();
const SchedulerSchema = z.object({
  due: date, stability: finite, difficulty: finite.max(10), elapsed_days: finite,
  scheduled_days: finite, learning_steps: finite.int(), reps: finite.int(), lapses: finite.int(),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), last_review: date.optional(),
}).strict();
export const StudyPolicySchema = z.object({
  retention: z.number().min(.7).max(.97), intervals: z.array(z.number().int().min(1).max(3650)).min(1).max(20),
}).strict().refine(value => value.intervals.every((days, i) => i === 0 || days >= value.intervals[i - 1]), 'Intervals must be nondecreasing.');
const schedule = { id, enabled: z.boolean(), suspended: z.boolean().default(false), policy: StudyPolicySchema, scheduler: SchedulerSchema };
const CardSchema = z.object({ ...schedule,
  kind: z.enum(['forward', 'reverse', 'cloze']), front: z.array(id).max(100), back: z.array(id).min(1).max(100),
  masks: z.array(z.object({ pageId: id, start: finite.int(), end: finite.int(), text: z.string().min(1) }).strict()
    .refine(mask => mask.end > mask.start, 'A mask requires a nonempty range.')).max(100).optional(),
}).strict();
const ReadingSchema = z.object({ due: date.optional(), lastRead: date.optional(), step: finite.int() }).strict();
const StageScheduleSchema = z.object({ laneId: id, status: z.string().max(200), due: date }).strict();
const NoteSchema = z.object({
  id, notebookId: z.string().min(1).max(128), path: z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid note path.'),
  sourceId: z.string().min(1).max(200).optional(), title: z.string().max(2000),
  pages: z.array(z.object({ id, source: z.string().max(1024 * 1024) }).strict()).min(1).max(100),
  cards: z.array(CardSchema).min(1).max(200), reading: ReadingSchema, stage: StageScheduleSchema.optional(),
}).strict();
const BeforeSchema = z.object({ stage: StageScheduleSchema.optional(), reading: ReadingSchema, cards: z.array(z.object(schedule).strict()).max(200) }).strict();
const EventSchema = z.object({
  id, noteId: id, cardId: id.optional(), at: date,
  kind: z.enum(['read', 'snooze', 'fixed', 'review', 'configure', 'suspend', 'resume', 'rebind', 'undo', 'stage-review', 'stage-read', 'stage-postpone']),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  transition: z.object({ laneId: id, fromStatus: z.string().max(200).nullable(), toStatus: z.string().max(200), intervalDays: z.number().finite().positive().max(3650) }).strict().optional(),
  algorithm: z.literal('ts-fsrs@5.4.2').optional(), before: BeforeSchema.optional(), undoOf: id.optional(),
}).strict();
export const StudyWorkspaceSchema = z.object({ version: z.literal(1), notes: z.array(NoteSchema).max(2000), events: z.array(EventSchema).max(50000) }).strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>(), paths = new Set<string>();
    const unique = (key: string) => { if (ids.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate study identity.' }); ids.add(key); };
    for (const note of value.notes) {
      unique(note.id);
      const key = JSON.stringify([note.notebookId, note.path]);
      if (paths.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate study note.' }); paths.add(key);
      const pages = new Map(note.pages.map(page => [page.id, page.source]));
      note.pages.forEach(page => unique(page.id));
      for (const card of note.cards) {
        unique(card.id);
        if (card.enabled && card.suspended) ctx.addIssue({ code: 'custom', message: 'A suspended card must be disabled.' });
        if ([...card.front, ...card.back].some(page => !pages.has(page))) ctx.addIssue({ code: 'custom', message: 'Unknown card page.' });
        for (const mask of card.masks || []) if (pages.get(mask.pageId)?.slice(mask.start, mask.end) !== mask.text) ctx.addIssue({ code: 'custom', message: 'Mask does not match its source.' });
      }
    }
    const notes = new Map(value.notes.map(note => [note.id, note]));
    for (const event of value.events) {
      unique(event.id);
      const note = notes.get(event.noteId);
      if (event.kind === 'review' ? !event.rating || !event.algorithm || !event.cardId : ['stage-review', 'stage-read'].includes(event.kind) ? !event.rating || !event.transition : event.rating !== undefined) ctx.addIssue({ code: 'custom', message: 'Review events require a rating, algorithm and card.' });
      if (!note || event.cardId && !note.cards.some(card => card.id === event.cardId)) ctx.addIssue({ code: 'custom', message: 'Unknown event target.' });
    }
  });

export type StudyWorkspace = z.infer<typeof StudyWorkspaceSchema>;
export type StudyNote = z.infer<typeof NoteSchema>;
export type StudyCard = z.infer<typeof CardSchema>;
export type StudyPolicy = z.infer<typeof StudyPolicySchema>;
export type StudyEvent = z.infer<typeof EventSchema>;
export interface StudySource { notebookId: string; path: string; title: string; content: string; metadata: { id?: unknown } }
export const emptyStudyWorkspace = (): StudyWorkspace => ({ version: 1, notes: [], events: [] });
const newId = () => globalThis.crypto.randomUUID();
const serializedCard = ({ last_review, ...card }: Card) => SchedulerSchema.parse({ ...card, due: card.due.toISOString(), ...(last_review ? { last_review: last_review.toISOString() } : {}) });

export function findStudyNote(workspace: StudyWorkspace, source: StudySource): StudyNote | undefined {
  const matches = workspace.notes.filter(note => note.notebookId === source.notebookId
    && (note.path === source.path || typeof source.metadata.id === 'string' && note.sourceId === source.metadata.id));
  return matches.length === 1 ? matches[0] : undefined;
}
export function createStudyNote(source: StudySource, now = new Date()): StudyNote {
  const pages = splitNotePages(source.content).map(source => ({ id: newId(), source }));
  return { id: newId(), notebookId: source.notebookId, path: source.path,
    ...(typeof source.metadata.id === 'string' ? { sourceId: source.metadata.id } : {}), title: source.title,
    pages, reading: { step: 0 }, cards: [{ id: newId(), kind: 'forward', enabled: false, suspended: false,
      front: pages.length > 1 ? [pages[0].id] : [], back: (pages.length > 1 ? pages.slice(1) : pages).map(page => page.id),
      policy: { retention: .9, intervals: [1, 3, 7, 14, 30] }, scheduler: serializedCard(createEmptyCard(now)),
    }] };
}

/** Exact unchanged sequences are unambiguous; reordered pages require unique content. */
export function reconcileStudyNote(note: StudyNote, source: StudySource): StudyNote | null {
  const pages = splitNotePages(source.content);
  if (pages.length !== note.pages.length || note.cards.some(card => !card.front.length) && source.title !== note.title) return null;
  const exact = pages.every((source, i) => source === note.pages[i].source);
  if (!exact && (new Set(pages).size !== pages.length || new Set(note.pages.map(page => page.source)).size !== pages.length)) return null;
  const mapped = pages.map(source => note.pages.find(page => page.source === source));
  if (!exact && mapped.some(page => !page)) return null;
  return { ...note, path: source.path, title: source.title, pages: exact ? note.pages : mapped as StudyNote['pages'] };
}
export function studyCardContent(note: StudyNote, card: StudyCard, face: 'front' | 'back'): string[] {
  const ids = card[face];
  if (!ids.length) return [note.title];
  return ids.map(id => note.pages.find(page => page.id === id)!.source);
}
export function studyDue(note: StudyNote): string | undefined {
  if (note.stage) return note.stage.due;
  const due = [...note.cards.filter(card => card.enabled).map(card => card.scheduler.due), ...(note.reading.due ? [note.reading.due] : [])];
  return due.sort()[0];
}
export function matchesStudyFilter(note: StudyNote | undefined, filter: 'all' | 'due' | 'future' | 'paused', now = new Date()): boolean {
  if (filter === 'all') return true;
  if (!note) return false;
  const due = studyDue(note);
  if (filter === 'paused') return note.cards.some(card => card.suspended);
  return Boolean(due && (filter === 'due' ? Date.parse(due) <= now.getTime() : Date.parse(due) > now.getTime()));
}
export function previewStudyRating(card: StudyCard, rating: Grade, now = new Date()) {
  return serializedCard(fsrs({ request_retention: card.policy.retention, enable_fuzz: false })
    .next(card.scheduler, now, rating).card);
}
type Action = { kind: 'review'; rating: Grade } | { kind: 'read' | 'snooze'; due: string }
  | { kind: 'fixed' | 'suspend' | 'resume' } | { kind: 'configure'; policy: StudyPolicy };

export function applyStudyAction(workspace: StudyWorkspace, note: StudyNote, cardId: string, action: Action, now = new Date()): StudyWorkspace {
  const next = structuredClone(note), card = next.cards.find(card => card.id === cardId);
  if (!card) throw new Error('Unknown study card.');
  const before = { ...(note.stage ? { stage: note.stage } : {}), reading: note.reading, cards: note.cards.map(({ id, enabled, suspended, policy, scheduler }) => ({ id, enabled, suspended, policy, scheduler })) };
  const at = now.toISOString();
  switch (action.kind) {
    case 'review':
      if (card.scheduler.last_review && Date.parse(card.scheduler.last_review) > now.getTime()) throw new Error('The review time precedes the previous review.');
      card.scheduler = previewStudyRating(card, action.rating, now); card.enabled = true; card.suspended = false; break;
    case 'read': case 'snooze':
      if (Date.parse(date.parse(action.due)) <= now.getTime()) throw new Error('Choose a future time.');
      next.reading.due = action.due;
      if (action.kind === 'read') next.reading.lastRead = at;
      break;
    case 'fixed': {
      const days = card.policy.intervals[Math.min(next.reading.step, card.policy.intervals.length - 1)];
      const due = new Date(now); due.setDate(due.getDate() + days);
      next.reading = { step: next.reading.step + 1, due: due.toISOString(), lastRead: at }; break;
    }
    case 'suspend': card.enabled = false; card.suspended = true; break;
    case 'resume': card.enabled = true; card.suspended = false; break;
    case 'configure': card.policy = StudyPolicySchema.parse(action.policy); break;
  }
  const event: StudyEvent = { id: newId(), noteId: note.id, cardId, at, kind: action.kind, before,
    ...(action.kind === 'review' ? { rating: action.rating, algorithm: 'ts-fsrs@5.4.2' } : {}) };
  return StudyWorkspaceSchema.parse({ ...workspace, notes: [...workspace.notes.filter(value => value.id !== note.id), next], events: [...workspace.events, event] });
}
export function undoStudyAction(workspace: StudyWorkspace, now = new Date()): StudyWorkspace {
  const event = workspace.events.at(-1);
  if (!event?.before || event.kind === 'undo') throw new Error('No study action to undo.');
  return StudyWorkspaceSchema.parse({ ...workspace, notes: workspace.notes.map(note => note.id !== event.noteId ? note : {
    ...note, stage: event.before!.stage, reading: event.before!.reading, cards: note.cards.map(card => ({ ...card, ...event.before!.cards.find(value => value.id === card.id) })),
  }), events: [...workspace.events, { id: newId(), noteId: event.noteId, at: now.toISOString(), kind: 'undo', undoOf: event.id }] });
}

/** Rebinding is explicit: preserve card identity/history and choose whether to reset memory. */
export function rebindStudyNote(workspace: StudyWorkspace, note: StudyNote, source: StudySource, reset: boolean, now = new Date()): StudyWorkspace {
  if (note.cards.length !== 1 || note.cards[0].kind !== 'forward') throw new Error('This note requires the multi-card mapping editor.');
  const fresh = createStudyNote(source, now);
  fresh.id = note.id; fresh.reading = note.reading; if (note.stage) fresh.stage = note.stage;
  fresh.cards[0] = { ...fresh.cards[0], id: note.cards[0].id, enabled: note.cards[0].enabled, suspended: note.cards[0].suspended, policy: note.cards[0].policy,
    scheduler: reset ? fresh.cards[0].scheduler : note.cards[0].scheduler };
  return StudyWorkspaceSchema.parse({ ...workspace, notes: workspace.notes.map(value => value.id === note.id ? fresh : value),
    events: [...workspace.events, { id: newId(), noteId: note.id, at: now.toISOString(), kind: 'rebind' }] });
}

export function applyStageAction(workspace: StudyWorkspace, note: StudyNote, laneId: string, status: string | undefined,
  progression: StudyProgression, action: { kind: 'stage-review' | 'stage-read'; rating: Familiarity } | { kind: 'stage-postpone'; due: string }, now = new Date()): StudyWorkspace {
  const stage = action.kind === 'stage-postpone' ? { status: status || progression.stages[0].status, intervalDays: (Date.parse(action.due) - now.getTime()) / 86400000 }
    : nextStudyStage(progression, status, action.rating);
  const due = action.kind === 'stage-postpone' ? action.due : new Date(now.getTime() + stage.intervalDays * 86400000).toISOString();
  if (!Number.isFinite(Date.parse(due)) || Date.parse(due) <= now.getTime()) throw new Error('Choose a future time.');
  const next = structuredClone(note);
  next.stage = { laneId, status: stage.status, due };
  const before = { ...(note.stage ? { stage: note.stage } : {}), reading: note.reading, cards: note.cards.map(({ id, enabled, suspended, policy, scheduler }) => ({ id, enabled, suspended, policy, scheduler })) };
  const event = { id: newId(), noteId: note.id, cardId: note.cards[0].id, at: now.toISOString(), kind: action.kind, before,
    transition: { laneId, fromStatus: status ?? null, toStatus: stage.status, intervalDays: stage.intervalDays },
    ...(action.kind === 'stage-postpone' ? {} : { rating: action.rating }) };
  return StudyWorkspaceSchema.parse({ ...workspace, notes: [...workspace.notes.filter(value => value.id !== note.id), next], events: [...workspace.events, event] });
}
