import { SourceError } from './github-api.js';
import type { RepositoryId, RepositoryRef, RepositoryScope } from './repository.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';
import type { ManifestStore } from './workspace-config-source.js';

export interface AvailableRepository<H> {
  ref: RepositoryRef;
  notebooks: NotebookConfig[];
  handle: H;
}
export interface UnavailableRepository {
  ref: RepositoryRef;
  notebooks: NotebookConfig[];
  unavailable: { reason: 'unmapped' | 'no-access' | 'missing-branch' | 'unsupported-platform'; message: string; };
}
export type WorkspaceRepository<H> = AvailableRepository<H> | UnavailableRepository;

/** Answers which repository serves each notebook of one request's workspace. */
export interface WorkspaceRepositories<H> {
  /** The home repository, available without loading the manifest. */
  readonly home: { ref: RepositoryRef; handle: H; };
  manifest(): Promise<{ config: WorkspaceConfig; revision: string; }>;
  saveManifest(yaml: string, revision: string): Promise<{ config: WorkspaceConfig; revision: string; }>;
  all(): Promise<WorkspaceRepository<H>[]>;
  forNotebook(notebookId: string): Promise<AvailableRepository<H>>;
  /**
   * The repository whose notebook contains a repository-relative `path`, with that notebook.
   * A path inside notebooks of several repositories is ambiguous and must be named by notebook.
   */
  forPath(path: string): Promise<AvailableRepository<H> & { notebook: NotebookConfig; }>;
  byId(id: RepositoryId): Promise<AvailableRepository<H>>;
  /** The manifest restricted to the notebooks the repository serves. */
  scope(id: RepositoryId): Promise<WorkspaceConfig>;
}

export interface WorkspaceRepositoriesOptions<H> {
  home: RepositoryRef;
  /** Opens the home repository with the scope it serves. */
  openHome(scope: RepositoryScope): H;
  /** The manifest store, which may read through the home repository. */
  manifest(home: H): ManifestStore;
}

export function createWorkspaceRepositories<H>(options: WorkspaceRepositoriesOptions<H>): WorkspaceRepositories<H> {
  const { home: homeRef } = options;
  const scope = async (id: RepositoryId): Promise<WorkspaceConfig> => {
    const { config } = await manifest.load();
    if (id !== homeRef.id) throw new SourceError('Repository is not part of this workspace.', 404);
    return config;
  };
  const homeHandle = options.openHome(() => scope(homeRef.id));
  const manifest = options.manifest(homeHandle);
  const home = async (): Promise<AvailableRepository<H>> => ({ ref: homeRef, notebooks: (await manifest.load()).config.notebooks, handle: homeHandle });
  const all = async (): Promise<WorkspaceRepository<H>[]> => [await home()];
  return {
    home: { ref: homeRef, handle: homeHandle },
    manifest: () => manifest.load(),
    saveManifest: (yaml, revision) => manifest.save(yaml, revision),
    all,
    async forNotebook(notebookId) {
      const entry = await home();
      if (!entry.notebooks.some(notebook => notebook.id === notebookId)) throw new SourceError('Notebook is not configured.', 404);
      return entry;
    },
    async forPath(path) {
      const entries = await all();
      const matches = entries.flatMap(entry => entry.notebooks.filter(notebook => path.startsWith(`${notebook.root}/`)).map(notebook => ({ entry, notebook })));
      if (!matches.length) throw new SourceError('Path is not in a configured notebook.', 403);
      if (new Set(matches.map(match => match.entry.ref.id)).size > 1) throw new SourceError('The path lies in notebooks of more than one repository. Name its notebook.', 400);
      // Roots of one repository never overlap, so one repository holds at most one match.
      const [{ entry, notebook }] = matches;
      if (!('handle' in entry)) throw new SourceError(entry.unavailable.message, 503);
      return { ...entry, notebook };
    },
    async byId(id) {
      if (id !== homeRef.id) throw new SourceError('Repository is not part of this workspace.', 404);
      return home();
    },
    scope,
  };
}
