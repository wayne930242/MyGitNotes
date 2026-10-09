import path from 'node:path';
import { SourceError } from './github-api.js';
import { deriveAlias, isBareNotebookId, type NotebookKey, notebookKey, parseNotebookKey, repositoryName } from './notebook-key.js';
import { type RepositoryId, type RepositoryRef, repositoryRef, type RepositoryScope, type UnavailableReason } from './repository.js';
import { notebookRepositoryManifest, type RepositoryManifest, type RepositoryManifestFile } from './repository-manifest.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';
import type { ManifestStore } from './workspace-config-source.js';
import { DEFAULT_WORKSPACE_PREFERENCES } from './workspace-preferences.js';

/** A notebook as its repository's manifest declares it (`id` is the local id), with its workspace key. */
export type KeyedNotebook = NotebookConfig & { key: NotebookKey; };

export interface AvailableRepository<H> {
  ref: RepositoryRef;
  /** The repository's alias in this workspace, the first part of its notebooks' keys. */
  alias: string;
  notebooks: KeyedNotebook[];
  handle: H;
}
export interface Unavailability {
  reason: UnavailableReason;
  message: string;
}
export interface UnavailableRepository {
  ref: RepositoryRef;
  alias: string;
  notebooks: KeyedNotebook[];
  unavailable: Unavailability;
}
export type WorkspaceRepository<H> = AvailableRepository<H> | UnavailableRepository;

/** Answers which repository serves each notebook of one request's workspace. */
export interface WorkspaceRepositories<H> {
  /** The home repository, available without loading the manifest. */
  readonly home: { ref: RepositoryRef; alias: string; handle: H; };
  /** The home manifest, which declares every notebook of the workspace. */
  manifest(): Promise<{ config: WorkspaceConfig; revision: string; derived?: boolean; }>;
  /**
   * One repository's own manifest: its title, where it opens, its preferences and the revision a save sends back.
   * The home repository's is the home manifest; another repository's is the file it keeps, if any.
   */
  manifestOf(id: RepositoryId): Promise<RepositoryManifest>;
  /** Saves one repository's own manifest, refusing a revision that is no longer current with 409. */
  saveManifest(id: RepositoryId, yaml: string, revision: string): Promise<{ revision: string; }>;
  /** The manifest as the workspace names it: each notebook's `id` and `workspace.default_notebook` are notebook keys. */
  keyedConfig(): Promise<WorkspaceConfig>;
  /** Every repository of the workspace, the home repository first, each opened or marked unavailable. */
  all(): Promise<WorkspaceRepository<H>[]>;
  /** The repository serving the notebook a key names, with that notebook; a bare local id is refused and an unknown key is not found. */
  forNotebook(key: NotebookKey): Promise<AvailableRepository<H> & { notebook: KeyedNotebook; }>;
  /**
   * The key a bare local id stands for: the one repository whose manifest has a notebook with that id,
   * else the home repository's notebook with it, else null.
   */
  resolveBareId(localId: string): Promise<NotebookKey | null>;
  /**
   * The repository whose notebook contains a repository-relative `path`, with that notebook.
   * A path inside notebooks of several repositories is ambiguous and must be named by notebook.
   */
  forPath(path: string): Promise<AvailableRepository<H> & { notebook: KeyedNotebook; }>;
  byId(id: RepositoryId): Promise<AvailableRepository<H>>;
  /** The manifest restricted to the notebooks the repository serves, with their local ids. */
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
  /** The manifest file a notebook repository keeps of its own. Without it, only the home repository's manifest can be read or saved. */
  repositoryManifest?(ref: RepositoryRef, handle: H): RepositoryManifestFile;
}

interface Group {
  ref: RepositoryRef;
  alias: string;
  notebooks: KeyedNotebook[];
}

/**
 * Notebooks grouped by the repository that serves them, the home repository first; roots must not overlap within one
 * repository. Each repository's alias derives from its name in that order, so it is the same on every request.
 */
function groupNotebooks(config: WorkspaceConfig, home: RepositoryRef, homeAlias: string, isHome: (ref: RepositoryRef) => boolean): Group[] {
  const groups = new Map<RepositoryId, Group>([[home.id, { ref: home, alias: homeAlias, notebooks: [] }]]);
  const aliases = new Set([homeAlias]);
  for (const notebook of config.notebooks) {
    const declared = notebook.source ? repositoryRef(notebook.source) : home;
    const ref = declared.id === home.id || isHome(declared) ? home : declared;
    let group = groups.get(ref.id);
    if (!group) {
      const alias = deriveAlias(repositoryName(ref.source), aliases);
      aliases.add(alias);
      group = { ref, alias, notebooks: [] };
      groups.set(ref.id, group);
    }
    for (const other of group.notebooks) {
      const a = path.posix.relative(other.root, notebook.root);
      const b = path.posix.relative(notebook.root, other.root);
      if (!a.startsWith('..') || !b.startsWith('..')) throw new SourceError(`Notebooks '${other.id}' and '${notebook.id}' have overlapping roots in repository ${ref.id}.`, 422);
    }
    group.notebooks.push({ ...notebook, key: notebookKey(group.alias, notebook.id) });
  }
  return [...groups.values()];
}

const isUnavailability = <H>(value: H | Unavailability): value is Unavailability => Boolean(value && typeof value === 'object' && 'reason' in value && 'message' in value && !('kind' in value));
const withoutKey = ({ key: _key, ...notebook }: KeyedNotebook): NotebookConfig => notebook;

export function createWorkspaceRepositories<H>(options: WorkspaceRepositoriesOptions<H>): WorkspaceRepositories<H> {
  const { home: homeRef } = options;
  const homeAlias = deriveAlias(repositoryName(homeRef.source), new Set());
  const isHome = options.isHome ?? (() => false);
  const group = (config: WorkspaceConfig) => groupNotebooks(config, homeRef, homeAlias, isHome);
  const groups = async () => group((await manifest.load()).config);
  const scope = async (id: RepositoryId): Promise<WorkspaceConfig> => {
    const { config } = await manifest.load();
    const found = group(config).find(candidate => candidate.ref.id === id);
    if (!found) throw new SourceError('Repository is not part of this workspace.', 404);
    return { ...config, notebooks: found.notebooks.map(withoutKey) };
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
  const entry = async (found: Group): Promise<WorkspaceRepository<H>> => {
    if (found.ref.id === homeRef.id) return { ...found, handle: homeHandle };
    const handle = await open(found.ref);
    return isUnavailability(handle) ? { ...found, unavailable: handle } : { ...found, handle };
  };
  const available = (found: WorkspaceRepository<H>): AvailableRepository<H> => {
    if ('handle' in found) return found;
    const names = found.notebooks.map(notebook => notebook.title).join(', ');
    throw new SourceError(`${names ? `${names}: ` : ''}${found.unavailable.message}`, 503);
  };
  const all = async () => Promise.all((await groups()).map(entry));
  const keyedConfig = (config: WorkspaceConfig): WorkspaceConfig => {
    const keys = new Map<string, NotebookKey>();
    for (const found of group(config)) for (const notebook of found.notebooks) keys.set(notebook.id, notebook.key);
    // One manifest declares every notebook, so its local ids are unique here.
    const key = (id: string) => keys.get(id) ?? id;
    return { ...config, workspace: { ...config.workspace, default_notebook: key(config.workspace.default_notebook) }, notebooks: config.notebooks.map(notebook => ({ ...notebook, id: key(notebook.id) })) };
  };
  const notebookRepository = async (id: RepositoryId): Promise<Group> => {
    const found = (await groups()).find(candidate => candidate.ref.id === id);
    if (!found) throw new SourceError('Repository is not part of this workspace.', 404);
    return found;
  };
  const manifestFile = (found: AvailableRepository<H>): RepositoryManifestFile => {
    if (!options.repositoryManifest) throw new SourceError(`The manifest of ${found.ref.id} cannot be read here.`, 501);
    return options.repositoryManifest(found.ref, found.handle);
  };
  return {
    home: { ref: homeRef, alias: homeAlias, handle: homeHandle },
    manifest: () => manifest.load(),
    async manifestOf(id) {
      if (id === homeRef.id) {
        const { config, revision, derived } = await manifest.load();
        return { config, revision, derived: Boolean(derived), title: config.workspace.title, defaultNotebook: keyedConfig(config).workspace.default_notebook, preferences: { ...DEFAULT_WORKSPACE_PREFERENCES, ...config.preferences } };
      }
      const found = await entry(await notebookRepository(id));
      const served = found.notebooks.map(withoutKey);
      return notebookRepositoryManifest('handle' in found ? await manifestFile(found).read() : null, repositoryName(found.ref.source), found.alias, served);
    },
    async saveManifest(id, yaml, revision) {
      if (id === homeRef.id) return { revision: (await manifest.save(yaml, revision)).revision };
      return manifestFile(available(await entry(await notebookRepository(id)))).save(yaml, revision);
    },
    keyedConfig: async () => keyedConfig((await manifest.load()).config),
    all,
    async forNotebook(key) {
      const parsed = parseNotebookKey(key);
      if (!parsed && isBareNotebookId(key)) throw new SourceError(`Name the notebook by its key (<alias>~${key}).`, 400);
      const found = parsed && (await groups()).find(candidate => candidate.alias === parsed.alias);
      const notebook = found?.notebooks.find(candidate => candidate.id === parsed!.localId);
      if (!found || !notebook) throw new SourceError('Notebook is not configured.', 404);
      return { ...available(await entry(found)), notebook };
    },
    async resolveBareId(localId) {
      if (!isBareNotebookId(localId)) return null;
      const all = await groups();
      const matches = all.flatMap(found => found.notebooks.filter(notebook => notebook.id === localId));
      if (matches.length === 1) return matches[0].key;
      return all.find(found => found.ref.id === homeRef.id)?.notebooks.find(notebook => notebook.id === localId)?.key ?? null;
    },
    async forPath(file) {
      const matches = (await groups()).flatMap(found => found.notebooks.filter(notebook => file.startsWith(`${notebook.root}/`)).map(notebook => ({ found, notebook })));
      if (!matches.length) throw new SourceError('Path is not in a configured notebook.', 403);
      if (new Set(matches.map(match => match.found.ref.id)).size > 1) throw new SourceError('The path lies in notebooks of more than one repository. Name its notebook.', 400);
      // Roots of one repository never overlap, so one repository holds at most one match.
      const [{ found, notebook }] = matches;
      return { ...available(await entry(found)), notebook };
    },
    byId: async id => available(await entry(await notebookRepository(id))),
    scope,
  };
}
