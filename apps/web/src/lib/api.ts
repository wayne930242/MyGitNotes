import type { NewVersionRequest } from './history-api.js';
import type { AgentFile, AgentWorkspace } from './agent-workspaces.js';
import { AssetItem, FolderItem, GitCommit, GitStatus, NoteItem, WorkspaceConfig } from './types.js';
import type { RepositoryId } from '@mygitnotes/core/repository';
import type { WorkspaceAnswer } from './workspace-repositories.js';

const API_BASE = '/api';
/** The outcome of pushing one committed note to the Gist its `gist` frontmatter names. */
/** What an edition's publishing service reports for one committed note (see the local server's `PublishSync`). */
export interface PublishSync {
  path: string;
  url?: string;
  error?: string;
  notices?: string[];
}

export interface GistSync {
  path: string;
  gist: string;
  error?: string;
  reauthorize?: boolean;
}

/** Commits drafts of one repository as one commit on it; `gists` reports the published notes it pushed to their Gists, and `published` what an edition's publishing service did with them. */
export async function commitRemoteNotes(repository: RepositoryId, notes: ({ path: string; content: string; metadata: Record<string, unknown>; createOnly?: boolean; } | { path: string; delete: true; })[], revision: string, message: string, documents: { path: string; page: unknown; base: unknown; }[] = [], version?: NewVersionRequest): Promise<{ revision: string; commit: { commitHash: string; }; gists?: GistSync[]; published?: PublishSync[]; }> {
  const res = await fetch(`${API_BASE}/notes/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, notes, revision, message, documents, version }) });
  if (!res.ok) throw await responseError(res, 'Failed to commit notes');
  return res.json();
}
export class ApiError extends Error {
  /** `staleRepositories` names the repositories whose revision a 409 rejected; `reauthorize` means signing in again grants what the request lacked. */
  constructor(message: string, public status: number, public retryAfter?: number, public staleRepositories?: RepositoryId[], public reauthorize = false) {
    super(message);
  }
}

export async function responseError(res: Response, fallback: string): Promise<ApiError> {
  const data = await res.json().catch(() => ({}));
  const seconds = Number(res.headers.get('Retry-After') || data.retryAfter);
  return new ApiError(data.error || fallback, res.status, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined, Array.isArray(data.staleRepositories) ? data.staleRepositories : undefined, data.reauthorize === true);
}

/** Publishes a note body as a secret Gist of the signed-in GitHub account. */
export async function publishGist(note: { path: string; content: string; metadata: Record<string, unknown>; }): Promise<{ id: string; url: string; }> {
  const res = await fetch(`${API_BASE}/gists`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note) });
  if (!res.ok) throw await responseError(res, 'Failed to publish the Gist');
  return res.json();
}

/** Deletes a published Gist; one already gone counts as deleted. */
export async function unpublishGist(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/gists/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await responseError(res, 'Failed to delete the Gist');
}

export async function fetchWorkspace(fresh = false): Promise<WorkspaceAnswer> {
  const res = await fetch(`${API_BASE}/workspace${fresh ? '?fresh=1' : ''}`);
  if (!res.ok) throw await responseError(res, 'Failed to fetch workspace');
  return res.json();
}

/** A local workspace's stream of `change` events, sent when files change in any of its worktrees. */
export const openWorkspaceEvents = () => new EventSource(`${API_BASE}/workspace/events`);

export async function updateWorkspaceConfig(configYaml: string, configRevision: string): Promise<{ success: boolean; config: WorkspaceConfig; configRevision: string; }> {
  const res = await fetch(`${API_BASE}/workspace/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configYaml, configRevision }) });
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

/** Reads notes of one repository at the revision the caller reviewed. */
export async function readNotes(repository: RepositoryId, paths: string[], revision: string): Promise<NoteItem[]> {
  const res = await fetch(`${API_BASE}/notes/read-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, paths, revision }) });
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

export async function deleteNote(path: string, options?: { noCommit?: boolean; notebookId?: string; }): Promise<{ success: boolean; committed?: boolean; pending?: boolean; }> {
  const url = `${API_BASE}/notes?path=${encodeURIComponent(path)}${options?.noCommit ? '&noCommit=true' : ''}${options?.notebookId ? `&notebookId=${encodeURIComponent(options.notebookId)}` : ''}`;
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
/** Rewrites the tags of notes in one repository as one commit on it. */
export async function applyTagChange(repository: RepositoryId, entries: { path: string; notebookId: string; tags: string[]; }[], revision: string, message?: string): Promise<{ success: boolean; changedPaths: string[]; commit?: { commitHash: string; }; revision?: string; }> {
  const res = await fetch(`${API_BASE}/tags/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, entries, revision, message }) });
  if (!res.ok) throw await responseError(res, 'Failed to update tags');
  return res.json();
}

export async function restoreNote(params: { path: string; content?: string; metadata?: Record<string, unknown>; notebookId?: string; }): Promise<{ success: boolean; note: NoteItem | null; }> {
  const res = await fetch(`${API_BASE}/notes/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) throw new Error('Failed to restore note');
  return res.json();
}

/** The agent workspaces of every available repository. */
export async function fetchAgentWorkspaces(): Promise<AgentWorkspace[]> {
  const res = await fetch(`${API_BASE}/agent-resources/workspaces`);
  if (!res.ok) throw new Error('Failed to fetch agent workspaces');
  return (await res.json()).workspaces;
}

/** The workspaces and workspace files of one repository (the home repository without `repository`); each repository keeps its own. */
export async function fetchAgentResources(repository?: string): Promise<{ workspaces: AgentWorkspace[]; files: AgentFile[]; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch agent resources');
  return res.json();
}

export async function readAgentResource(path: string, repository?: string): Promise<{ path: string; content: string; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/read?path=${encodeURIComponent(path)}${repository ? `&repository=${encodeURIComponent(repository)}` : ''}`);
  if (!res.ok) throw new Error('Failed to read agent resource');
  return res.json();
}

export async function saveAgentResource(params: { path: string; content: string; revision?: string; create?: boolean; repository?: string; }): Promise<{ success: boolean; path: string; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save agent resource');
  }
  return res.json();
}

export async function renameAgentSkill(params: { path: string; slug: string; content: string; revision?: string; repository?: string; }): Promise<{ success: boolean; path: string; changedPaths?: string[]; revision?: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/rename-skill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to rename skill');
  }
  return res.json();
}

export async function restoreAgentResource(path: string, revision?: string, repository?: string): Promise<{ success: boolean; path: string; content: string; }> {
  const res = await fetch(`${API_BASE}/agent-resources/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, revision, repository }) });
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

/** Git status of one worktree, the home worktree without `repository`. */
export async function fetchGitStatus(repository?: string): Promise<{ status: GitStatus; commits: GitCommit[]; }> {
  const res = await fetch(`${API_BASE}/git/status${repository ? `?repository=${encodeURIComponent(repository)}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch git status');
  return res.json();
}

export async function fetchFileChanges(): Promise<import('./types.js').FileChange[]> {
  const response = await fetch(`${API_BASE}/git/changes`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to read changes');
  return data.changes;
}
const repositoryParam = (repository?: string) => repository ? `&repository=${encodeURIComponent(repository)}` : '';
export async function fetchFileDiff(file: Pick<import('./types.js').FileChange, 'path' | 'repository'>, side: 'working' | 'staged' | 'current'): Promise<string> {
  const response = await fetch(`${API_BASE}/git/file-diff?path=${encodeURIComponent(file.path)}&side=${side}${repositoryParam(file.repository)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to read diff');
  return data.diff;
}
export async function manageFileChange(file: import('./types.js').FileChange, action: 'stage' | 'unstage' | 'restore'): Promise<{ backup?: string; }> {
  const response = await fetch(`${API_BASE}/git/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: file.path, revision: file.revision, action, repository: file.repository }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'File operation failed');
  return data;
}
/** A commit run that stopped at a repository; `committed` names the repositories already committed. */
export class PartialCommitError extends Error {
  constructor(message: string, public committed: string[]) {
    super(message);
  }
}
/** Commits each worktree's files in turn, one commit per worktree, stopping at the first that fails. */
export async function commitStagedChanges(files: import('./types.js').FileChange[], message: string, selected = false, version?: NewVersionRequest) {
  const groups = new Map<string | undefined, import('./types.js').FileChange[]>();
  for (const file of files) groups.set(file.repository, [...groups.get(file.repository) ?? [], file]);
  const committed: string[] = [];
  for (const [repository, group] of groups) {
    const response = await fetch(`${API_BASE}/git/commit-staged`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository, files: group.map(file => file.path), revisions: Object.fromEntries(group.map(file => [file.path, file.revision])), message, selected, version }) });
    const data = await response.json();
    if (!response.ok) throw new PartialCommitError(data.error || 'Commit failed', committed);
    if (repository) committed.push(repository);
  }
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

/** Pulls and pushes one worktree, the home worktree when `repository` is absent. */
export async function syncGitWorkspace(strategy?: 'remote' | 'local', repository?: string, pullOnly?: boolean): Promise<{ upstream: string; pulled: number; pushed: number; backup?: string; }> {
  const res = await fetch(`${API_BASE}/git/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(strategy ? { strategy } : {}), ...(repository ? { repository } : {}), ...(pullOnly ? { pullOnly } : {}) }) });
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
