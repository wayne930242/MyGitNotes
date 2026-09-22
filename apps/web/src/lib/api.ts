import { AgentResource, AssetItem, FolderItem, GitCommit, GitStatus, NoteItem, WorkspaceConfig } from './types.js';

const API_BASE = '/api';
export async function commitRemoteNotes(notes: { path: string; content: string; metadata: Record<string, unknown>; createOnly?: boolean; }[], revision: string, message: string, documents: { path: string; page: unknown; base: unknown; }[] = []): Promise<{ revision: string; commit: { commitHash: string; }; }> {
  const res = await fetch(`${API_BASE}/notes/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes, revision, message, documents }) });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Failed to commit notes', res.status);
  return data;
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) {
    super(message);
  }
}

export async function responseError(res: Response, fallback: string): Promise<ApiError> {
  const data = await res.json().catch(() => ({}));
  const seconds = Number(res.headers.get('Retry-After') || data.retryAfter);
  return new ApiError(data.error || fallback, res.status, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
}

export async function fetchWorkspace(fresh = false): Promise<{ repoRoot: string; branch: string; config: WorkspaceConfig | null; gitStatus: GitStatus; isCoreBranch: boolean; source: { type: 'local' | 'github' | 'gitlab'; identity: string; repository?: string; }; capabilities: { write: boolean; local: boolean; }; revision?: string; }> {
  const res = await fetch(`${API_BASE}/workspace${fresh ? '?fresh=1' : ''}`);
  if (!res.ok) throw await responseError(res, 'Failed to fetch workspace');
  return res.json();
}

export async function updateWorkspaceConfig(configYaml: string, revision?: string): Promise<{ success: boolean; config: WorkspaceConfig; revision?: string; }> {
  const res = await fetch(`${API_BASE}/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configYaml, revision }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update workspace configuration');
  }
  return res.json();
}

export async function renderNoteTemplate(params: { notebookId: string; templateId: string; title: string; }): Promise<{ content: string; metadata: Record<string, unknown>; }> {
  const url = `${API_BASE}/templates/render?notebookId=${encodeURIComponent(params.notebookId)}&templateId=${encodeURIComponent(params.templateId)}&title=${encodeURIComponent(params.title)}`;
  const res = await fetch(url);
  if (!res.ok) throw await responseError(res, 'Failed to render template');
  return res.json();
}

export async function readNote(path: string, notebookId?: string): Promise<NoteItem> {
  const url = `${API_BASE}/notes/read?path=${encodeURIComponent(path)}${notebookId ? `&notebookId=${encodeURIComponent(notebookId)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw await responseError(res, 'Failed to read note');
  const data = await res.json();
  return data.note;
}

export async function readNotes(paths: string[], revision: string): Promise<NoteItem[]> {
  const res = await fetch(`${API_BASE}/notes/read-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, revision }) });
  if (!res.ok) throw await responseError(res, 'Failed to review notes');
  return (await res.json()).notes;
}

export async function saveNote(params: { path: string; content: string; metadata?: Record<string, unknown>; commitMessage?: string; createOnly?: boolean; revision?: string; noCommit?: boolean; notebookId?: string; }): Promise<{ success: boolean; note: NoteItem; commit?: { commitHash: string; }; committed?: boolean; }> {
  const res = await fetch(`${API_BASE}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new ApiError(err.error || 'Failed to save note', res.status);
  }
  return res.json();
}

export async function deleteNote(path: string, options?: { noCommit?: boolean; }): Promise<{ success: boolean; committed?: boolean; }> {
  const url = `${API_BASE}/notes?path=${encodeURIComponent(path)}${options?.noCommit ? '&noCommit=true' : ''}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

/**
 * Sets each listed note's `tags` array exactly, in one commit. Used for tag rename/merge/
 * delete and for undoing any of them — the caller computes the target `tags` per note
 * (see `@mygitnotes/core`'s `planTagRename`/`planTagMerge`/`planTagDelete`/
 * `invertTagOperationPlan`); this endpoint only writes and commits.
 */
export async function applyTagChange(entries: { path: string; notebookId: string; tags: string[]; }[], revision: string, message?: string): Promise<{ success: boolean; changedPaths: string[]; commit?: { commitHash: string; }; revision?: string; }> {
  const res = await fetch(`${API_BASE}/tags/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries, revision, message }) });
  if (!res.ok) throw await responseError(res, 'Failed to update tags');
  return res.json();
}

export async function restoreNote(params: { path: string; content?: string; metadata?: Record<string, unknown>; notebookId?: string; }): Promise<{ success: boolean; note: NoteItem | null; }> {
  const res = await fetch(`${API_BASE}/notes/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw new Error('Failed to restore note');
  return res.json();
}

export async function fetchAgentResources(): Promise<{ instructions: AgentResource[]; skills: AgentResource[]; docs: AgentResource[]; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources`);
  if (!res.ok) throw new Error('Failed to fetch agent resources');
  return res.json();
}

export async function readAgentResource(path: string): Promise<{ path: string; content: string; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error('Failed to read agent resource');
  return res.json();
}

export async function saveAgentResource(params: { path: string; content: string; revision?: string; }): Promise<{ success: boolean; path: string; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save agent resource');
  }
  return res.json();
}

export async function renameAgentSkill(params: { path: string; slug: string; content: string; revision?: string; }): Promise<{ success: boolean; path: string; changedPaths?: string[]; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to rename skill');
  }
  return res.json();
}

export async function restoreAgentResource(path: string, revision?: string): Promise<{ success: boolean; path: string; content: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, revision }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to restore agent resource');
  }
  return res.json();
}

export async function fetchAssets(notebookId: string): Promise<AssetItem[]> {
  const res = await fetch(`${API_BASE}/assets?notebookId=${encodeURIComponent(notebookId)}`);
  if (!res.ok) throw new Error('Failed to fetch assets');
  const data = await res.json();
  return data.assets || [];
}

export async function uploadAsset(notebookId: string, filename: string, base64Content: string, options: { directory?: string; revision?: string; } = {}): Promise<{ success: boolean; filename: string; path: string; markdownRef: string; }> {
  const res = await fetch(`${API_BASE}/assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notebookId, filename, base64Content, ...options }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to upload asset');
  }
  return res.json();
}

export async function deleteAsset(path: string, options?: { noCommit?: boolean; revision?: string; }): Promise<{ success: boolean; committed?: boolean; }> {
  const url = `${API_BASE}/assets?path=${encodeURIComponent(path)}${(options?.noCommit ? '&noCommit=true' : '') + (options?.revision ? '&revision=' + encodeURIComponent(options.revision) : '')}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete asset');
  }
  return res.json();
}

export async function fetchGitStatus(): Promise<{ status: GitStatus; commits: GitCommit[]; }> {
  const res = await fetch(`${API_BASE}/git/status`);
  if (!res.ok) throw new Error('Failed to fetch git status');
  return res.json();
}

export async function fetchFileChanges(): Promise<import('./types.js').FileChange[]> {
  const response = await fetch(`${API_BASE}/git/changes`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to read changes');
  return data.changes;
}
export async function fetchFileDiff(file: string, side: 'working' | 'staged' | 'current'): Promise<string> {
  const response = await fetch(`${API_BASE}/git/file-diff?path=${encodeURIComponent(file)}&side=${side}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to read diff');
  return data.diff;
}
export async function manageFileChange(file: import('./types.js').FileChange, action: 'stage' | 'unstage' | 'restore'): Promise<{ backup?: string; }> {
  const response = await fetch(`${API_BASE}/git/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path, revision: file.revision, action }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'File operation failed');
  return data;
}
export async function commitStagedChanges(files: import('./types.js').FileChange[], message: string, selected = false) {
  const response = await fetch(`${API_BASE}/git/commit-staged`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: files.map(file => file.path), revisions: Object.fromEntries(files.map(file => [file.path, file.revision])), message, selected }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Commit failed');
}

export async function fetchGitDiff(path?: string): Promise<string> {
  const url = path ? `${API_BASE}/git/diff?path=${encodeURIComponent(path)}` : `${API_BASE}/git/diff`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch git diff');
  const data = await res.json();
  return data.diff || '';
}

export async function generateSemanticCommit(diff: string, filePath?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/git/semantic-commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diff, filePath }) });
  if (!res.ok) return 'minor-mod';
  const data = await res.json();
  return data.message || 'minor-mod';
}

export async function createCommit(files: string[], message: string): Promise<{ success: boolean; }> {
  const res = await fetch(`${API_BASE}/git/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, message }) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to commit changes');
  }
  return res.json();
}

export class GitSyncError extends Error {
  constructor(message: string, public code: string, public files: string[]) {
    super(message);
  }
}

export async function syncGitWorkspace(strategy?: 'remote' | 'local'): Promise<{ upstream: string; pulled: number; pushed: number; backup?: string; }> {
  const res = await fetch(`${API_BASE}/git/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(strategy ? { strategy } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GitSyncError(data.error || 'Sync failed', data.code || 'FAILED', data.files || []);
  return data.result;
}

export class CoreUpdateApiError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}
export async function fetchCoreStatus(): Promise<import('@mygitnotes/core').CoreStatus> {
  const res = await fetch(`${API_BASE}/core/status`);
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to check Core status', data.code || 'STATUS_FAILED');
  return data.status;
}
export async function installCoreSyncWorkflow(): Promise<void> {
  const res = await fetch(`${API_BASE}/core/install`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to install Core sync', data.code || 'INSTALL_FAILED');
}
export async function fetchCoreUpdateRun(requestId: string): Promise<import('@mygitnotes/core').CoreUpdateRun> {
  const res = await fetch(`${API_BASE}/core/runs/${encodeURIComponent(requestId)}`);
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to follow Core update', data.code || 'RUN_STATUS_FAILED');
  return data.run;
}
export async function runCoreUpdate(autoPush = false): Promise<{ result: { success?: boolean; alreadyUpToDate?: boolean; accepted?: boolean; receipt?: import('@mygitnotes/core').CoreUpdateReceipt; }; }> {
  const res = await fetch(`${API_BASE}/core/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoPush }) });
  const data = await res.json();
  if (!res.ok) throw new CoreUpdateApiError(data.error || 'Failed to run Core update', data.code || 'UPDATE_FAILED');
  return data;
}

export async function fetchFolders(): Promise<FolderItem[]> {
  const res = await fetch(`${API_BASE}/folders`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch folders');
  return data.folders;
}

export async function moveAsset(params: { path: string; directory: string; revision?: string; }): Promise<{ path: string; }> {
  const res = await fetch(`${API_BASE}/assets`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Failed to move asset', res.status);
  return data;
}
