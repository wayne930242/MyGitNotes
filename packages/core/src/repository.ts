import { SourceError } from './github-api.js';
import { type SourceConfig, sourceIdentity } from './source-config.js';
import type { WorkspaceConfig } from './types.js';
import type { UnavailableRepository } from './workspace-repositories.js';

/** Stable identity of one repository and branch, as `sourceIdentity` spells it. */
export type RepositoryId = string;
export interface RepositoryRef {
  id: RepositoryId;
  source: SourceConfig;
}
/** One commit identity per repository a read or write involves. */
export type RevisionSet = Record<RepositoryId, string>;
/** The workspace manifest restricted to the notebooks one repository serves. */
export type RepositoryScope = () => Promise<WorkspaceConfig>;
/** A repository checked out as a worktree on this machine. */
export interface LocalRepository {
  id: RepositoryId;
  root: string;
}

export function repositoryRef(source: SourceConfig): RepositoryRef {
  return { id: sourceIdentity(source), source };
}

/** Whether the credential signed in for `home` also reaches `other`: the same platform and site. */
export function sharesCredential(home: SourceConfig, other: SourceConfig): boolean {
  if (home.type !== other.type) return false;
  return home.type !== 'gitlab' || (other.type === 'gitlab' && home.url === other.url);
}

/** A read or write named revisions that some repositories no longer hold. */
export class StaleRevisionError extends SourceError {
  constructor(readonly repositories: RepositoryId[], message = 'The repository changed. Reload to continue from the latest revision.') {
    super(message, 409);
  }
}

/** One repository of a workspace as `GET /api/workspace` reports it. */
export interface RepositoryStatus {
  id: RepositoryId;
  type: SourceConfig['type'];
  /** The platform repository or project; absent for a worktree. */
  repository?: string;
  branch: string;
  /** The branch head, or an empty string for a worktree. */
  revision: string;
  /** Whether the requester may commit to this repository. */
  write: boolean;
  /** Ids of the notebooks this repository serves. */
  notebooks: string[];
  unavailable?: UnavailableRepository['unavailable'];
}
/** The answer of `GET /api/workspace`. */
export interface WorkspaceStatus {
  /** Absent before a worktree has its first manifest. */
  config: WorkspaceConfig | null;
  /** The manifest's own revision, sent back when saving it; empty for a worktree. */
  configRevision: string;
  local: boolean;
  home: RepositoryId;
  repositories: RepositoryStatus[];
  /** The home worktree, in a local workspace. */
  repoRoot?: string;
}
