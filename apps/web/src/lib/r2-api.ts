import { ApiError } from './api.js';

export interface R2Object { key: string; size: number; lastModified: string }
export interface R2Listing { prefix: string; objects: R2Object[] }
export interface R2References { objects: string[]; notes: string[] }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init), data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'R2 operation failed.', response.status);
  return data;
}
const post = <T>(url: string, body: Record<string, unknown>) => request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const query = (values: Record<string, string>) => new URLSearchParams(values).toString();

/** Returns the notebook's R2 objects, or undefined when R2 is unconfigured or the requester cannot write. */
export async function fetchR2(notebookId: string): Promise<R2Listing | undefined> {
  const response = await fetch('/api/r2?' + query({ notebookId }));
  return response.ok ? response.json() : undefined;
}
export const r2RawUrl = (notebookId: string, key: string) => '/api/r2/raw?' + query({ notebookId, key });
export const fetchR2References = (notebookId: string, key: string, directory: boolean) =>
  request<R2References>('/api/r2/references?' + query({ notebookId, key, ...(directory ? { directory: '1' } : {}) }));
export const createR2Folder = (notebookId: string, key: string) => post<{ key: string }>('/api/r2/mkdir', { notebookId, key });
export const moveR2 = (notebookId: string, key: string, destination: string, directory: boolean) =>
  post<{ moves: Record<string, string>; notes: string[] }>('/api/r2/move', { notebookId, key, destination, directory });
export const deleteR2 = (notebookId: string, key: string, directory: boolean) => post<{ deleted: string[] }>('/api/r2/delete', { notebookId, key, directory });

/** Uploads directly to the bucket through a presigned PUT URL; the file body never passes through the server. */
export async function uploadR2(notebookId: string, key: string, file: File): Promise<void> {
  const { url } = await post<{ url: string }>('/api/r2/upload', { notebookId, key });
  const response = await fetch(url, { method: 'PUT', body: file, headers: { 'If-None-Match': '*' } });
  if (response.status === 412) throw new ApiError('Destination already exists.', 409);
  if (!response.ok) throw new ApiError(`R2 upload failed with status ${response.status}.`, response.status);
}
