import path from 'node:path';
import { SourceError } from './github-api.js';
import { type RepositoryId, type RepositoryRef, repositoryRef, type RepositoryScope, type UnavailableReason } from './repository.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';
import type { ManifestStore } from './workspace-config-source.js';

export interface AvailableRepository<H> {
  ref: RepositoryRef;
  notebooks: NotebookConfig[];
  handle: H;
}
export interface Unavailability {
  reason: UnavailableReason;
  message: string;
}
export interface UnavailableRepository {
  ref: RepositoryRef;
  notebooks: NotebookConfig[];
  unavailable: Unavailability;
}
export type WorkspaceRepository<H> = AvailableRepository<H> | UnavailableRepository;

/** Answers which repository serves each notebook of one request's workspace. */
export interface WorkspaceRepositories<H> {
  /** The home repository, available without loading the manifest. */
  readonly home: { ref: RepositoryRef; handle: H; };
  manifest(): Promise<{ config: WorkspaceConfig; revision: string; derived?: boolean; }>;
  saveManifest(yaml: string, revision: string): Promise<{ config: WorkspaceConfig; revision: string; }>;
  /** Every repository of the workspace, the home repository first, each opened or marked unavailable. */
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
  /** Opens a notebook repository with the scope it serves, or says why it cannot. Without it, every notebook repository is unmapped. */
  openRepository?(ref: RepositoryRef, scope: RepositoryScope): Promise<H | Unavailability>;
  /** Whether a declared notebook repository is the home repository by another name, such as a mapping onto the home worktree. */
  isHome?(ref: RepositoryRef): boolean;
}

interface Group {
  ref: RepositoryRef;
  notebooks: NotebookConfig[];
}

/** Notebooks grouped by the repository that serves them, the home repository first; roots must not overlap within one repository. */
function groupNotebooks(config: WorkspaceConfig, home: RepositoryRef, isHome: (ref: RepositoryRef) => boolean): Group[] {
  const groups = new Map<RepositoryId, Group>([[home.id, { ref: home, notebooks: [] }]]);
  for (const notebook of config.notebooks) {
    const declared = notebook.source ? repositoryRef(notebook.source) : home;
    const ref = declared.id === home.id || isHome(declared) ? home : declared;
    const group = groups.get(ref.id) ?? { ref, notebooks: [] };
    for (const other of group.notebooks) {
      const a = path.posix.relative(other.root, notebook.root);
      const b = path.posix.relative(notebook.root, other.root);
      if (!a.startsWith('..') || !b.startsWith('..')) throw new SourceError(`Notebooks '${other.id}' and '${notebook.id}' have overlapping roots in repository ${ref.id}.`, 422);
    }
    group.notebooks.push(notebook);
    groups.set(ref.id, group);
  }
  return [...groups.values()];
}

const isUnavailability = <H>(value: H | Unavailability): value is Unavailability => Boolean(value && typeof value === 'object' && 'reason' in value && 'message' in value && !('kind' in value));

export function createWorkspaceRepositories<H>(options: WorkspaceRepositoriesOptions<H>): WorkspaceRepositories<H> {
  const { home: homeRef } = options;
  const isHome = options.isHome ?? (() => false);
  const groups = async () => groupNotebooks((await manifest.load()).config, homeRef, isHome);
  const scope = async (id: RepositoryId): Promise<WorkspaceConfig> => {
    const { config } = await manifest.load();
    const group = groupNotebooks(config, homeRef, isHome).find(candidate => candidate.ref.id === id);
    if (!group) throw new SourceError('Repository is not part of this workspace.', 404);
    return { ...config, notebooks: group.notebooks };
  };
  const homeHandle = options.openHome(() => scope(homeRef.id));
  const manifest = options.manifest(homeHandle);
  /** Each notebook repository opens once per workspace. */
  const opened = new Map<RepositoryId, Promise<H | Unavailability>>();
  const open = (ref: RepositoryRef): Promise<H | Unavailability> => {
    let pending = opened.get(ref.id);
    if (!pending) {
      pending = options.openRepository ? options.openRepository(ref, () => scope(ref.id)) : Promise.resolve({ reason: 'unmapped', message: `No worktree is mapped for ${ref.id}.` } as Unavailability);
      opened.set(ref.id, pending);
    }
    return pending;
  };
  const entry = async (group: Group): Promise<WorkspaceRepository<H>> => {
    if (group.ref.id === homeRef.id) return { ...group, handle: homeHandle };
    const handle = await open(group.ref);
    return isUnavailability(handle) ? { ...group, unavailable: handle } : { ...group, handle };
  };
  const available = (found: WorkspaceRepository<H>): AvailableRepository<H> => {
    if ('handle' in found) return found;
    const names = found.notebooks.map(notebook => notebook.title).join(', ');
    throw new SourceError(`${names ? `${names}: ` : ''}${found.unavailable.message}`, 503);
  };
  const all = async () => Promise.all((await groups()).map(entry));
  return {
    home: { ref: homeRef, handle: homeHandle },
    manifest: () => manifest.load(),
    saveManifest: (yaml, revision) => manifest.save(yaml, revision),
    all,
    async forNotebook(notebookId) {
      const group = (await groups()).find(candidate => candidate.notebooks.some(notebook => notebook.id === notebookId));
      if (!group) throw new SourceError('Notebook is not configured.', 404);
      return available(await entry(group));
    },
    async forPath(file) {
      const matches = (await groups()).flatMap(group => group.notebooks.filter(notebook => file.startsWith(`${notebook.root}/`)).map(notebook => ({ group, notebook })));
      if (!matches.length) throw new SourceError('Path is not in a configured notebook.', 403);
      if (new Set(matches.map(match => match.group.ref.id)).size > 1) throw new SourceError('The path lies in notebooks of more than one repository. Name its notebook.', 400);
      // Roots of one repository never overlap, so one repository holds at most one match.
      const [{ group, notebook }] = matches;
      return { ...available(await entry(group)), notebook };
    },
    async byId(id) {
      const group = (await groups()).find(candidate => candidate.ref.id === id);
      if (!group) throw new SourceError('Repository is not part of this workspace.', 404);
      return available(await entry(group));
    },
    scope,
  };
}
