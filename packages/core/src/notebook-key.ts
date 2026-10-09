import type { SourceConfig } from './source-config.js';

/**
 * A notebook's identity inside a workspace: `<alias>~<localId>`. Routes, API parameters, browser state and MCP
 * results name notebooks by key; repository content (manifests, `r2:<localId>/…`, Focus and Study files) keeps
 * the local id.
 */
export type NotebookKey = string;

/** Outside the notebook id pattern and safe in a URL path segment, so a key never collides with a local id. */
export const KEY_SEPARATOR = '~';
/** What a manifest accepts as a notebook's local id. */
export const NOTEBOOK_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const ALIAS_MAX_LENGTH = 40;
/** The longest local id a workspace document stores. */
export const NOTEBOOK_ID_MAX_LENGTH = 128;
/** The longest key a request may carry: the longest alias, the separator and the longest stored local id. */
export const NOTEBOOK_KEY_MAX_LENGTH = ALIAS_MAX_LENGTH + KEY_SEPARATOR.length + NOTEBOOK_ID_MAX_LENGTH;

/** The key of the notebook `localId` in the repository named `alias`. */
export function notebookKey(alias: string, localId: string): NotebookKey {
  if (!ALIAS_PATTERN.test(alias) || alias.length > ALIAS_MAX_LENGTH) throw new Error(`Invalid repository alias '${alias}'.`);
  if (!NOTEBOOK_ID_PATTERN.test(localId)) throw new Error(`Invalid notebook id '${localId}'.`);
  return `${alias}${KEY_SEPARATOR}${localId}`;
}

/** The parts of a well-formed key; null for a bare local id or any other value. */
export function parseNotebookKey(value: string): { alias: string; localId: string; } | null {
  const at = value.indexOf(KEY_SEPARATOR);
  if (at < 0) return null;
  const alias = value.slice(0, at), localId = value.slice(at + 1);
  return ALIAS_PATTERN.test(alias) && alias.length <= ALIAS_MAX_LENGTH && NOTEBOOK_ID_PATTERN.test(localId) ? { alias, localId } : null;
}

/** The local id a key names inside the repository `alias`; null for a key of another repository or a value that is no key. */
export function localIdIn(alias: string, value: string): string | null {
  const parsed = parseNotebookKey(value);
  return parsed?.alias === alias ? parsed.localId : null;
}

/** An item of the repository `alias` with its `notebookId` turned from a local id into a key. */
export const keyedItem = (alias: string) => <T extends { notebookId: string; }>(item: T): T => ({ ...item, notebookId: notebookKey(alias, item.notebookId) });

/** Whether a value names a notebook by its bare local id, as URLs, bookmarks and tool arguments from before keys do. */
export function isBareNotebookId(value: string): boolean {
  return NOTEBOOK_ID_PATTERN.test(value);
}

/** The name an alias is derived from: the last segment of the platform repository, or the worktree's directory. */
export function repositoryName(source: SourceConfig): string {
  const name = source.type === 'local' ? source.path : source.repository;
  return name.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/**
 * The alias a repository gets when it joins a workspace: its name lowercased, characters outside the alias pattern
 * replaced by `-`, leading `-` removed, at most 40 characters, and `-2`, `-3`, … appended while `taken` holds it.
 * A name with nothing usable left becomes `repository`.
 */
export function deriveAlias(repository: string, taken: ReadonlySet<string>): string {
  const name = repository.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const base = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, ALIAS_MAX_LENGTH) || 'repository';
  if (!taken.has(base)) return base;
  for (let suffix = 2;; suffix++) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, ALIAS_MAX_LENGTH - ending.length)}${ending}`;
    if (!taken.has(candidate)) return candidate;
  }
}
