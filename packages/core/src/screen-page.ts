import { z } from 'zod';
import { StudyProgressionSchema } from './study-stages.js';
import { isNoteHidden } from './note-status.js';
import type { NoteItem } from './types.js';
import type { WorkspaceDocument } from './workspace-documents.js';

export const SCREEN_PAGE_FILE = '.github-notes-screen.yaml';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
/* eslint-enable no-control-regex */
const notebookId = z.string().min(1).max(128);
const reference = { id, notebookId, path: repoPath };
export const ScreenItemSchema = z.discriminatedUnion('kind', [z.object({ ...reference, kind: z.literal('note') }).strict(), z.object({ ...reference, kind: z.literal('folder') }).strict(), z.object({ ...reference, kind: z.literal('asset') }).strict(), z.object({ id, kind: z.literal('youtube'), videoId: z.string().regex(/^[\w-]{11}$/), start: z.number().int().min(0).max(86400).default(0), title: z.string().max(160).optional() }).strict()]);
export const GraphLayoutSchema = z.object({ nodes: z.array(z.object({ path: repoPath, x: z.number().finite().min(-1e7).max(1e7), y: z.number().finite().min(-1e7).max(1e7), width: z.number().min(240).max(1600).optional(), height: z.number().min(180).max(1400).optional(), expanded: z.boolean().optional(), pinned: z.boolean().optional() }).strict()).max(5000) }).strict();
export type GraphLayout = z.infer<typeof GraphLayoutSchema>;
const row = { id, name: z.string().trim().min(1).max(100), view: z.enum(['thumbnail', 'small', 'medium', 'graph', 'reading', 'study']).transform(value => value === 'reading' || value === 'study' ? 'small' as const : value), graph: GraphLayoutSchema.optional(), progression: StudyProgressionSchema.optional(), study: z.object({ filter: z.enum(['all', 'due', 'future', 'paused']), dueFirst: z.boolean(), status: z.string().max(200).optional() }).strict().optional() };
const sort = z.object({ field: z.enum(['updated', 'created', 'title', 'status']), order: z.enum(['asc', 'desc']) }).strict().optional();
const tagSource = z.object({ kind: z.literal('tag'), tag: z.string().min(1).max(200), notebookId }).strict();
const folderSource = z.object({ kind: z.literal('folder'), notebookId, path: repoPath, recursive: z.boolean().default(true) }).strict();
const items = z.array(ScreenItemSchema).max(100);
/** Every lane belongs to one notebook; its pinned items and dynamic source stay inside it. */
export const ScreenRowSchema = z.discriminatedUnion('kind', [z.object({ ...row, notebookId, kind: z.literal('custom'), items }).strict(), z.object({ ...row, notebookId, kind: z.literal('dynamic'), sort, source: z.discriminatedUnion('kind', [tagSource, folderSource]) }).strict()]);
export const ScreenPageSchema = z.object({ version: z.literal(2), rows: z.array(ScreenRowSchema).max(40) }).strict().superRefine((page, context) => {
  const ids = new Set<string>();
  let items = 0;
  for (const row of page.rows) {
    const all = [row.id, ...(row.kind === 'custom' ? row.items.map(item => item.id) : [])];
    items += all.length - 1;
    for (const id of all) {
      if (ids.has(id)) context.addIssue({ code: 'custom', message: 'Duplicate Screen Page identity' });
      ids.add(id);
    }
    const contents = row.kind === 'custom' ? row.items.flatMap(item => item.kind === 'youtube' ? [] : [item.notebookId]) : [row.source.notebookId];
    if (contents.some(value => value !== row.notebookId)) context.addIssue({ code: 'custom', message: 'Screen lane content must belong to the lane notebook' });
  }
  if (items > 500) context.addIssue({ code: 'custom', message: 'Screen Page has too many pinned items' });
});
/** Version 1 lanes had no owner notebook and could mix notebooks. */
const LegacyScreenPageSchema = z.object({ version: z.literal(1), rows: z.array(z.discriminatedUnion('kind', [z.object({ ...row, kind: z.literal('custom'), items }).strict(), z.object({ ...row, kind: z.literal('dynamic'), sort, source: z.discriminatedUnion('kind', [tagSource.extend({ notebookId: notebookId.optional() }), folderSource]) }).strict()])).max(40) }).strict();
/** Validates a stored file of either version without migrating it. */
export const ScreenPageFileSchema = z.union([ScreenPageSchema, LegacyScreenPageSchema]);
export type ScreenItem = z.infer<typeof ScreenItemSchema>;
export type ScreenRow = z.infer<typeof ScreenRowSchema>;
export type ScreenPage = z.infer<typeof ScreenPageSchema>;
export interface ScreenNotebookConfig {
  workspace: { default_notebook: string; };
  notebooks: { id: string; }[];
}
export const emptyScreenPage = (): ScreenPage => ({ version: 2, rows: [] });

/** Parse a stored Screen Page, migrating version 1 lanes into their notebooks. */
export function readScreenPage(value: unknown, config: ScreenNotebookConfig | null): ScreenPage {
  const page = ScreenPageFileSchema.parse(value);
  if (page.version === 2) return page;
  const fallback = config?.workspace.default_notebook || config?.notebooks[0]?.id;
  const used = new Set(page.rows.flatMap(row => [row.id, ...(row.kind === 'custom' ? row.items.map(item => item.id) : [])]));
  const unique = (base: string) => {
    const clean = base.replace(/[^a-zA-Z0-9_-]/g, '-');
    let candidate = clean.slice(0, 64);
    for (let suffix = 2; used.has(candidate); suffix++) candidate = `${clean.slice(0, 63 - String(suffix).length)}-${suffix}`;
    used.add(candidate);
    return candidate;
  };
  const rows = page.rows.flatMap<unknown>(row => {
    if (row.kind === 'dynamic') {
      const owner = row.source.notebookId || fallback;
      return [{ ...row, notebookId: owner, source: { ...row.source, notebookId: owner } }];
    }
    const groups = new Map<string, ScreenItem[]>();
    for (const item of row.items) if (item.kind !== 'youtube') groups.set(item.notebookId, [...(groups.get(item.notebookId) || []), item]);
    const [first = fallback, ...rest] = groups.keys();
    return [{ ...row, notebookId: first, items: row.items.filter(item => item.kind === 'youtube' || item.notebookId === first) }, ...rest.map(owner => ({ ...row, id: unique(`${row.id}-${owner}`), notebookId: owner, items: groups.get(owner)! }))];
  });
  return ScreenPageSchema.parse({ version: 2, rows });
}

export const SCREEN_DOCUMENT: WorkspaceDocument<ScreenPage> = {
  file: SCREEN_PAGE_FILE,
  label: 'Screen',
  maxBytes: 512 * 1024,
  scopes: ['screen', 'folders', 'files'],
  schema: ScreenPageSchema,
  fileSchema: ScreenPageFileSchema,
  empty: emptyScreenPage,
  read: readScreenPage,
  relocate(page, notebookId, move) {
    let changed = false;
    const update = (item: { path: string; }) => {
      const next = move(item.path);
      if (next !== item.path) {
        item.path = next;
        changed = true;
      }
    };
    for (const row of page.rows) {
      if (row.kind === 'custom') { for (const item of row.items) if (item.kind !== 'youtube' && item.notebookId === notebookId) update(item); }
      else if (row.source.kind === 'folder' && row.source.notebookId === notebookId) update(row.source);
      if (row.notebookId === notebookId) { for (const node of row.graph?.nodes || []) update(node); }
    }
    return changed;
  },
};

/** Membership is shared by lane cards and graph views; folder shortcuts stay shortcuts. */
export function screenRowNotes(row: ScreenRow, notes: NoteItem[]): NoteItem[] {
  return notes.filter(note => {
    if (row.study?.status && note.status !== row.study.status) return false;
    if (note.notebookId !== row.notebookId) return false;
    if (row.kind === 'custom') return row.items.some(item => item.kind === 'note' && item.path === note.path && item.notebookId === note.notebookId);
    const source = row.source;
    if (isNoteHidden({ ...note.metadata, status: note.status })) return false;
    if (source.kind === 'tag') return note.tags.includes(source.tag);
    return note.path.startsWith(source.path + '/') && (source.recursive || !note.path.slice(source.path.length + 1).includes('/'));
  });
}
export function screenRowNotePaths(row: ScreenRow, notes: NoteItem[]): string[] {
  return screenRowNotes(row, notes).map(note => note.path);
}

export function moveScreenRow(page: ScreenPage, rowId: string, index: number): ScreenPage {
  const selected = page.rows.find(row => row.id === rowId);
  if (!selected) throw new Error('Unknown swimlane');
  const rows = page.rows.filter(row => row.id !== rowId);
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, selected);
  return ScreenPageSchema.parse({ ...page, rows });
}

export function moveScreenItem(page: ScreenPage, itemId: string, targetRowId: string, index: number): ScreenPage {
  const source = page.rows.find(row => row.kind === 'custom' && row.items.some(item => item.id === itemId));
  const target = page.rows.find(row => row.id === targetRowId);
  if (source?.kind !== 'custom' || target?.kind !== 'custom') throw new Error('Only custom swimlanes accept moved items');
  if (source.notebookId !== target.notebookId) throw new Error('Items stay inside their notebook');
  const item = source.items.find(item => item.id === itemId)!;
  const rows = page.rows.map(row => {
    if (row.kind !== 'custom') return row;
    const items = row.items.filter(item => item.id !== itemId);
    if (row.id === targetRowId) items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
    return { ...row, items };
  });
  return ScreenPageSchema.parse({ ...page, rows });
}

export function parseYouTubeUrl(value: string): { videoId: string; start: number; } | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      videoId = url.pathname === '/watch' ? url.searchParams.get('v') || '' : url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/)?.[1] || '';
    }
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    const time = url.searchParams.get('start') || url.searchParams.get('t') || '0';
    const match = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    const seconds = /^\d+$/.test(time) ? Number(time) : match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
    return { videoId, start: Math.min(seconds, 86400) };
  } catch {
    return null;
  }
}
