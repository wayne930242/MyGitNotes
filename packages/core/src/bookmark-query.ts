import { z } from 'zod';
import { BookmarkError } from './bookmark-error.js';

/* eslint-disable no-control-regex -- Stored references reject controls, not encoded text. */
export const bookmarkPath = z.string().max(2048).refine(value => !/^[a-z][a-z\d+.-]*:/i.test(value) && !/[\\\x00-\x1f\x7f]/.test(value) && (value === '' || value.split('/').every(part => part !== '' && part !== '.' && part !== '..')), 'Invalid notebook-relative path');
/* eslint-enable no-control-regex */
const set = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(100).transform(values => [...new Set(values)].sort());
export const SavedBookmarkQuerySchema = z.object({ q: z.string().max(1000), kind: z.enum(['note', 'compilation']), tags: set(z.string().min(1).max(128)), folders: set(bookmarkPath), descendants: z.boolean(), tagMode: z.enum(['any', 'all']), status: z.string().max(128).nullable(), showHidden: z.boolean(), neighbors: z.boolean(), view: z.enum(['flat', 'list', 'card', 'kanban', 'graph']), sort: z.object({ field: z.enum(['updated', 'created', 'title', 'status']), order: z.enum(['asc', 'desc']) }).strict() }).strict();
export type SavedBookmarkQuery = z.infer<typeof SavedBookmarkQuerySchema>;
export const canonicalizeBookmarkQuery = (value: unknown): SavedBookmarkQuery => SavedBookmarkQuerySchema.parse(value);

export function canonicalizeBookmarkUrl(value: string): string {
  /* eslint-disable no-control-regex -- Reject URL parser's control-character normalization. */
  if (value.length > 4096 || /[\\\x00-\x20\x7f]/.test(value)) throw new BookmarkError('invalid-target', 'Invalid bookmark URL');
  /* eslint-enable no-control-regex */
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new BookmarkError('invalid-target', 'Only HTTP(S) URLs without credentials are supported');
    return url.href;
  } catch (error) {
    if (error instanceof BookmarkError) throw error;
    throw new BookmarkError('invalid-target', 'Invalid bookmark URL');
  }
}
export const BookmarkUrlSchema = z.string().max(4096).transform((value, context) => {
  try {
    return canonicalizeBookmarkUrl(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Only absolute HTTP(S) URLs without credentials are supported' });
    return z.NEVER;
  }
});
