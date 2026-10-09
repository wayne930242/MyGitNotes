import { parseWorkspaceConfig, serializeWorkspaceConfig, SUPPORTED_SCHEMA_VERSION } from './config.js';
import { type NotebookKey, notebookKey } from './notebook-key.js';
import type { RepositoryStatus } from './repository.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';
import { DEFAULT_WORKSPACE_PREFERENCES, type ResolvedPreferences } from './workspace-preferences.js';

/** What reading one repository's own manifest file found. */
export type ManifestRead =
  | { state: 'file'; config: WorkspaceConfig; revision: string; }
  | { state: 'missing'; revision: string; }
  | { state: 'invalid'; text: string; error: string; revision: string; };

/** A repository's own manifest file, read and written in that repository. */
export interface RepositoryManifestFile {
  read(): Promise<ManifestRead>;
  /** Writes `yaml` while `revision` is still the file's revision, creating the file when there is none; a stale revision answers 409. */
  save(yaml: string, revision: string): Promise<{ revision: string; }>;
}

/** One repository's manifest as the workspace applies it: the name it shows, where it opens and the preferences its notebooks use. */
export interface RepositoryManifest {
  /** The manifest as the repository stores it (local ids), or the one a save would create when `derived`; null when it cannot be read. */
  config: WorkspaceConfig | null;
  /** Sent back when saving this repository's manifest; empty when it cannot be saved. */
  revision: string;
  /** The repository keeps no manifest file; `config` is what a save would create. */
  derived: boolean;
  title: string;
  /** Where opening the repository lands; null only before the home repository has a manifest. */
  defaultNotebook: NotebookKey | null;
  preferences: ResolvedPreferences;
  /** Why the manifest file cannot be read, with its text so it can be fixed and saved. */
  error?: { message: string; text: string; };
  /** The manifest's `default_notebook` when it names no notebook the repository serves; `defaultNotebook` is then its first served notebook. */
  unservedDefault?: string;
}

/** A notebook as a repository's own manifest stores it: without the `source` the home manifest names it by. */
const ownNotebook = ({ source: _source, ...notebook }: NotebookConfig): NotebookConfig => notebook;

/**
 * The manifest of a repository that keeps none: its repository name as title, and the notebooks it serves (which the
 * home manifest declares by `source`) with the first of them as default. This is what "create manifest" writes.
 */
export function derivedRepositoryConfig(name: string, served: readonly NotebookConfig[]): WorkspaceConfig {
  return parseWorkspaceConfig(serializeWorkspaceConfig({ schema_version: SUPPORTED_SCHEMA_VERSION, workspace: { title: name || 'Notes', default_notebook: served[0].id }, notebooks: served.map(ownNotebook) }));
}

/**
 * The manifest of a repository other than the home repository. The home manifest still decides which notebooks it
 * serves; its own file names it, says where it opens and sets the preferences of its notebooks. A file that cannot be
 * read is reported with its text rather than closing the repository, and a default naming a notebook the repository
 * does not serve falls back to the first one it serves.
 */
export function notebookRepositoryManifest(read: ManifestRead | null, name: string, alias: string, served: readonly NotebookConfig[]): RepositoryManifest {
  const first = notebookKey(alias, served[0].id);
  const derived = { title: name, defaultNotebook: first, preferences: DEFAULT_WORKSPACE_PREFERENCES };
  if (!read) return { ...derived, config: null, revision: '', derived: true };
  if (read.state === 'missing') return { ...derived, config: derivedRepositoryConfig(name, served), revision: read.revision, derived: true };
  if (read.state === 'invalid') return { ...derived, config: null, revision: read.revision, derived: false, error: { message: read.error, text: read.text } };
  const { config } = read;
  const serves = served.some(notebook => notebook.id === config.workspace.default_notebook);
  return { config, revision: read.revision, derived: false, title: config.workspace.title, defaultNotebook: serves ? notebookKey(alias, config.workspace.default_notebook) : first, preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, ...config.preferences }, ...(serves ? {} : { unservedDefault: config.workspace.default_notebook }) };
}

/** The fields `GET /api/workspace` reports for one repository's manifest. */
export function repositoryManifestStatus(manifest: RepositoryManifest): Pick<RepositoryStatus, 'title' | 'defaultNotebook' | 'preferences' | 'config' | 'configRevision' | 'manifest' | 'manifestError' | 'unservedDefault'> {
  return { title: manifest.title, defaultNotebook: manifest.defaultNotebook, preferences: manifest.preferences, config: manifest.config, configRevision: manifest.revision, ...(manifest.derived ? { manifest: 'derived' as const } : {}), ...(manifest.error ? { manifestError: manifest.error } : {}), ...(manifest.unservedDefault ? { unservedDefault: manifest.unservedDefault } : {}) };
}
