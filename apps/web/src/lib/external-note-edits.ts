/**
 * Counts the edits made to a note's working change from outside its editor, such as by the agent, keyed by
 * `noteRefKey`. An open editor reloads the working change when its count moves.
 */
const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export function subscribeExternalEdits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const externalEditCount = (key: string): number => counts.get(key) ?? 0;

export function noteExternalEdit(key: string) {
  counts.set(key, externalEditCount(key) + 1);
  for (const listener of listeners) listener();
}
