import { isBareNotebookId, type KeyedNotebook, type NotebookKey, notebookKey, parseNotebookKey, type WorkspaceRepositories } from '@mygitnotes/core';

/**
 * A tool's `notebookId` argument as a notebook key: a key as given, or a bare local id resolved by the rule old URLs
 * follow (the one repository that has it, else the home repository's). Absent stays absent; anything else is refused.
 */
export async function notebookArgument(workspace: Pick<WorkspaceRepositories<unknown>, 'resolveBareId'>, value: unknown): Promise<NotebookKey | undefined> {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('notebookId must be a string.');
  if (parseNotebookKey(value)) return value;
  const key = isBareNotebookId(value) ? await workspace.resolveBareId(value) : null;
  if (!key) throw new Error(`Notebook '${value}' is not configured.`);
  return key;
}

/** Fields of a tool result that hold one item, or a list of items, naming their notebook in `notebookId`. */
const ITEM_FIELDS = ['note', 'folder'];
const LIST_FIELDS = ['notes', 'matches', 'folders', 'assets', 'notebooks'];

/**
 * A result of one repository's tool with each notebook it names turned from a local id into a key: the top-level
 * `notebookId` and that of every note, folder, match, asset and status entry. Ids the repository does not serve, such
 * as `all` or `default`, stay as they are.
 */
export function keyedResult(result: Record<string, unknown>, repository: { alias: string; notebooks: KeyedNotebook[]; }): Record<string, unknown> {
  const served = new Set(repository.notebooks.map(notebook => notebook.id));
  const keyed = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { notebookId } = item as { notebookId?: unknown; };
    return typeof notebookId === 'string' && served.has(notebookId) ? { ...item, notebookId: notebookKey(repository.alias, notebookId) } : item;
  };
  const answer = keyed(result) as Record<string, unknown>;
  for (const field of ITEM_FIELDS) if (field in answer) answer[field] = keyed(answer[field]);
  for (const field of LIST_FIELDS) if (Array.isArray(answer[field])) answer[field] = (answer[field] as unknown[]).map(keyed);
  return answer;
}

/** Each notebook of the workspace as the notebook tools list it: its key, local id, title and repository, with its settings. */
export async function listedNotebooks(workspace: Pick<WorkspaceRepositories<unknown>, 'all'>) {
  return (await workspace.all()).flatMap(entry => entry.notebooks.map(({ key, ...notebook }) => ({ key, ...notebook, repository: entry.ref.id })));
}
