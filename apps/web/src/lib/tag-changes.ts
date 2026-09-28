import type { RepositoryId } from '@mygitnotes/core/repository';
import { applyTagChange } from './api.js';
import { groupByRepository, type WorkspaceRepository } from './workspace-repositories.js';

export interface TagEntry {
  path: string;
  notebookId: string;
  tags: string[];
}

/** A tag change stopped part way; `committed` names the repositories whose commit landed before the failure. */
export class PartialTagChangeError extends Error {
  constructor(message: string, readonly committed: RepositoryId[]) {
    super(message);
  }
}

/**
 * Applies tag entries one repository at a time, one commit each, in the order their notebooks first appear, and stops at
 * the first failure. `onCommitted` receives each repository's new revision as its commit lands.
 */
export async function applyTagEntries(repositories: WorkspaceRepository[], entries: TagEntry[], message: string, onCommitted: (repository: WorkspaceRepository, revision: string | undefined) => void): Promise<void> {
  const committed: RepositoryId[] = [];
  for (const { repository, items } of groupByRepository(repositories, entries, entry => entry.notebookId)) {
    try {
      const result = await applyTagChange(repository.id, items, repository.revision, message);
      committed.push(repository.id);
      onCommitted(repository, result.revision);
    } catch (error) {
      if (!committed.length) throw error;
      throw new PartialTagChangeError((error as Error).message, committed);
    }
  }
}
