import type { CompilationItem } from '@mygitnotes/core/compilation';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { type CompilationAsset, compilationItemTitle } from '../components/CompilationCard.js';

export interface BookChapter {
  /** The compilation item's id. */
  id: string;
  /** The heading's anchor in the book body; unique among the compilation's chapters and sub-sections. */
  anchor: string;
  kind: CompilationItem['kind'];
  title: string;
  /** The item names a note or file that is not there. */
  missing: boolean;
  item: CompilationItem;
  note?: NoteListItem;
  asset?: CompilationAsset;
}

/** One line of the contents list: a chapter, or a folder's note beneath it. */
export interface BookEntry {
  anchor: string;
  title: string;
  /** 0 for a chapter, 1 for a folder's note section. */
  level: 0 | 1;
  missing?: boolean;
}

export const chapterAnchor = (item: CompilationItem) => `chapter:${item.id}`;
/** A folder's note section; `path` names the note within the folder chapter. */
export const sectionAnchor = (item: CompilationItem, path: string) => `${chapterAnchor(item)}/${path}`;

/**
 * The book's chapters: the compilation's members in the order lane cards would show them. A note that has
 * not been found is only missing once the notes have loaded.
 */
export function bookChapters(items: readonly CompilationItem[], notes: readonly NoteListItem[], assets: readonly CompilationAsset[], loading = false): BookChapter[] {
  const noteList = [...notes], assetList = [...assets];
  return items.map(item => {
    const note = item.kind === 'note' ? noteList.find(candidate => candidate.path === item.path && candidate.notebookId === item.notebookId) : undefined;
    const asset = item.kind === 'asset' ? assetList.find(candidate => candidate.path === item.path && candidate.notebookId === item.notebookId) : undefined;
    const missing = item.kind === 'note' ? !note && !loading : item.kind === 'asset' ? !asset : false;
    return { id: item.id, anchor: chapterAnchor(item), kind: item.kind, title: compilationItemTitle(item, noteList, assetList), missing, item, ...(note ? { note } : {}), ...(asset ? { asset } : {}) };
  });
}

/**
 * The contents list: every chapter in order, each folder's note sections beneath it, and the live title
 * of the section being edited in place of the saved one.
 */
export function bookEntries(chapters: readonly BookChapter[], sections: ReadonlyMap<string, readonly BookEntry[]>, liveTitles: ReadonlyMap<string, string> = new Map()): BookEntry[] {
  const titled = (entry: BookEntry): BookEntry => ({ ...entry, title: liveTitles.get(entry.anchor) || entry.title });
  return chapters.flatMap(chapter => [titled({ anchor: chapter.anchor, title: chapter.title, level: 0, ...(chapter.missing ? { missing: true } : {}) }), ...(sections.get(chapter.id) ?? []).map(titled)]);
}

/**
 * The contents entry of the section that edits in the compilation's slot `slot`: a chapter's own id, or
 * `<folder id>:<note path>` for a note section under a folder chapter. `null` when no chapter owns the slot.
 */
export function slotAnchor(slot: string, chapters: readonly BookChapter[]): string | null {
  const own = chapters.find(chapter => chapter.id === slot);
  if (own) return own.anchor;
  const folder = chapters.find(chapter => chapter.kind === 'folder' && slot.startsWith(`${chapter.id}:`));
  return folder ? sectionAnchor(folder.item, slot.slice(folder.id.length + 1)) : null;
}
