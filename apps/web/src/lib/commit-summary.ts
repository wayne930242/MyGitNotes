import type { TranslationKey } from './i18n/index.js';
import type { NoteItem } from './types.js';

/** What one note's draft changed against its committed version, read from its structure rather than its raw diff. */
export interface NoteChangeFacts {
  path: string;
  title: string;
  added: boolean;
  titleFrom?: string;
  statusFrom?: string;
  statusTo?: string;
  tagsAdded: string[];
  tagsRemoved: string[];
  sectionsAdded: string[];
  sectionsRemoved: string[];
  tasksDone: number;
  tasksReopened: number;
  tasksAdded: number;
  /** Words (or CJK characters) the body gained, negative when it shrank. */
  textDelta: number;
}

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;
const TASK = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/;

function headings(content: string): string[] {
  let fenced = false;
  const found: string[] = [];
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const match = HEADING.exec(line);
      if (match) found.push(match[1]);
    }
  }
  return found;
}

function tasks(content: string): Map<string, boolean> {
  const found = new Map<string, boolean>();
  for (const line of content.split('\n')) {
    const match = TASK.exec(line);
    if (match) found.set(match[2], match[1] !== ' ');
  }
  return found;
}

/** Counts a CJK character as one word, since those scripts do not separate words with spaces. */
export function textSize(content: string): number {
  const cjk = content.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g)?.length ?? 0;
  const words = content.replace(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  return cjk + words;
}

const minus = <T>(items: T[], other: T[]) => items.filter(item => !other.includes(item));

export function noteChangeFacts(note: NoteItem, base: NoteItem | null): NoteChangeFacts {
  const before = base ?? { title: '', status: undefined, tags: [], content: '' };
  const beforeTasks = tasks(before.content), afterTasks = tasks(note.content);
  let tasksDone = 0, tasksReopened = 0, tasksAdded = 0;
  for (const [text, done] of afterTasks) {
    const was = beforeTasks.get(text);
    if (was === undefined) tasksAdded++;
    else if (done && !was) tasksDone++;
    else if (!done && was) tasksReopened++;
  }
  const beforeHeadings = headings(before.content), afterHeadings = headings(note.content);
  return { path: note.path, title: note.title || note.path.split('/').pop() || note.path, added: !base, titleFrom: base && base.title !== note.title ? base.title : undefined, statusFrom: base && base.status !== note.status ? base.status : undefined, statusTo: base && base.status !== note.status ? note.status : undefined, tagsAdded: base ? minus(note.tags, before.tags) : [], tagsRemoved: base ? minus(before.tags, note.tags) : [], sectionsAdded: base ? minus(afterHeadings, beforeHeadings) : [], sectionsRemoved: base ? minus(beforeHeadings, afterHeadings) : [], tasksDone, tasksReopened, tasksAdded: base ? tasksAdded : 0, textDelta: textSize(note.content) - textSize(before.content) };
}

/** The phrases that describe one note's change, most telling first. */
export function changePhrases(facts: NoteChangeFacts, t: Translate): string[] {
  if (facts.added) return [t('commitSummary.created')];
  const phrases: string[] = [];
  if (facts.titleFrom !== undefined) phrases.push(t('commitSummary.renamed', { from: facts.titleFrom }));
  if (facts.statusFrom !== undefined || facts.statusTo !== undefined) phrases.push(t('commitSummary.status', { from: facts.statusFrom || '—', to: facts.statusTo || '—' }));
  if (facts.tasksDone) phrases.push(t('commitSummary.tasksDone', { count: facts.tasksDone }));
  if (facts.tasksReopened) phrases.push(t('commitSummary.tasksReopened', { count: facts.tasksReopened }));
  if (facts.tasksAdded) phrases.push(t('commitSummary.tasksAdded', { count: facts.tasksAdded }));
  const quoted = (items: string[]) => items.map(text => t('commitSummary.quoted', { text })).join(separator(t));
  if (facts.sectionsAdded.length) phrases.push(t('commitSummary.sectionsAdded', { sections: quoted(facts.sectionsAdded) }));
  if (facts.sectionsRemoved.length) phrases.push(t('commitSummary.sectionsRemoved', { sections: quoted(facts.sectionsRemoved) }));
  if (facts.tagsAdded.length) phrases.push(t('commitSummary.tagsAdded', { tags: facts.tagsAdded.join(', ') }));
  if (facts.tagsRemoved.length) phrases.push(t('commitSummary.tagsRemoved', { tags: facts.tagsRemoved.join(', ') }));
  if (!phrases.length || Math.abs(facts.textDelta) >= 20) {
    phrases.push(facts.textDelta > 0 ? t('commitSummary.textAdded', { count: facts.textDelta }) : facts.textDelta < 0 ? t('commitSummary.textRemoved', { count: -facts.textDelta }) : t('commitSummary.textEdited'));
  }
  return phrases;
}

export interface CommitSummary {
  /** One line naming what changed, kept to a commit subject's length. */
  subject: string;
  /** A line per note, then machine-readable trailers a history view can read without parsing diffs. */
  details: string;
}

const SUBJECT_LIMIT = 72;
const clip = (text: string) => text.length <= SUBJECT_LIMIT ? text : `${text.slice(0, SUBJECT_LIMIT - 1)}…`;
const separator = (t: Translate) => t('commitSummary.separator');

/** Describes a commit of note drafts and workspace documents in the visitor's language. */
export function summarizeCommit(notes: NoteChangeFacts[], documents: string[], t: Translate): CommitSummary {
  const fileName = (path: string) => path.split('/').pop() || path;
  let subject: string;
  if (notes.length === 1 && !documents.length) {
    const [facts] = notes;
    subject = facts.added ? t('commitSummary.subjectCreated', { title: facts.title }) : `${facts.title}${t('commitSummary.colon')}${changePhrases(facts, t).slice(0, 2).join(separator(t))}`;
  } else if (!notes.length && documents.length === 1) subject = t('commitSummary.subjectDocument', { name: fileName(documents[0]) });
  else {
    const created = notes.filter(facts => facts.added).length;
    const names = [...notes.map(facts => facts.title), ...documents.map(fileName)];
    const listed = names.slice(0, 3).join(separator(t)) + (names.length > 3 ? t('commitSummary.andMore', { count: names.length - 3 }) : '');
    subject = created === notes.length && !documents.length ? t('commitSummary.subjectCreatedMany', { count: created, names: listed }) : t('commitSummary.subjectMany', { count: names.length, names: listed });
  }
  const lines = [...notes.map(facts => `- ${facts.title}${t('commitSummary.colon')}${changePhrases(facts, t).join(separator(t))}`), ...documents.map(path => `- ${fileName(path)}${t('commitSummary.colon')}${t('commitSummary.documentUpdated')}`)];
  const trailers = [...notes.map(facts => `${facts.added ? 'Note-Added' : 'Note-Modified'}: ${facts.path}`), ...documents.map(path => `Document-Modified: ${path}`)];
  return { subject: clip(subject), details: `${lines.join('\n')}\n\n${trailers.join('\n')}` };
}

/** The longest message the repository source accepts. */
const MESSAGE_LIMIT = 4000;

/**
 * The full commit message: the subject as the visitor left it, then the generated details, cut at a line
 * boundary when a very large commit would pass the source's message limit.
 */
export function commitMessage(subject: string, details: string): string {
  const head = subject.trim();
  if (!details) return head;
  const full = `${head}\n\n${details}`;
  if (full.length <= MESSAGE_LIMIT) return full;
  const kept = full.slice(0, MESSAGE_LIMIT - 2);
  return `${kept.slice(0, kept.lastIndexOf('\n'))}\n…`;
}
