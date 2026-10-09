/** One repository the signed-in person may open or add: the deployment lists those they can push to. */
export interface AvailableRepository {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
  /**
   * The workspace member this repository already is, where the list source knows it; the picker then offers to show a
   * hidden one instead of adding it again. Without it the picker matches the workspace's members by name.
   */
  member?: { id: string; hidden: boolean; };
}

/** One page of the repositories a person may open or add, with where to grant or create more. */
export interface AvailableRepositories {
  repositories: AvailableRepository[];
  /** How many match in all; the page holds the most recently updated. */
  total: number;
  githubApp: boolean;
  /** Where the person grants the GitHub App more repositories. */
  installUrl: string | null;
  /** GitHub's page for a new repository from the starter template; absent on an Enterprise site that names no template. */
  newRepositoryUrl: string | null;
}

/** Lists the repositories matching `query`; an edition may supply its own (`WebFeature.repositoryList`). */
export type RepositoryListSource = (query: string, signal: AbortSignal) => Promise<AvailableRepositories>;

/** The deployment's own list: repositories of its GitHub site the signed-in person can push to. */
export const listAvailableRepositories: RepositoryListSource = async (query, signal) => {
  const response = await fetch(`/api/repositories/available?query=${encodeURIComponent(query)}`, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '');
  return body;
};
