import {
  WorkspaceConfig,
  FolderItem,
  NoteItem,
  AssetItem,
  AgentResource,
  GitStatus,
  GitCommit,
} from './types.js';

const API_BASE = '/api';
export async function commitRemoteNotes(notes: { path: string; content: string; metadata: Record<string, unknown>; createOnly?: boolean }[], revision: string, message: string): Promise<{ revision: string; commit: { commitHash: string } }> {
  const res = await fetch(`${API_BASE}/notes/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes, revision, message }) });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || 'Failed to commit notes', res.status);
  return data;
}
export class ApiError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) { super(message); }
}

async function responseError(res: Response, fallback: string): Promise<ApiError> {
  const data = await res.json().catch(() => ({}));
  const seconds = Number(res.headers.get('Retry-After') || data.retryAfter);
  return new ApiError(data.error || fallback, res.status, Number.isFinite(seconds) && seconds > 0 ? seconds : undefined);
}

export async function fetchWorkspace(fresh = false): Promise<{
  repoRoot: string;
  branch: string;
  config: WorkspaceConfig | null;
  gitStatus: GitStatus;
  isCoreBranch: boolean;
  source: { type: 'local' | 'github'; identity: string; repository?: string };
  capabilities: { write: boolean; local: boolean };
  revision?: string;
}> {
  const res = await fetch(`${API_BASE}/workspace${fresh ? '?fresh=1' : ''}`);
  if (!res.ok) throw await responseError(res, 'Failed to fetch workspace');
  return res.json();
}

export async function updateWorkspaceConfig(configYaml: string): Promise<{ success: boolean; config: WorkspaceConfig }> {
  const res = await fetch(`${API_BASE}/workspace/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configYaml }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update workspace configuration');
  }
  return res.json();
}

export async function fetchNotes(notebookId?: string): Promise<NoteItem[]> {
  const url = notebookId
    ? `${API_BASE}/notes?notebookId=${encodeURIComponent(notebookId)}`
    : `${API_BASE}/notes`;
  const res = await fetch(url);
  if (!res.ok) throw await responseError(res, 'Failed to fetch notes');
  const data = await res.json();
  return data.notes || [];
}

export async function readNote(path: string, notebookId?: string): Promise<NoteItem> {
  const url = `${API_BASE}/notes/read?path=${encodeURIComponent(path)}${
    notebookId ? `&notebookId=${encodeURIComponent(notebookId)}` : ''
  }`;
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

export async function saveNote(params: {
  path: string;
  content: string;
  metadata?: Record<string, unknown>;
  commitMessage?: string;
  createOnly?: boolean;
  revision?: string;
  noCommit?: boolean;
  notebookId?: string;
}): Promise<{ success: boolean; note: NoteItem; commit?: { commitHash: string }; committed?: boolean }> {
  const res = await fetch(`${API_BASE}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new ApiError(err.error || 'Failed to save note', res.status);
  }
  return res.json();
}

export async function deleteNote(
  path: string,
  options?: { noCommit?: boolean }
): Promise<{ success: boolean; committed?: boolean }> {
  const url = `${API_BASE}/notes?path=${encodeURIComponent(path)}${
    options?.noCommit ? '&noCommit=true' : ''
  }`;
  const res = await fetch(url, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

export async function restoreNote(params: {
  path: string;
  content?: string;
  metadata?: Record<string, unknown>;
  notebookId?: string;
}): Promise<{ success: boolean; note: NoteItem }> {
  const res = await fetch(`${API_BASE}/notes/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to restore note');
  return res.json();
}

export async function fetchAgentResources(): Promise<{
  instructions: AgentResource[];
  skills: AgentResource[];
  docs: AgentResource[];
  revision?: string;
}> {
  const res = await fetch(`${API_BASE}/agent-resources`);
  if (!res.ok) throw new Error('Failed to fetch agent resources');
  return res.json();
}

export async function readAgentResource(path: string): Promise<{ path: string; content: string; revision?: string }> {
  const res = await fetch(`${API_BASE}/agent-resources/read?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error('Failed to read agent resource');
  return res.json();
}

export async function saveAgentResource(params: {
  path: string;
  content: string;
  revision?: string;
}): Promise<{ success: boolean; path: string; revision?: string }> {
  const res = await fetch(`${API_BASE}/agent-resources/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to save agent resource');
  }
  return res.json();
}

export async function restoreAgentResource(path: string): Promise<{ success: boolean; path: string; content: string }> {
  const res = await fetch(`${API_BASE}/agent-resources/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
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

export async function uploadAsset(
  notebookId: string,
  filename: string,
  base64Content: string,
  options: { directory?: string; revision?: string } = {}
): Promise<{ success: boolean; filename: string; path: string; markdownRef: string }> {
  const res = await fetch(`${API_BASE}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebookId, filename, base64Content, ...options }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to upload asset');
  }
  return res.json();
}

export async function deleteAsset(
  path: string,
  options?: { noCommit?: boolean; revision?: string }
): Promise<{ success: boolean; committed?: boolean }> {
  const url = `${API_BASE}/assets?path=${encodeURIComponent(path)}${
    (options?.noCommit ? '&noCommit=true' : '') + (options?.revision ? '&revision=' + encodeURIComponent(options.revision) : '')
  }`;
  const res = await fetch(url, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to delete asset');
  }
  return res.json();
}

export async function fetchGitStatus(): Promise<{ status: GitStatus; commits: GitCommit[] }> {
  const res = await fetch(`${API_BASE}/git/status`);
  if (!res.ok) throw new Error('Failed to fetch git status');
  return res.json();
}

export async function fetchGitDiff(path?: string): Promise<string> {
  const url = path ? `${API_BASE}/git/diff?path=${encodeURIComponent(path)}` : `${API_BASE}/git/diff`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch git diff');
  const data = await res.json();
  return data.diff || '';
}

export async function generateSemanticCommit(diff: string, filePath?: string): Promise<string> {
  const res = await fetch(`${API_BASE}/git/semantic-commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diff, filePath }),
  });
  if (!res.ok) return 'minor-mod';
  const data = await res.json();
  return data.message || 'minor-mod';
}

export async function createCommit(files: string[], message: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/git/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, message }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to commit changes');
  }
  return res.json();
}

export async function runCoreUpdate(autoPush = false): Promise<{ result: { success: boolean; message: string } }> {
  const res = await fetch(`${API_BASE}/core/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoPush }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to run core update');
  }
  return res.json();
}

export async function fetchFolders(): Promise<FolderItem[]> {
  const res = await fetch(`${API_BASE}/folders`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch folders');
  return data.folders;
}

export async function moveAsset(params: { path: string; directory: string; revision?: string }): Promise<{ path: string }> {
  const res = await fetch(`${API_BASE}/assets`, { method:'PATCH', headers:{'Content-Type':'application/json'},body:JSON.stringify(params) });
  const data = await res.json(); if (!res.ok) throw new ApiError(data.error || 'Failed to move asset', res.status); return data;
}
