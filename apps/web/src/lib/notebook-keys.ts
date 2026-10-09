import { isBareNotebookId, localIdIn, type NotebookKey, notebookKey, parseNotebookKey } from '@mygitnotes/core/notebook-key';
import type { RepositoryId } from '@mygitnotes/core/repository';

/**
 * The key a bare local id stands for, answered from the loaded workspace's notebooks (each key with its repository) as
 * the server answers it: the one repository that has a notebook with that local id, else the home repository's
 * notebook with it, else null.
 */
export function resolveBareId(notebooks: Readonly<Record<NotebookKey, RepositoryId>>, home: RepositoryId, localId: string): NotebookKey | null {
  if (!isBareNotebookId(localId)) return null;
  const matches = Object.keys(notebooks).filter(key => parseNotebookKey(key)?.localId === localId);
  if (matches.length === 1) return matches[0];
  return matches.find(key => notebooks[key] === home) ?? null;
}

/** Turns notebook ids of one repository's stored content (local ids) into keys and back. */
export interface NotebookIdCodec {
  toKey(localId: string): NotebookKey;
  /** The local id of a key of this repository; another repository's key is refused. */
  toLocal(key: NotebookKey): string;
}

/** The codec of the repository named `alias`. */
export function notebookIdCodec(alias: string): NotebookIdCodec {
  return {
    toKey: localId => notebookKey(alias, localId),
    toLocal: key => {
      const localId = localIdIn(alias, key);
      if (localId === null) throw new Error(`Notebook ${key} does not belong to repository ${alias}.`);
      return localId;
    },
  };
}

/** Whether a value already names a notebook by key, as a route the app wrote does. */
export const isNotebookKey = (value: string) => parseNotebookKey(value) !== null;
