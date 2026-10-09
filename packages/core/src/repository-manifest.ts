import { NotebookSourceError } from './config.js';
import { type NotebookKey, notebookKey } from './notebook-key.js';
import type { RepositoryStatus } from './repository.js';
import type { WorkspaceConfig } from './types.js';
import { DEFAULT_WORKSPACE_PREFERENCES, type ResolvedPreferences } from './workspace-preferences.js';

/**
 * What reading one repository's own manifest found: its file, the one derived from its folders when it keeps none
 * (a provider repository), no file at all (a worktree), or a file that cannot be loaded, with its text when it was read.
 */
export type ManifestRead = { state: 'file'; config: WorkspaceConfig; revision: string; } | { state: 'derived'; config: WorkspaceConfig; revision: string; } | { state: 'missing'; revision: string; } | { state: 'invalid'; text: string; error: string; revision: string; /** The notebook that still names its repository by the `source` schema 4 removed. */ sourceNotebook?: string; };

/** A manifest file that cannot be loaded, with the text read from it (empty when unread) and the error loading it raised. */
export function invalidManifest(text: string, error: unknown, revision: string): ManifestRead {
  return { state: 'invalid', text, error: error instanceof Error ? error.message : String(error), revision, ...(error instanceof NotebookSourceError ? { sourceNotebook: error.notebookId } : {}) };
}

/** One repository's manifest as the workspace applies it: the name it shows, where it opens and the preferences its notebooks use. */
export interface RepositoryManifest {
  /** The manifest as the repository stores it (local ids), or the one a save would create when `derived`; null when there is none to show. */
  config: WorkspaceConfig | null;
  /** Sent back when saving this repository's manifest; empty when it cannot be saved. */
  revision: string;
  /** The repository keeps no manifest file; `config` is what a save would create. */
  derived: boolean;
  title: string;
  /** Where opening the repository lands; null while it has no notebooks. */
  defaultNotebook: NotebookKey | null;
  preferences: ResolvedPreferences;
  /** Why the manifest file cannot be loaded, with its text so it can be fixed and saved. */
  error?: { message: string; text: string; };
}

/**
 * A repository's manifest as its status reports it. The repository's own manifest names it, says where it opens and
 * sets its preferences; without a readable one it is shown by `name` with the built-in preferences. `read` is null
 * when the repository itself cannot be reached.
 */
export function repositoryManifest(read: ManifestRead | null, name: string, alias: string): RepositoryManifest {
  const unnamed = { title: name, defaultNotebook: null, preferences: DEFAULT_WORKSPACE_PREFERENCES, derived: false };
  if (!read) return { ...unnamed, config: null, revision: '' };
  if (read.state === 'missing') return { ...unnamed, config: null, revision: read.revision };
  if (read.state === 'invalid') return { ...unnamed, config: null, revision: read.revision, error: { message: read.error, text: read.text } };
  const { config } = read;
  return { config, revision: read.revision, derived: read.state === 'derived', title: config.workspace.title, defaultNotebook: notebookKey(alias, config.workspace.default_notebook), preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, ...config.preferences } };
}

/** The fields `GET /api/workspace` reports for one repository's manifest. */
export function repositoryManifestStatus(manifest: RepositoryManifest): Pick<RepositoryStatus, 'title' | 'defaultNotebook' | 'preferences' | 'config' | 'configRevision' | 'manifest' | 'manifestError'> {
  return { title: manifest.title, defaultNotebook: manifest.defaultNotebook, preferences: manifest.preferences, config: manifest.config, configRevision: manifest.revision, ...(manifest.derived ? { manifest: 'derived' as const } : {}), ...(manifest.error ? { manifestError: manifest.error } : {}) };
}
