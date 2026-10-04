import { z } from 'zod';
import { type BookmarkTarget, BookmarkTargetSchema } from './bookmarks.js';
export const BookmarkResolveRequestSchema = z.object({ notebookId: z.string().min(1).max(128), targets: z.array(z.object({ id: z.string().min(1).max(64), target: BookmarkTargetSchema }).strict()).min(1).max(100) }).strict().refine(value => new Set(value.targets.map(t => t.id)).size === value.targets.length, 'Request IDs must be unique');
import type { BookmarkRange } from './bookmark-anchor.js';
export type BookmarkResolution = { state: 'resolved'; target: BookmarkTarget; range?: BookmarkRange; contentRevision?: string; } | { state: 'unresolved'; reason: 'missing-note' | 'missing-folder' | 'missing-compilation' | 'invalid-compilation' | 'missing-position' | 'ambiguous-position' | 'missing-query-folder'; } | { state: 'unavailable'; retryable: boolean; } | { state: 'external'; url: string; };
