import type { RepositoryId, RepositoryStatus, RevisionSet, WorkspaceStatus } from '@mygitnotes/core/repository';
import type { GitStatus } from './types.js';
import type { DraftStore } from './working-notes.js';

/** A repository of the workspace; a local worktree also reports its Git status. */
export type WorkspaceRepository = RepositoryStatus & { gitStatus?: GitStatus; };
export type WorkspaceAnswer = Omit<WorkspaceStatus, 'repositories'> & { repositories: WorkspaceRepository[]; };

/** Where one repository's drafts are stored; for the home repository this is the workspace's earlier draft scope, so drafts carry over. */
export const draftScope = (repository: Pick<RepositoryStatus, 'id' | 'branch'>) => `${repository.id}:${repository.branch}`;

/** Where one repository's working changes are stored, with the alias that names their notebooks by key. */
export const draftStore = (repository: Pick<RepositoryStatus, 'id' | 'branch' | 'alias'>): DraftStore => ({ scope: draftScope(repository), alias: repository.alias });

export const repositoryOf = <R extends Pick<RepositoryStatus, 'notebooks'>>(repositories: R[], notebookId: string): R | undefined => repositories.find(repository => repository.notebooks.includes(notebookId));

/** The revisions the workspace's repositories hold; a worktree has none. */
export const revisionSet = (repositories: Pick<RepositoryStatus, 'id' | 'revision'>[]): RevisionSet => Object.fromEntries(repositories.filter(repository => repository.revision).map(repository => [repository.id, repository.revision]));

/** Each notebook's repository, for scoping query revisions. */
export const notebookRepositories = (repositories: Pick<RepositoryStatus, 'id' | 'notebooks'>[]): Record<string, RepositoryId> => Object.fromEntries(repositories.flatMap(repository => repository.notebooks.map(notebookId => [notebookId, repository.id])));

/** Splits items by the repository serving each one's notebook, keeping their order; items of unknown notebooks are rejected. */
export function groupByRepository<T>(repositories: WorkspaceRepository[], items: T[], notebookOf: (item: T) => string): { repository: WorkspaceRepository; items: T[]; }[] {
  const groups = new Map<RepositoryId, { repository: WorkspaceRepository; items: T[]; }>();
  for (const item of items) {
    const repository = repositoryOf(repositories, notebookOf(item));
    if (!repository) throw new Error(`Notebook ${notebookOf(item)} is not served by any repository.`);
    const group = groups.get(repository.id) ?? { repository, items: [] };
    group.items.push(item);
    groups.set(repository.id, group);
  }
  return [...groups.values()];
}
