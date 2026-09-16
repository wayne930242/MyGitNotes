import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const CONFIRM_WINDOW_MS = 4000;

/** First call arms the given path; a second call for the same path fires the delete. */
export function nextDeleteConfirmState(pendingPath: string | null, path: string, requireConfirm: boolean): { pendingPath: string | null; shouldDelete: boolean } {
  if (!requireConfirm || pendingPath === path) return { pendingPath: null, shouldDelete: true };
  return { pendingPath: path, shouldDelete: false };
}

export function useDeleteConfirm(requireConfirm: boolean, onConfirmed: (path: string) => void) {
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingPath) return;
    const timer = setTimeout(() => setPendingPath(null), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [pendingPath]);
  const latest = useRef({ requireConfirm, onConfirmed });
  useLayoutEffect(() => { latest.current = { requireConfirm, onConfirmed }; });
  const requestDeleteRef = useRef((path: string) => {
    setPendingPath(current => {
      const next = nextDeleteConfirmState(current, path, latest.current.requireConfirm);
      if (next.shouldDelete) latest.current.onConfirmed(path);
      return next.pendingPath;
    });
  });
  return { pendingDeletePath: pendingPath, requestDelete: requestDeleteRef.current };
}
