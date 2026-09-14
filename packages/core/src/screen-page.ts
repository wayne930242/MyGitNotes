import { z } from 'zod';
import { StudyProgressionSchema } from './study-stages.js';

export const SCREEN_PAGE_FILE = '.github-notes-screen.yaml';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
const reference = { id, notebookId: z.string().min(1).max(128), path: repoPath };
export const ScreenItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...reference, kind: z.literal('note') }).strict(),
  z.object({ ...reference, kind: z.literal('folder') }).strict(),
  z.object({ ...reference, kind: z.literal('asset') }).strict(),
  z.object({ id, kind: z.literal('youtube'), videoId: z.string().regex(/^[\w-]{11}$/), start: z.number().int().min(0).max(86400).default(0), title: z.string().max(160).optional() }).strict(),
]);
const row = { id, name: z.string().trim().min(1).max(100), view: z.enum(['thumbnail', 'small', 'medium', 'reading', 'study']).transform(value => value === 'reading' || value === 'study' ? 'small' as const : value), progression: StudyProgressionSchema.optional(), study: z.object({ filter: z.enum(['all', 'due', 'future', 'paused']), dueFirst: z.boolean(), status: z.string().max(200).optional() }).strict().optional() };
export const ScreenRowSchema = z.discriminatedUnion('kind', [
  z.object({ ...row, kind: z.literal('custom'), items: z.array(ScreenItemSchema).max(100) }).strict(),
  z.object({ ...row, kind: z.literal('dynamic'), sort: z.object({
    field: z.enum(['updated', 'created', 'title', 'status']),
    order: z.enum(['asc', 'desc']),
  }).strict().optional(), source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tag'), tag: z.string().min(1).max(200), notebookId: z.string().min(1).max(128).optional() }).strict(),
    z.object({ kind: z.literal('folder'), notebookId: z.string().min(1).max(128), path: repoPath, recursive: z.boolean().default(true) }).strict(),
  ]) }).strict(),
]);
export const ScreenPageSchema = z.object({ version: z.literal(1), rows: z.array(ScreenRowSchema).max(40) }).strict()
  .superRefine((page, context) => {
    const ids = new Set<string>(); let items = 0;
    for (const row of page.rows) {
      const all = [row.id, ...(row.kind === 'custom' ? row.items.map(item => item.id) : [])];
      items += all.length - 1;
      for (const id of all) {
        if (ids.has(id)) context.addIssue({ code: 'custom', message: 'Duplicate Screen Page identity' });
        ids.add(id);
      }
    }
    if (items > 500) context.addIssue({ code: 'custom', message: 'Screen Page has too many pinned items' });
  });
export type ScreenItem = z.infer<typeof ScreenItemSchema>;
export type ScreenRow = z.infer<typeof ScreenRowSchema>;
export type ScreenPage = z.infer<typeof ScreenPageSchema>;
export const emptyScreenPage = (): ScreenPage => ({ version: 1, rows: [] });

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
  const item = source.items.find(item => item.id === itemId)!;
  const rows = page.rows.map(row => {
    if (row.kind !== 'custom') return row;
    const items = row.items.filter(item => item.id !== itemId);
    if (row.id === targetRowId) items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
    return { ...row, items };
  });
  return ScreenPageSchema.parse({ ...page, rows });
}

export function parseYouTubeUrl(value: string): { videoId: string; start: number } | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase(); let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.slice(1);
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      videoId = url.pathname === '/watch' ? url.searchParams.get('v') || '' : url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})\/?$/)?.[1] || '';
    }
    if (!/^[\w-]{11}$/.test(videoId)) return null;
    const time = url.searchParams.get('start') || url.searchParams.get('t') || '0';
    const match = time.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    const seconds = /^\d+$/.test(time) ? Number(time) : match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
    return { videoId, start: Math.min(seconds, 86400) };
  } catch { return null; }
}
