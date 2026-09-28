import type { NotebookConfig, NoteMetadata } from './types.js';

export const DEFAULT_NOTE_STATUSES: readonly string[] = ['inbox', 'working', 'done', 'archived'];

/** The persisted hiden boolean wins; legacy archived notes default to hidden. */
export function isNoteHidden(metadata: NoteMetadata): boolean {
  return typeof metadata.hiden === 'boolean' ? metadata.hiden : metadata.status === 'archived';
}

/** Explicit status actions archive/unarchive while preserving other metadata. */
export function withNoteStatus(metadata: NoteMetadata, status: string): NoteMetadata {
  return { ...metadata, status: status || undefined, ...(status === 'archived' ? { hiden: true } : metadata.status === 'archived' ? { hiden: false } : {}) };
}

export interface NoteMetadataEdits {
  status?: string;
  tags?: string[];
  title?: string;
}

/** Applies the status, tags and title edits a caller supplied; omitted fields keep their current values. */
export function withNoteEdits(metadata: NoteMetadata, edits: NoteMetadataEdits): NoteMetadata {
  const next = edits.status === undefined ? { ...metadata } : withNoteStatus(metadata, edits.status);
  if (edits.tags !== undefined) next.tags = edits.tags;
  if (edits.title !== undefined) next.title = edits.title;
  return next;
}

/** A notebook's configured statuses, or the defaults when it defines none. */
export function configuredNoteStatuses(notebook?: Pick<NotebookConfig, 'statuses'>): readonly string[] {
  return notebook?.statuses?.length ? notebook.statuses : DEFAULT_NOTE_STATUSES;
}

/** Ordered notebook choices followed by observed extensions; metadata stays unchanged. */
export function resolveNoteStatuses(notebook?: Pick<NotebookConfig, 'statuses'>, observed: Iterable<string | undefined> = []): string[] {
  const configured = configuredNoteStatuses(notebook);
  const extensions = new Set<string>();
  for (const status of observed) {
    if (status && !configured.includes(status)) extensions.add(status);
  }
  return [...configured, ...[...extensions].sort()];
}
