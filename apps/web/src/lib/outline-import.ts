import type { BookmarksPage } from '@mygitnotes/core/bookmarks';
import type { LegacyOutlineImportPlan, LegacyOutlineImportRequest } from '@mygitnotes/core/outline-import';
import { responseError } from './api.js';

export interface LegacyOutlineSource {
  repository: string;
  path: string;
  revision: string;
  writable: boolean;
  base64: string | null;
  page: BookmarksPage | null;
  error: string | null;
}
export interface LegacyOutlinePreview extends LegacyOutlineImportPlan {
  repository: string;
  notebookId: string;
  revision: string;
  token: string;
  writable: boolean;
  persistence: 'worktree' | 'commit';
}
export async function readLegacyOutlineSource(repository: string, signal?: AbortSignal): Promise<LegacyOutlineSource> {
  const response = await fetch(`/api/outline-import/source?${new URLSearchParams({ repository })}`, { signal });
  if (!response.ok) throw await responseError(response, 'Cannot read the saved legacy source.');
  return response.json();
}
export async function previewLegacyOutline(request: LegacyOutlineImportRequest): Promise<LegacyOutlinePreview> {
  const response = await fetch('/api/outline-import/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  if (!response.ok) throw await responseError(response, 'Cannot preview the legacy import.');
  return response.json();
}
export async function applyLegacyOutline(request: LegacyOutlineImportRequest, preview: LegacyOutlinePreview, acknowledgePartial: boolean): Promise<void> {
  const response = await fetch('/api/outline-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, token: preview.token, acknowledgePartial }) });
  if (!response.ok) throw await responseError(response, 'Cannot apply the legacy import.');
}
/** Decode original bytes, including invalid UTF-8; never round-trip through a text decoder. */
export function downloadLegacySource(source: LegacyOutlineSource): void {
  if (source.base64 === null) return;
  const bytes = Uint8Array.from(atob(source.base64), character => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = source.path;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
