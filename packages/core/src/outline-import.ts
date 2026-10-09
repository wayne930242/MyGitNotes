import { z } from 'zod';
import { NOTEBOOK_KEY_MAX_LENGTH } from './notebook-key.js';
import { type Bookmark, type BookmarkOwner, bookmarkRepositoryPath, type BookmarksPage, BookmarksPageSchema, validateBookmarkTargetScope } from './bookmarks.js';
import { isOutlinePath } from './outline.js';
import { canonicalizeBookmarkUrl } from './bookmark-query.js';
import { noteMarkdownLink } from './workspace-links.js';

/** Explicit selection of saved legacy entries, never a browser draft or an editable outline tree. */
export const LegacyOutlineImportSchema = z.object({ repository: z.string().min(1).max(512), notebookId: z.string().min(1).max(NOTEBOOK_KEY_MAX_LENGTH), selectedIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(500).refine(ids => new Set(ids).size === ids.length, 'Duplicate selected IDs'), path: z.string().min(1).max(2048), title: z.string().trim().min(1).max(200) }).strict();
export type LegacyOutlineImportRequest = z.infer<typeof LegacyOutlineImportSchema>;
export const ApplyLegacyOutlineImportSchema = LegacyOutlineImportSchema.extend({ token: z.string().regex(/^[a-f0-9]{64}$/), acknowledgePartial: z.boolean() }).strict();
export type LegacyRetainedReason = 'position' | 'query' | 'folder' | 'not-selected' | 'other-owner';
export interface LegacyRetainedEntry {
  notebookId: string;
  entry: Bookmark;
  reason: LegacyRetainedReason;
}
export interface LegacyOutlineImportPlan {
  path: string;
  markdown: string | null;
  convertedIds: string[];
  retained: LegacyRetainedEntry[];
  groups: { id: string; label: string; convertedIds: string[]; }[];
  partial: boolean;
}

/** Keep labels text-only, including entities, HTML, newlines and Markdown punctuation. */
function text(label: string): string {
  return label.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
}

/** Pure additive conversion. The caller retains and exports the complete original source bytes. */
export function planLegacyOutlineImport(page: BookmarksPage, owner: BookmarkOwner, notebooks: readonly BookmarkOwner[], request: LegacyOutlineImportRequest): LegacyOutlineImportPlan {
  BookmarksPageSchema.parse(page);
  const input = LegacyOutlineImportSchema.parse(request);
  const configured = notebooks.find(nb => nb.id === input.notebookId);
  if (!configured || configured.id !== owner.id || configured.root !== owner.root || configured.assets !== owner.assets) throw new Error('Choose a configured owner in the named repository.');
  if (!input.path.startsWith(owner.root + '/') || !isOutlinePath(input.path)) throw new Error('Choose a new .outline.md path in this notebook.');
  bookmarkRepositoryPath(owner, input.path.slice(owner.root.length + 1), notebooks);
  const collection = page.notebooks.find(nb => nb.notebookId === owner.id);
  const selected = new Set(input.selectedIds);
  if (input.selectedIds.some(id => !collection?.bookmarks.some(entry => entry.id === id))) throw new Error('Unknown selected legacy entry.');
  const converted = new Map<string, string>();
  const retained: LegacyRetainedEntry[] = [];
  for (const nb of page.notebooks) {
    for (const entry of nb.bookmarks) {
      const target = entry.target;
      const reason = nb.notebookId !== owner.id ? 'other-owner' : !selected.has(entry.id) ? 'not-selected' : target.kind === 'position' || target.kind === 'query' || target.kind === 'folder' ? target.kind : undefined;
      if (reason) {
        retained.push({ notebookId: nb.notebookId, entry: structuredClone(entry), reason });
        continue;
      }
      validateBookmarkTargetScope(target, owner, notebooks);
      const label = text(entry.label);
      if (target.kind === 'url') {
        // Encode only Markdown delimiters: query/fragment separators and existing escapes stay intact.
        const url = canonicalizeBookmarkUrl(target.url).replace(/[()<>]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase()).replace(/&/g, '&amp;');
        converted.set(entry.id, `[${label}](${url})`);
      } else if (target.kind === 'note' || target.kind === 'compilation') {
        const link = noteMarkdownLink(input.path, bookmarkRepositoryPath(owner, target.path, notebooks), '');
        converted.set(entry.id, `[${label}]${link.slice(2)}`);
      }
    }
  }
  const groups = (collection?.groups ?? []).map(group => ({ ...group, convertedIds: collection!.bookmarks.filter(entry => entry.groupId === group.id && converted.has(entry.id)).map(entry => entry.id) }));
  const lines: string[] = [], convertedIds: string[] = [];
  const add = (id: string, indent: string) => {
    lines.push(`${indent}- ${converted.get(id)!}`);
    convertedIds.push(id);
  };
  for (const group of groups) {
    lines.push(`- ${text(group.label)}`);
    for (const id of group.convertedIds) add(id, '  ');
  }
  for (const entry of collection?.bookmarks ?? []) if (entry.groupId === null && converted.has(entry.id)) add(entry.id, '');
  return { path: input.path, markdown: convertedIds.length ? `---\ntitle: ${JSON.stringify(input.title)}\n---\n\n${lines.join('\n')}\n` : null, convertedIds, retained, groups, partial: retained.some(item => item.notebookId === owner.id && selected.has(item.entry.id)) };
}
