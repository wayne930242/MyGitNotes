import YAML from 'yaml';
import { z } from 'zod';
import { type StudyProgression, StudyProgressionSchema } from './study-stages.js';
import { isNoteHidden } from './note-status.js';

/** The workspace `schema_version` that replaced the Screen file with compilation files. */
export const COMPILATION_SCHEMA_VERSION = 3;

/** A compilation is a note-shaped file inside a notebook: `<name>.compilation.yml`. */
export const COMPILATION_SUFFIX = '.compilation.yml';
export const COMPILATION_MAX_BYTES = 512 * 1024;
export const COMPILATION_MAX_ITEMS = 100;
export const isCompilationPath = (file: string) => file.endsWith(COMPILATION_SUFFIX);

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
/* eslint-disable no-control-regex -- Reject control characters in persisted paths, identifiers or filenames. */
const repoPath = z.string().min(1).max(2048).refine(value => !/[\\\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Invalid workspace path');
/* eslint-enable no-control-regex */
const notebookId = z.string().min(1).max(128);
const videoId = z.string().regex(/^[\w-]{11}$/);
const start = z.number().int().min(0).max(86400).default(0);
const videoTitle = z.string().max(160).optional();

export const GraphLayoutSchema = z.object({ nodes: z.array(z.object({ path: repoPath, x: z.number().finite().min(-1e7).max(1e7), y: z.number().finite().min(-1e7).max(1e7), width: z.number().min(240).max(1600).optional(), height: z.number().min(180).max(1400).optional(), expanded: z.boolean().optional(), pinned: z.boolean().optional() }).strict()).max(5000) }).strict();
export type GraphLayout = z.infer<typeof GraphLayoutSchema>;

const reference = { id, notebookId, path: repoPath };
/** An item as the browser holds it: file references plus the owning notebook. */
export const CompilationItemSchema = z.discriminatedUnion('kind', [z.object({ ...reference, kind: z.literal('note') }).strict(), z.object({ ...reference, kind: z.literal('folder') }).strict(), z.object({ ...reference, kind: z.literal('asset') }).strict(), z.object({ id, kind: z.literal('youtube'), videoId, start, title: videoTitle }).strict()]);
export type CompilationItem = z.infer<typeof CompilationItemSchema>;

const fileReference = { id, path: repoPath };
const FileItemSchema = z.discriminatedUnion('kind', [z.object({ ...fileReference, kind: z.literal('note') }).strict(), z.object({ ...fileReference, kind: z.literal('folder') }).strict(), z.object({ ...fileReference, kind: z.literal('asset') }).strict(), z.object({ id, kind: z.literal('youtube'), videoId, start, title: videoTitle }).strict()]);
const FileSourceSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('tag'), tag: z.string().min(1).max(200) }).strict(), z.object({ kind: z.literal('folder'), path: repoPath, recursive: z.boolean().default(true) }).strict()]);
const SortSchema = z.object({ field: z.enum(['updated', 'created', 'title', 'status']), order: z.enum(['asc', 'desc']) }).strict();
const StudySchema = z.object({ filter: z.enum(['all', 'due', 'future', 'paused']), dueFirst: z.boolean(), status: z.string().max(200).optional() }).strict();
const tag = z.string().trim().min(1).max(200);

export const COMPILATION_ARRANGEMENTS = ['lane', 'stack', 'graph'] as const;
export const COMPILATION_SIZES = ['thumbnail', 'small', 'medium'] as const;

/** The stored file; it never repeats the notebook, which the path decides. */
export const CompilationFileSchema = z.object({ version: z.literal(1), id, title: z.string().trim().min(1).max(100), arrangement: z.enum(COMPILATION_ARRANGEMENTS), size: z.enum(COMPILATION_SIZES).optional(), tags: z.array(tag).max(100).optional(), status: z.string().trim().min(1).max(200).optional(), items: z.array(FileItemSchema).max(COMPILATION_MAX_ITEMS).optional(), source: FileSourceSchema.optional(), sort: SortSchema.optional(), study: StudySchema.optional(), progression: StudyProgressionSchema.optional(), graph: GraphLayoutSchema.optional() }).strict().superRefine((file, context) => {
  if ((file.items === undefined) === (file.source === undefined)) context.addIssue({ code: 'custom', message: 'Give exactly one of items or source', path: ['items'] });
  if (file.sort && !file.source) context.addIssue({ code: 'custom', message: 'sort applies to a source', path: ['sort'] });
  const ids = new Set<string>();
  for (const item of file.items ?? []) {
    if (ids.has(item.id)) context.addIssue({ code: 'custom', message: `Duplicate item id ${item.id}`, path: ['items'] });
    ids.add(item.id);
  }
});
export type CompilationFile = z.infer<typeof CompilationFileSchema>;
export type CompilationFileItem = z.infer<typeof FileItemSchema>;

export type CompilationView = 'thumbnail' | 'small' | 'medium' | 'graph' | 'stack';
export const COMPILATION_VIEWS: readonly CompilationView[] = ['thumbnail', 'small', 'medium', 'graph', 'stack'];
export interface CompilationStudy {
  filter: 'all' | 'due' | 'future' | 'paused';
  dueFirst: boolean;
  status?: string;
}
export interface CompilationSort {
  field: 'updated' | 'created' | 'title' | 'status';
  order: 'asc' | 'desc';
}
interface CompilationRowBase {
  id: string;
  name: string;
  notebookId: string;
  /** The file's repository-relative path. */
  path: string;
  view: CompilationView;
  tags?: string[];
  status?: string;
  graph?: GraphLayout;
  progression?: StudyProgression;
  study?: CompilationStudy;
}
export type CompilationTagSource = { kind: 'tag'; tag: string; notebookId: string; };
export type CompilationFolderSource = { kind: 'folder'; path: string; recursive: boolean; notebookId: string; };
export type CompilationSource = CompilationTagSource | CompilationFolderSource;
export type CompilationRow = (CompilationRowBase & { kind: 'custom'; items: CompilationItem[]; }) | (CompilationRowBase & { kind: 'dynamic'; source: CompilationSource; sort?: CompilationSort; });
/** What the browser holds of a notebook's compilations. */
export interface CompilationPage {
  rows: CompilationRow[];
}

/** One-line reason for the first few issues, naming the offending field. */
function describeIssues(error: z.ZodError): string {
  return error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || 'file'}: ${issue.message}`).join('; ');
}

export class CompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilationError';
  }
}

const within = (file: string, root: string) => file === root || file.startsWith(root + '/');
const stripSlash = (value: string) => value.replace(/\/+$/, '');

/** Parses a compilation file; with `notebookRoot`, its items and source must lie inside that notebook. Throws `CompilationError` naming the problem. */
export function parseCompilation(raw: string, notebookRoot?: string): CompilationFile {
  if (new TextEncoder().encode(raw).length > COMPILATION_MAX_BYTES) throw new CompilationError('Compilation file exceeds 512 KiB');
  let value: unknown;
  try {
    value = YAML.parse(raw, { maxAliasCount: 20 });
  } catch (error) {
    throw new CompilationError(`Invalid YAML: ${(error as Error).message.split('\n')[0]}`);
  }
  const parsed = CompilationFileSchema.safeParse(value);
  if (!parsed.success) throw new CompilationError(describeIssues(parsed.error));
  const file = parsed.data;
  if (notebookRoot !== undefined) {
    const root = stripSlash(notebookRoot);
    const paths = [...(file.items ?? []).flatMap(item => item.kind === 'youtube' ? [] : [item.path]), ...(file.source?.kind === 'folder' ? [file.source.path] : [])];
    const outside = paths.find(path => !within(path, root));
    if (outside) throw new CompilationError(`${outside} is outside the notebook ${root}`);
  }
  return file;
}

export function serializeCompilation(file: CompilationFile): string {
  const { version, id, title, arrangement, size, tags, status, items, source, sort, study, progression, graph } = file;
  const ordered = { version, id, title, arrangement, ...(size ? { size } : {}), ...(tags?.length ? { tags } : {}), ...(status ? { status } : {}), ...(items ? { items } : {}), ...(source ? { source } : {}), ...(sort ? { sort } : {}), ...(study ? { study } : {}), ...(progression ? { progression } : {}), ...(graph ? { graph } : {}) };
  return YAML.stringify(ordered, { lineWidth: 0 });
}

/** The lane model of a stored compilation: arrangement and size fold into `view`, and items carry their notebook. */
export function compilationRow(file: CompilationFile, owner: { notebookId: string; path: string; }): CompilationRow {
  const view: CompilationView = file.arrangement === 'lane' ? file.size ?? 'small' : file.arrangement;
  const base = { id: file.id, name: file.title, notebookId: owner.notebookId, path: owner.path, view, ...(file.tags?.length ? { tags: file.tags } : {}), ...(file.status ? { status: file.status } : {}), ...(file.graph ? { graph: file.graph } : {}), ...(file.progression ? { progression: file.progression } : {}), ...(file.study ? { study: file.study } : {}) };
  if (file.items) {
    return { ...base, kind: 'custom', items: file.items.map(item => item.kind === 'youtube' ? item : { ...item, notebookId: owner.notebookId }) };
  }
  const source = file.source!;
  return { ...base, kind: 'dynamic', source: source.kind === 'tag' ? { ...source, notebookId: owner.notebookId } : { ...source, notebookId: owner.notebookId }, ...(file.sort ? { sort: file.sort } : {}) };
}

/** The stored form of a lane model; the inverse of `compilationRow`. */
export function compilationFile(row: CompilationRow): CompilationFile {
  const lane = row.view !== 'graph' && row.view !== 'stack';
  const common = { version: 1 as const, id: row.id, title: row.name, arrangement: lane ? 'lane' as const : row.view as 'graph' | 'stack', ...(lane ? { size: row.view as CompilationFile['size'] } : {}), ...(row.tags?.length ? { tags: row.tags } : {}), ...(row.status ? { status: row.status } : {}), ...(row.study ? { study: row.study } : {}), ...(row.progression ? { progression: row.progression } : {}), ...(row.graph ? { graph: row.graph } : {}) };
  if (row.kind === 'custom') return { ...common, items: row.items.map(item => item.kind === 'youtube' ? item : { id: item.id, kind: item.kind, path: item.path }) };
  const source = row.source.kind === 'tag' ? { kind: 'tag' as const, tag: row.source.tag } : { kind: 'folder' as const, path: row.source.path, recursive: row.source.recursive };
  return { ...common, source, ...(row.sort ? { sort: row.sort } : {}) };
}

export interface CompilationFields {
  title: string;
  tags: string[];
  status?: string;
  /** A bounded summary kept in listings; the file itself is the note content. */
  metadata: Record<string, unknown>;
  /** Why the file cannot open: a syntax, schema or scope problem. */
  invalid?: string;
}

const fileTitle = (path: string) => path.split('/').pop()!.slice(0, -COMPILATION_SUFFIX.length);

/** The listing fields of a compilation file, tolerating an invalid one: it still carries a title and what tags and status can be read. */
export function compilationFields(raw: string, path: string, notebookRoot?: string): CompilationFields {
  try {
    const file = parseCompilation(raw, notebookRoot);
    return { title: file.title, tags: file.tags ?? [], status: file.status, metadata: { id: file.id, title: file.title, arrangement: file.arrangement, ...(file.size ? { size: file.size } : {}), ...(file.items ? { itemCount: file.items.length } : { sourceKind: file.source!.kind }), ...(file.tags?.length ? { tags: file.tags } : {}), ...(file.status ? { status: file.status } : {}) } };
  } catch (error) {
    let value: unknown;
    try {
      value = YAML.parse(raw, { maxAliasCount: 20 });
    } catch { /* The file is not YAML at all. */ }
    const map = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const title = typeof map.title === 'string' && map.title.trim() ? map.title.trim().slice(0, 100) : fileTitle(path);
    const tags = Array.isArray(map.tags) ? map.tags.filter((item): item is string => typeof item === 'string') : [];
    const status = typeof map.status === 'string' ? map.status : undefined;
    return { title, tags, status, metadata: { ...(typeof map.id === 'string' ? { id: map.id } : {}), title, ...(tags.length ? { tags } : {}), ...(status ? { status } : {}) }, invalid: error instanceof Error ? error.message : String(error) };
  }
}

/** Carries the caller's `tags` and `status` into the stored file, keeping its comments and order; a file that is not a YAML mapping is returned as it is. */
export function applyCompilationMetadata(raw: string, metadata: { tags?: unknown; status?: unknown; }): string {
  const document = YAML.parseDocument(raw);
  if (document.errors.length || !YAML.isMap(document.contents)) return raw;
  const stored = document.toJS({ maxAliasCount: 20 }) as Record<string, unknown>;
  const tags = Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  const status = typeof metadata.status === 'string' && metadata.status ? metadata.status : undefined;
  let changed = false;
  if (JSON.stringify(stored.tags ?? []) !== JSON.stringify(tags)) {
    if (tags.length) document.set('tags', tags);
    else document.delete('tags');
    changed = true;
  }
  if (stored.status !== status) {
    if (status) document.set('status', status);
    else document.delete('status');
    changed = true;
  }
  return changed ? document.toString({ lineWidth: 0 }) : raw;
}

/** Rewrites the paths a compilation pins when files or folders move; returns the new text, or null when nothing it names moved. */
export function relocateCompilation(raw: string, move: (path: string) => string): string | null {
  const document = YAML.parseDocument(raw);
  if (document.errors.length || !YAML.isMap(document.contents)) return null;
  const value = document.toJS({ maxAliasCount: 20 }) as { items?: { kind?: string; path?: unknown; }[]; source?: { kind?: string; path?: unknown; }; graph?: { nodes?: { path?: unknown; }[]; }; };
  let changed = false;
  const update = (location: (string | number)[], current: unknown) => {
    if (typeof current !== 'string') return;
    const next = move(current);
    if (next === current) return;
    document.setIn(location, next);
    changed = true;
  };
  value.items?.forEach((item, index) => {
    if (item.kind !== 'youtube') update(['items', index, 'path'], item.path);
  });
  if (value.source?.kind === 'folder') update(['source', 'path'], value.source.path);
  value.graph?.nodes?.forEach((node, index) => update(['graph', 'nodes', index, 'path'], node.path));
  return changed ? document.toString({ lineWidth: 0 }) : null;
}

/** A file name stem from a title: letters and digits of any script, dashes between words. */
export function compilationSlug(name: string): string {
  const slug = name.normalize('NFKC').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
  return slug || 'compilation';
}

/** `<dir>/<stem>.compilation.yml`, suffixed `-2`, `-3` … until `taken` does not hold it. */
export function uniqueCompilationPath(directory: string, stem: string, taken: (path: string) => boolean): string {
  const base = directory ? directory.replace(/\/$/, '') + '/' : '';
  let path = `${base}${stem}${COMPILATION_SUFFIX}`;
  for (let n = 2; taken(path); n++) path = `${base}${stem}-${n}${COMPILATION_SUFFIX}`;
  return path;
}

const newItemId = () => globalThis.crypto.randomUUID();

/** The copy of a compilation: title `<title> copy`, a fresh identity and fresh item ids. `usedIds` are the ids already in the repository. */
export function copyCompilation(file: CompilationFile, usedIds: Iterable<string>, makeId: () => string = newItemId): CompilationFile {
  const used = new Set(usedIds);
  let next = `${file.id}-copy`.slice(0, 64);
  for (let n = 2; used.has(next); n++) next = `${file.id.slice(0, 64 - String(n).length - 6)}-copy-${n}`;
  const title = `${file.title} copy`.length <= 100 ? `${file.title} copy` : `${file.title.slice(0, 95).trimEnd()} copy`;
  return { ...file, id: next, title, ...(file.items ? { items: file.items.map(item => ({ ...item, id: makeId() })) } : {}) };
}

/** The file a copy of `path` is written to: `<name>-copy.compilation.yml` beside it. */
export function compilationCopyPath(path: string, taken: (path: string) => boolean): string {
  const slash = path.lastIndexOf('/');
  return uniqueCompilationPath(path.slice(0, Math.max(slash, 0)), `${fileTitle(path)}-copy`, taken);
}

interface MemberNote {
  notebookId: string;
  path: string;
  status?: string;
  tags: string[];
  metadata: Record<string, unknown>;
}
/** Membership is shared by lane cards and graph views; folder shortcuts stay shortcuts. */
export function compilationNotes<T extends MemberNote>(row: CompilationRow, notes: T[]): T[] {
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
export function compilationNotePaths<T extends MemberNote>(row: CompilationRow, notes: T[]): string[] {
  return compilationNotes(row, notes).map(note => note.path);
}

export function moveCompilationItem(page: CompilationPage, itemId: string, targetRowId: string, index: number): CompilationPage {
  const source = page.rows.find(row => row.kind === 'custom' && row.items.some(item => item.id === itemId));
  const target = page.rows.find(row => row.id === targetRowId);
  if (source?.kind !== 'custom' || target?.kind !== 'custom') throw new Error('Only custom compilations accept moved items');
  if (source.notebookId !== target.notebookId) throw new Error('Items stay inside their notebook');
  const item = source.items.find(item => item.id === itemId)!;
  if (source.id !== target.id && target.items.length >= COMPILATION_MAX_ITEMS) throw new Error('Compilation has too many pinned items');
  const rows = page.rows.map(row => {
    if (row.kind !== 'custom') return row;
    const items = row.items.filter(item => item.id !== itemId);
    if (row.id === targetRowId) items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
    return { ...row, items };
  });
  return { ...page, rows };
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
