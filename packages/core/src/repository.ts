import { SourceError } from './github-api.js';
import type { NotebookKey } from './notebook-key.js';
import { type SourceConfig, sourceIdentity } from './source-config.js';
import type { WorkspaceConfig } from './types.js';
import type { ResolvedPreferences } from './workspace-preferences.js';
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
  if (home.type === 'local' || other.type === 'local') return home.type === other.type;
  return home.type === other.type && home.url === other.url;
}

/** Why a repository cannot serve this request; `invalid-manifest` covers a manifest that does not load, an unsupported schema and a notebook still using `source`. */
export type UnavailableReason = 'unmapped' | 'no-access' | 'missing-branch' | 'unsupported-platform' | 'invalid-manifest';

/** The provider refused the repository (`no-access`) or its branch (`missing-branch`); keeps the provider's status and message. */
export class RepositoryUnavailableError extends SourceError {
  constructor(readonly reason: 'no-access' | 'missing-branch', message: string, status: number) {
    super(message, status);
  }
}

/** Statuses that mean the provider refused a step. GitHub reports a missing branch or an empty repository as 422, which `GitHubApi` passes on as 409. */
const REFUSALS: Record<RepositoryUnavailableError['reason'], number[]> = { 'no-access': [401, 403, 404], 'missing-branch': [404, 409, 422] };

/** Runs one step of reaching a repository, naming a refusal by `reason`. */
export async function reaching<T>(reason: RepositoryUnavailableError['reason'], step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof SourceError && !(error instanceof RepositoryUnavailableError) && REFUSALS[reason].includes(error.status)) throw new RepositoryUnavailableError(reason, error.message, error.status);
    throw error;
  }
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
  /** The repository's alias in this workspace, the first part of its notebooks' keys. */
  alias: string;
  /** Keys of the notebooks this repository serves. */
  notebooks: NotebookKey[];
  unavailable?: UnavailableRepository['unavailable'];
  /** The repository's display name: its manifest's `workspace.title`, or the repository's name when it keeps no manifest. */
  title: string;
  /** Where opening this repository lands; null while its manifest supplies no notebook. */
  defaultNotebook: NotebookKey | null;
  /** The preferences of this repository's notebooks; a device's own choices still win in the browser. */
  preferences: ResolvedPreferences;
  /** The manifest as this repository stores it (local ids), or the one "create manifest" would write; null when it cannot be read. */
  config: WorkspaceConfig | null;
  /** The manifest's revision, sent back when saving it; empty when it cannot be saved. */
  configRevision: string;
  /** `derived`: the repository keeps no manifest yet, and `config` is what saving it creates. */
  manifest?: 'derived';
  /** Why this repository's own manifest cannot be loaded, with its text so Settings can fix it; the repository is then unavailable. */
  manifestError?: { message: string; text: string; };
}
/** The answer of `GET /api/workspace`. */
export interface WorkspaceStatus {
  /**
   * Every notebook of the workspace as one manifest, named by key: the default repository's title, default notebook
   * and preferences, with each notebook's `id` its key; null while no repository supplies a notebook.
   */
  keyedConfig: WorkspaceConfig | null;
  local: boolean;
  /** The default repository; null in a workspace without one. */
  defaultRepository: RepositoryId | null;
  repositories: RepositoryStatus[];
  /** The default worktree, in a local workspace. */
  repoRoot?: string;
  /** The deployment lets each visitor choose their repository, so the app offers to switch it. */
  repositoryChoice?: boolean;
  /** Whether Settings offers Core updates: for the local Core checkout, or for a remote deployment's product repository. */
  coreUpdate: boolean;
}
