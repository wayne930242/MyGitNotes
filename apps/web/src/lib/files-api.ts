import { ApiError } from './api.js';
import type { FileCommand } from '@mygitnotes/core';
export interface FileEntry { path: string; name: string; directory: boolean; noteDirectory?: boolean; size: number; hidden: boolean; hash?: string; presentation: 'image' | 'pdf' | 'audio' | 'video' | 'file' }
export interface FileListing { root: string; entries: FileEntry[]; revision: string; writable: boolean; remote: boolean }
export interface FileRead { path: string; hash?: string; content?: string | null; revision: string; metadata?: { title: string; description?: string; order: number } }
export interface FileResult { revision: string; selectedPath: string; pathMap: Record<string, string>; deletedPaths: string[] }
const query = (notebookId: string, path?: string) => new URLSearchParams({ notebookId, ...(path ? { path } : {}) }).toString();
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init), data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'File operation failed.', response.status);
  return data;
}
export const fetchFiles = (notebookId: string) => request<FileListing>('/api/files?' + query(notebookId));
export const readFile = (notebookId: string, path: string) => request<FileRead>('/api/files/read?' + query(notebookId, path));
export const rawFileUrl = (notebookId: string, path: string) => '/api/files/raw?' + query(notebookId, path);
export const mutateFile = (command: FileCommand, revision: string) => request<FileResult>('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, revision }) });
