import type { RepositoryId } from '@mygitnotes/core/repository';

/** One member of the workspace as Settings → Repositories lists it (the local server's `MemberStatus`). */
export interface WorkspaceMemberStatus {
  id: RepositoryId;
  alias: string;
  type: 'github' | 'gitlab' | 'local';
  repository?: string;
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
}

/** A refused membership change; `code` tells a stale read (`stale`) or a missing folder (`folder-required`) from a refusal. */
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
export const setMemberHidden = (repository: RepositoryId, hidden: boolean, revision: string) => send('PATCH', '/api/workspace/members', { repository, hidden, revision });
export const setDefaultMember = (repository: RepositoryId, revision: string) => send('PATCH', '/api/workspace/members', { repository, default: true, revision });
export const reorderMembers = (order: RepositoryId[], revision: string) => send('PUT', '/api/workspace/members/order', { order, revision });
export const removeMember = (repository: RepositoryId, revision: string) => send('DELETE', `/api/workspace/members?${new URLSearchParams({ repository, revision })}`);
