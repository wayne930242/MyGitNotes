import { z } from 'zod';
import { StudyProgressionSchema } from './study-stages.js';
import { type CompilationItem, CompilationItemSchema, GraphLayoutSchema } from './compilation.js';
import type { WorkspaceDocument } from './workspace-documents.js';

export const SCREEN_PAGE_FILE = '.github-notes-screen.yaml';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
/* eslint-enable no-control-regex */
const notebookId = z.string().min(1).max(128);
const row = { id, name: z.string().trim().min(1).max(100), view: z.enum(['thumbnail', 'small', 'medium', 'graph', 'reading', 'study']).transform(value => value === 'reading' || value === 'study' ? 'small' as const : value), graph: GraphLayoutSchema.optional(), progression: StudyProgressionSchema.optional(), study: z.object({ filter: z.enum(['all', 'due', 'future', 'paused']), dueFirst: z.boolean(), status: z.string().max(200).optional() }).strict().optional() };
const sort = z.object({ field: z.enum(['updated', 'created', 'title', 'status']), order: z.enum(['asc', 'desc']) }).strict().optional();
const tagSource = z.object({ kind: z.literal('tag'), tag: z.string().min(1).max(200), notebookId }).strict();
const folderSource = z.object({ kind: z.literal('folder'), notebookId, path: repoPath, recursive: z.boolean().default(true) }).strict();
const items = z.array(CompilationItemSchema).max(100);
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
    const groups = new Map<string, CompilationItem[]>();
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

export function moveScreenRow(page: ScreenPage, rowId: string, index: number): ScreenPage {
  const selected = page.rows.find(row => row.id === rowId);
  if (!selected) throw new Error('Unknown swimlane');
  const rows = page.rows.filter(row => row.id !== rowId);
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, selected);
  return ScreenPageSchema.parse({ ...page, rows });
}
