import type { RepositoryId, RepositoryStatus, RevisionSet, WorkspaceStatus } from '@mygitnotes/core/repository';
import type { GitStatus } from './types.js';
import type { DraftStore } from './working-notes.js';

/** A repository of the workspace; a local worktree also reports its Git status. */
export type WorkspaceRepository = RepositoryStatus & { gitStatus?: GitStatus; };
export type WorkspaceAnswer = Omit<WorkspaceStatus, 'repositories'> & { repositories: WorkspaceRepository[]; };

/** Where one repository's drafts are stored; for the repository a workspace had before it had several, this is the workspace's earlier draft scope, so drafts carry over. */
export const draftScope = (repository: Pick<RepositoryStatus, 'id' | 'branch'>) => `${repository.id}:${repository.branch}`;

/** Where one repository's working changes are stored, with the alias that names their notebooks by key. */
export const draftStore = (repository: Pick<RepositoryStatus, 'id' | 'branch' | 'alias'>): DraftStore => ({ scope: draftScope(repository), alias: repository.alias });

/**
 * The repository serving a notebook. A key of an unavailable repository names it too, though that repository lists no
 * notebook (its own manifest supplies them), so the page can say why the notebook cannot open.
 */
export const repositoryOf = <R extends Pick<RepositoryStatus, 'notebooks' | 'alias' | 'unavailable'>>(repositories: R[], notebookId: string): R | undefined => repositories.find(repository => repository.notebooks.includes(notebookId)) ?? repositories.find(repository => repository.unavailable && notebookId.startsWith(`${repository.alias}~`));

/**
 * The repository a page belongs to, whose title the header shows and whose preferences apply without a note: the
 * repository of the notebook it shows (decision C6), or the default repository on pages that show no single notebook,
 * Settings, Agents and all-notebooks (decision C10). Undefined only when the workspace has no default repository.
 */
export function pageRepository<R extends Pick<RepositoryStatus, 'id' | 'notebooks' | 'alias' | 'unavailable'>>(repositories: R[], defaultRepository: string, page: { tab: string; allNotebooks: boolean; notebookId: string; }): R | undefined {
  const shown = page.tab === 'settings' || page.tab === 'agent' || page.allNotebooks ? undefined : repositoryOf(repositories, page.notebookId);
  return shown ?? repositories.find(repository => repository.id === defaultRepository);
}

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
