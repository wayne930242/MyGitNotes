import type { RepositoryId } from '@mygitnotes/core/repository';

/** One member of the workspace as Settings → Repositories lists it (the local server's `MemberStatus`). */
export interface WorkspaceMemberStatus {
  id: RepositoryId;
  alias: string;
  type: 'github' | 'gitlab' | 'local';
  repository?: string;
  /** The branch that keys this member's drafts, as the workspace reports it; a hidden member's drafts are found by it. */
  branch?: string;
  path?: string;
  default: boolean;
  hidden: boolean;
  folder?: string;
  editable: 'server-file' | 'account' | 'environment' | 'none';
}
/** The answer of `GET /api/workspace/members`. */
export interface MembersAnswer {
  members: WorkspaceMemberStatus[];
  changeable: boolean;
  revision: string | null;
  sharedAssetKeys: boolean;
  environment?: string;
  /** Each visitor opens the one repository they chose, and switches it with Switch repository. */
  repositoryChoice?: true;
  /** Hidden repositories of a hosted deployment, which its visitors are told the number of but not the names. */
  hiddenUnnamed?: number;
  /** What adding takes where the list can be changed: a worktree path, or a repository from the picker (an account's list). */
  adds?: 'worktree' | 'repository';
  /** How many visible repositories the list may have, where it is limited; hidden ones never count. */
  limit?: MembersLimit;
}
/** The visible-repository limit, as Settings shows it. */
export interface MembersLimit {
  visible: number;
  max: number;
  plan?: string;
  upgradeUrl?: string;
}
/** The answer of `GET /api/workspace/members/folders`: the branch's top-level folders, and whether it keeps a manifest. */
export interface MemberFolders {
  repository: string;
  branch: string;
  manifest: boolean;
  folders: string[];
}

/** A refused membership change; `code` tells a stale read (`stale`), a missing folder (`folder-required`) or a reached limit (`visible-limit`) from a refusal. */
export class MembershipApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function send(method: string, url: string, body?: unknown): Promise<{ revision: string; }> {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new MembershipApiError(data.error || 'The repositories could not be changed.', response.status, data.code);
  return data;
}

/** The workspace's members, hidden ones included; no repository is opened to list them. */
export async function fetchMembers(): Promise<MembersAnswer> {
  const response = await fetch('/api/workspace/members');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new MembershipApiError(data.error || 'The repositories could not be listed.', response.status, data.code);
  return data;
}

export const addMember = (path: string, revision: string, folder?: string) => send('POST', '/api/workspace/members', { path, revision, ...(folder ? { folder } : {}) });
/** Adds a repository from the picker, on `branch` (its default branch when none), with `folder` when it keeps no manifest. */
export const addRepositoryMember = (repository: string, branch: string | undefined, revision: string, folder?: string) => send('POST', '/api/workspace/members', { repository, ...(branch ? { branch } : {}), revision, ...(folder ? { folder } : {}) });
/** The top-level folders of a repository's branch, read with the person's sign-in, for the add flow's folder step. */
export async function fetchMemberFolders(repository: string, branch?: string): Promise<MemberFolders> {
  const response = await fetch(`/api/workspace/members/folders?${new URLSearchParams({ repository, ...(branch ? { branch } : {}) })}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new MembershipApiError(data.error || 'The folders could not be listed.', response.status, data.code);
  return data;
}
export const setMemberHidden = (repository: RepositoryId, hidden: boolean, revision: string) => send('PATCH', '/api/workspace/members', { repository, hidden, revision });
export const setDefaultMember = (repository: RepositoryId, revision: string) => send('PATCH', '/api/workspace/members', { repository, default: true, revision });
export const reorderMembers = (order: RepositoryId[], revision: string) => send('PUT', '/api/workspace/members/order', { order, revision });
export const removeMember = (repository: RepositoryId, revision: string) => send('DELETE', `/api/workspace/members?${new URLSearchParams({ repository, revision })}`);
