import type { NoteRef } from '@mygitnotes/core/note-query';
import { ApiError, responseError } from './api.js';

export interface R2Object {
  key: string;
  size: number;
  lastModified: string;
}
export interface R2Listing {
  prefix: string;
  objects: R2Object[];
}
export interface R2References {
  objects: string[];
  /** Referencing notes of every repository, named by notebook and path. */
  notes: NoteRef[];
  /** Hidden repositories sharing the key space, which are never read and so not checked (decision C7). */
  hidden?: { id: string; alias: string; repository?: string; path?: string; }[];
  /** Hidden repositories of a hosted deployment, unchecked as well, which the requester is not told the names of. */
  hiddenUnnamed?: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw await responseError(response, 'R2 operation failed.');
  return response.json();
}
const post = <T>(url: string, body: Record<string, unknown>) => request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const query = (values: Record<string, string>) => new URLSearchParams(values).toString();

/** Returns the notebook's R2 objects, or undefined when R2 is unconfigured or the requester cannot write. */
export async function fetchR2(notebookId: string): Promise<R2Listing | undefined> {
  const response = await fetch('/api/r2?' + query({ notebookId }));
  if (response.ok) return response.json();
  // An unread body keeps the request open in the browser.
  await response.body?.cancel();
  return undefined;
}
export const r2RawUrl = (notebookId: string, key: string) => '/api/r2/raw?' + query({ notebookId, key });
export const fetchR2References = (notebookId: string, key: string, directory: boolean) => request<R2References>('/api/r2/references?' + query({ notebookId, key, ...(directory ? { directory: '1' } : {}) }));
export const createR2Folder = (notebookId: string, key: string) => post<{ key: string; }>('/api/r2/mkdir', { notebookId, key });
/** `confirmHidden` says the person accepted that hidden repositories were not checked; without it the server refuses while there are any. */
export const moveR2 = (notebookId: string, key: string, destination: string, directory: boolean, confirmHidden = false) => post<{ moves: Record<string, string>; notes: NoteRef[]; }>('/api/r2/move', { notebookId, key, destination, directory, ...(confirmHidden ? { confirmHidden } : {}) });
export const deleteR2 = (notebookId: string, key: string, directory: boolean, confirmHidden = false) => post<{ deleted: string[]; }>('/api/r2/delete', { notebookId, key, directory, ...(confirmHidden ? { confirmHidden } : {}) });

/** Uploads directly to the bucket through a presigned PUT URL; the file body never passes through the server. */
export async function uploadR2(notebookId: string, key: string, file: File): Promise<void> {
  // The URL signs the declared size, so the bucket rejects a body of any other length.
  const { url } = await post<{ url: string; }>('/api/r2/upload', { notebookId, key, size: file.size });
  const response = await fetch(url, { method: 'PUT', body: file, headers: { 'If-None-Match': '*' } });
  if (response.status === 412) throw new ApiError('Destination already exists.', 409);
  if (!response.ok) throw await responseError(response, `R2 upload failed with status ${response.status}.`);
  await post('/api/r2/uploaded', { notebookId, key });
}
