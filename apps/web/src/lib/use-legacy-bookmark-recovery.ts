import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { legacyBookmarkRecoveries, type LegacyBookmarkRecovery } from './legacy-bookmark-recovery.js';

/** Retired drafts never enter an editable document controller or acquire a new base. */
export function useLegacyBookmarkRecovery(repositoryIds: string[]) {
  const key = JSON.stringify(repositoryIds);
  const [revision, changed] = useReducer((value: number) => value + 1, 0);
  const refresh = useCallback(() => changed(), []);
  const state = useMemo((): { recoveries: LegacyBookmarkRecovery[]; error: string; } => {
    try {
      return { recoveries: legacyBookmarkRecoveries(JSON.parse(key) as string[]), error: '' };
    } catch (error) {
      return { recoveries: [], error: (error as Error).message };
    }
    // Revision is an explicit invalidation for changes to external browser storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  useEffect(() => {
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { ...state, refresh };
}
