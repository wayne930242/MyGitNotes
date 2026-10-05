/**
 * Files in a local workspace changed outside the editor that shows them (an agent, another editor, Git).
 * The workspace's change stream announces it; each open editor reads its note again at once.
 */
const listeners = new Set<() => void>();

export function onWorkspaceFilesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceWorkspaceFilesChanged() {
  for (const listener of listeners) listener();
}
