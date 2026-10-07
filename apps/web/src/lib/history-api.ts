import type { HistoryEntry, NoteVersion } from '@mygitnotes/core/note-versions';
import { responseError } from './api.js';

const API_BASE = '/api';

/** Which file a history request is about: a note through its notebook, or an agent file through its repository. */
export interface HistoryTarget {
  path: string;
  notebookId?: string;
  repository?: string;
}

export interface HistoryPage {
  path: string;
  repository: string;
  entries: HistoryEntry[];
  more: boolean;
  versions: NoteVersion[];
  writable: boolean;
}

/** A file's content in a past commit, or why it is not shown. */
export type HistoryContent = { blob: string; content: string; } | { blob: string; notice: 'binary' | 'too-large'; };

/** The name and note a person gives a version, and their day for its date number. */
export interface VersionText {
  name?: string;
  note?: string;
}

/** A version recorded in the same commit as the note's changes, from the quick note commit. */
export interface NewVersionRequest extends VersionText {
  path: string;
  today: string;
}

function query(target: HistoryTarget, extra: Record<string, string | number | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ path: target.path, notebookId: target.notebookId, repository: target.repository, ...extra })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** This device's day, which names a version's date number. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function fetchHistory(target: HistoryTarget, page = 1): Promise<HistoryPage> {
  const res = await fetch(`${API_BASE}/history?${query(target, { page })}`);
  if (!res.ok) throw await responseError(res, 'History could not be loaded.');
  return res.json();
}

/** The file as one commit held it (`at` is its path then), or the content a version recorded. */
export async function fetchHistoryContent(target: HistoryTarget, at: { commit: string; path?: string; } | { blob: string; }): Promise<HistoryContent> {
  const extra = 'blob' in at ? { blob: at.blob } : { commit: at.commit, at: at.path && at.path !== target.path ? at.path : undefined };
  const res = await fetch(`${API_BASE}/history/file?${query(target, extra)}`);
  if (!res.ok) throw await responseError(res, 'This version could not be loaded.');
  return res.json();
}

/** The other files the commit changed that can join a version recorded on it. */
export async function fetchCommitFiles(target: HistoryTarget, commit: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/history/commit?${query(target, { commit })}`);
  if (!res.ok) throw await responseError(res, 'The commit could not be loaded.');
  return (await res.json() as { files: string[]; }).files;
}

export type VersionChange = { action: 'create'; commit: string; at?: string; include: string[]; } & VersionText | { action: 'update'; sequence: number; } & VersionText | { action: 'delete'; sequence: number; };

export async function changeVersion(target: HistoryTarget, change: VersionChange): Promise<NoteVersion[]> {
  const res = await fetch(`${API_BASE}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, ...change, ...(change.action === 'create' ? { today: today() } : {}) }) });
  if (!res.ok) throw await responseError(res, 'The version could not be saved.');
  return (await res.json() as { versions: NoteVersion[]; }).versions;
}
