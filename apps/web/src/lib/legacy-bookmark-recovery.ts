import { BookmarksPageSchema } from '@mygitnotes/core/bookmarks';

export interface LegacyBookmarkRecovery {
  repository: string;
  raw: string;
  malformed: boolean;
}
export const legacyBookmarkDraftKey = (repository: string) => `github-notes:bookmarks-draft:${repository}`;

/** Read exact envelopes from every configured repository, including inactive/unavailable ones. */
export function legacyBookmarkRecoveries(repositories: readonly string[], storage: Pick<Storage, 'getItem'> = localStorage): LegacyBookmarkRecovery[] {
  return [...new Set(repositories)].flatMap(repository => {
    const raw = storage.getItem(legacyBookmarkDraftKey(repository));
    if (raw === null) return [];
    let malformed = false;
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || !('page' in value) || !('base' in value) || !('revision' in value) || typeof value.revision !== 'string') malformed = true;
      else malformed = !BookmarksPageSchema.safeParse(value.page).success || !BookmarksPageSchema.safeParse(value.base).success;
    } catch {
      malformed = true;
    }
    return [{ repository, raw, malformed }];
  });
}

/** Confirmation is repository-specific and binds to the exact envelope the user reviewed. */
export function discardLegacyBookmarkRecovery(recovery: LegacyBookmarkRecovery, confirmedRepository: string, storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): void {
  if (confirmedRepository !== recovery.repository) throw new Error('Confirm the repository whose recovery draft will be discarded.');
  const key = legacyBookmarkDraftKey(recovery.repository);
  if (storage.getItem(key) !== recovery.raw) throw new Error('The recovery draft changed. Review it again before discarding.');
  storage.removeItem(key);
}
