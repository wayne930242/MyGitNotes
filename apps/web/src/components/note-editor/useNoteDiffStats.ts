import { useEffect, useRef, useState } from 'react';
import { type DiffStats, diffStats } from '../../lib/diff-preview.js';

/**
 * Line counts of the note's uncommitted changes, read again each time the editor settles with
 * every edit saved, so they follow what Commit would record; null while the note is clean or its
 * diff has no line preview.
 */
export function useNoteDiffStats(readDiff: (() => Promise<string>) | undefined, dirty: boolean, settled: boolean): DiffStats | null {
  const [stats, setStats] = useState<DiffStats | null>(null);
  // The host rebuilds `readDiff` on every render; the latest one is read once edits settle.
  const reader = useRef(readDiff);
  useEffect(() => {
    reader.current = readDiff;
  });
  const enabled = Boolean(readDiff) && dirty;
  useEffect(() => {
    const read = reader.current;
    if (!enabled || !settled || !read) return;
    let cancelled = false;
    read().then(diff => {
      if (!cancelled) setStats(diffStats(diff));
    }, (error: unknown) => {
      // The counts only annotate the footer; Commit and Restore keep working without them.
      console.warn('Could not read the note diff.', error);
      if (!cancelled) setStats(null);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, settled]);
  return enabled ? stats : null;
}
