import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ZodType, ZodTypeDef } from 'zod';
import { SourceError } from './github-api.js';
import { SCREEN_DOCUMENT, type ScreenNotebookConfig, type ScreenPage } from './screen-page.js';
import { STUDY_DOCUMENT } from './study.js';
import { FOCUS_DOCUMENT } from './focus-page.js';

export type CommitScope = 'notes' | 'assets' | 'agents' | 'screen' | 'folders' | 'study' | 'study-transition' | 'files' | 'focus' | 'config';

/** A Git-tracked YAML file at the workspace root that the app reads and writes as a whole. */
export interface WorkspaceDocument<T = unknown> {
  file: string;
  /** Names the file in errors, e.g. "Invalid Screen configuration." */
  label: string;
  maxBytes: number;
  /** Commit scopes that may write this file. */
  scopes: readonly CommitScope[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  /** Accepts every stored version without migrating it. */
  fileSchema: ZodType<unknown, ZodTypeDef, unknown>;
  empty(): T;
  read(value: unknown, config: ScreenNotebookConfig | null): T;
  /** Rewrites one notebook's note paths in place and reports whether anything changed. */
  relocate?(value: T, notebookId: string, move: (path: string) => string): boolean;
  /** Keeps only content owned by its notebook; `foreign` reports that something was dropped. */
  own?(value: T, notebooks: readonly { id: string; root: string; }[], screen: ScreenPage): { page: T; foreign: boolean; };
}

export const WORKSPACE_DOCUMENTS: readonly WorkspaceDocument[] = [SCREEN_DOCUMENT, STUDY_DOCUMENT, FOCUS_DOCUMENT];
export const workspaceDocument = (file: string) => WORKSPACE_DOCUMENTS.find(document => document.file === file);
export const serializeWorkspaceDocument = (value: unknown) => stringifyYaml(value, { lineWidth: 0 });
const parse = (content: string) => parseYaml(content, { maxAliasCount: 20 });

export function readWorkspaceDocument<T>(document: WorkspaceDocument<T>, content: string | null, config: ScreenNotebookConfig | null): T {
  return content === null ? document.empty() : document.read(parse(content), config);
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
export function relocateWorkspaceDocuments(files: { get(file: string): string | undefined; set(file: string, content: string): void; }, config: ScreenNotebookConfig, notebookId: string, move: (path: string) => string) {
  for (const document of WORKSPACE_DOCUMENTS) {
    const raw = files.get(document.file);
    if (raw === undefined || !document.relocate) continue;
    const value = document.read(parse(raw), config);
    if (document.relocate(value, notebookId, move)) files.set(document.file, serializeWorkspaceDocument(value));
  }
}
