import { type SourceConfig, sourceIdentity } from './source-config.js';
import type { WorkspaceConfig } from './types.js';

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
