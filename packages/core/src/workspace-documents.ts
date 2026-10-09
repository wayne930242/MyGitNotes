import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ZodType, ZodTypeDef } from 'zod';
import { SourceError } from './github-api.js';
import { STUDY_DOCUMENT } from './study.js';
import { FOCUS_DOCUMENT } from './focus-page.js';
import { BOOKMARKS_DOCUMENT } from './bookmarks.js';

export type CommitScope = 'notes' | 'assets' | 'agents' | 'skills' | 'folders' | 'study' | 'study-transition' | 'files' | 'focus' | 'config' | 'versions';

/** A Git-tracked YAML file at the workspace root that the app reads and writes as a whole. */
export interface WorkspaceDocument<T = unknown> {
  file: string;
  /** Names the file in errors, e.g. "Invalid Focus configuration." */
  label: string;
  maxBytes: number;
  /** Commit scopes that may write this file. */
  scopes: readonly CommitScope[];
  /** Retained metadata may only be rewritten by trusted relocation operations. */
  retired?: boolean;
  schema: ZodType<T, ZodTypeDef, unknown>;
  /** Accepts every stored version without migrating it. */
  fileSchema: ZodType<unknown, ZodTypeDef, unknown>;
  empty(): T;
  read(value: unknown): T;
  /** Rewrites one notebook's note paths in place and reports whether anything changed. */
  relocate?(value: T, notebook: { id: string; root: string; }, move: (path: string) => string): boolean;
  /** Validate changed collections without dropping retained missing or unknown-owner references. */
  validateChange?(current: T, next: T, notebooks: readonly { id: string; root: string; }[], relocation?: boolean): void;
  /** Optional saved-body validation; the adapter pins reads to its transaction snapshot. */
  validateReferences?(current: T, next: T, notebooks: readonly { id: string; root: string; }[], readBody: (path: string) => Promise<string | null>): Promise<void>;
  /** Keeps only content owned by its notebook; `foreign` reports that something was dropped. */
  own?(value: T, notebooks: readonly { id: string; root: string; }[]): { page: T; foreign: boolean; };
  /** A copy with every notebook id passed through `map`: local ids on disk, notebook keys on the wire. */
  mapNotebookIds(value: T, map: (notebookId: string) => string): T;
}

export const WORKSPACE_DOCUMENTS: readonly WorkspaceDocument[] = [STUDY_DOCUMENT, FOCUS_DOCUMENT, BOOKMARKS_DOCUMENT];
export const workspaceDocument = (file: string) => WORKSPACE_DOCUMENTS.find(document => document.file === file);
export const serializeWorkspaceDocument = (value: unknown) => stringifyYaml(value, { lineWidth: 0 });
const parse = (content: string) => parseYaml(content, { maxAliasCount: 20 });

export function readWorkspaceDocument<T>(document: WorkspaceDocument<T>, content: string | null): T {
  return content === null ? document.empty() : document.read(parse(content));
}

/** Checks committed content against the size limit and every accepted stored version. */
export function validateWorkspaceDocument(document: WorkspaceDocument, content: unknown) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > document.maxBytes) throw new SourceError(`${document.label} YAML is required.`);
  try {
    document.fileSchema.parse(parse(content));
  } catch {
    throw new SourceError(`Invalid ${document.label} YAML.`);
  }
}

/** Keeps every workspace document pointing at the notes that moved inside one notebook. */
export function relocateWorkspaceDocuments(files: { get(file: string): string | undefined; set(file: string, content: string): void; }, notebook: { id: string; root: string; }, move: (path: string) => string) {
  for (const document of WORKSPACE_DOCUMENTS) {
    const raw = files.get(document.file);
    if (raw === undefined || !document.relocate) continue;
    if (Buffer.byteLength(raw) > document.maxBytes) throw new SourceError(`${document.label} is too large.`, 413);
    let value;
    try {
      value = document.read(parse(raw));
    } catch {
      throw new SourceError(`Invalid ${document.label} YAML. Fix the file before moving content.`, 422);
    }
    if (document.relocate(value, notebook, move)) files.set(document.file, serializeWorkspaceDocument(value));
  }
}
