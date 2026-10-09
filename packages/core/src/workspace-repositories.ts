import { NotebookSourceError, SUPPORTED_SCHEMA_VERSION } from './config.js';
import { SourceError } from './github-api.js';
import { isBareNotebookId, type NotebookKey, notebookKey, parseNotebookKey, repositoryName } from './notebook-key.js';
import type { RepositoryId, RepositoryRef, RepositoryScope, UnavailableReason } from './repository.js';
import { type ManifestRead, type RepositoryManifest, repositoryManifest } from './repository-manifest.js';
import type { NotebookConfig, WorkspaceConfig } from './types.js';
import type { ManifestStore, WorkspaceMember } from './workspace-config-source.js';

/** A notebook as its repository's manifest declares it (`id` is the local id), with its workspace key. */
export type KeyedNotebook = NotebookConfig & { key: NotebookKey; };

export interface AvailableRepository<H> {
  ref: RepositoryRef;
  /** The repository's alias in this workspace, the first part of its notebooks' keys. */
  alias: string;
  member: WorkspaceMember;
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
  member: WorkspaceMember;
  /** Always empty: the notebooks of a repository come from its own manifest, which an unavailable one cannot supply. */
  notebooks: KeyedNotebook[];
  unavailable: Unavailability;
}
export type WorkspaceRepository<H> = AvailableRepository<H> | UnavailableRepository;

/** Answers which repository serves each notebook of one request's workspace. */
export interface WorkspaceRepositories<H> {
  /** The default member, known without opening any repository; null for an empty workspace or one whose default is hidden. */
  readonly default: WorkspaceMember | null;
  /** The default repository, opened; 404 without one, 503 when it is unavailable. */
  defaultRepository(): Promise<AvailableRepository<H>>;
  /** One repository's own manifest: its title, where it opens, its preferences and the revision a save sends back. */
  manifestOf(id: RepositoryId): Promise<RepositoryManifest>;
  /** Saves one repository's own manifest, refusing a revision that is no longer current with 409. */
  saveManifest(id: RepositoryId, yaml: string, revision: string): Promise<{ revision: string; }>;
  /**
   * Every notebook of the workspace as one manifest, named by key: the default repository's title, default notebook
   * and preferences (the first available repository's when the default cannot be read); null without any notebook.
   */
  keyedConfig(): Promise<WorkspaceConfig | null>;
  /** Every visible member, in order, each opened or marked unavailable. */
  all(): Promise<WorkspaceRepository<H>[]>;
  /** The repository serving the notebook a key names, with that notebook; a bare local id is refused and an unknown key is not found. */
  forNotebook(key: NotebookKey): Promise<AvailableRepository<H> & { notebook: KeyedNotebook; }>;
  /**
   * The key a bare local id stands for: the one repository whose manifest has a notebook with that id,
   * else the default repository's notebook with it, else null.
   */
  resolveBareId(localId: string): Promise<NotebookKey | null>;
  /**
   * The repository whose notebook contains a repository-relative `path`, with that notebook.
   * A path inside notebooks of several repositories is ambiguous and must be named by notebook.
   */
  forPath(path: string): Promise<AvailableRepository<H> & { notebook: KeyedNotebook; }>;
  byId(id: RepositoryId): Promise<AvailableRepository<H>>;
  /** The opened repository, also when its manifest does not load (so that manifest can be fixed); undefined when it cannot be reached. */
  handleOf(id: RepositoryId): Promise<H | undefined>;
  /** The repository's own manifest with local notebook ids; one that keeps none yet serves no notebook. */
  scope(id: RepositoryId): Promise<WorkspaceConfig>;
}

export interface WorkspaceRepositoriesOptions<H> {
  /** The members to open, in order; hidden members are left out by the caller. */
  members: WorkspaceMember[];
  /** Opens a member with the scope it serves, or says why it cannot. */
  openRepository(member: WorkspaceMember, scope: RepositoryScope): Promise<H | Unavailability>;
  /** The manifest store of an opened member. */
  manifest(member: WorkspaceMember, handle: H): ManifestStore;
  /**
   * Answers for a member the provider refused (`no-access`) exactly as for one the workspace does not have, so a request
   * that is not signed in cannot tell a private member's guessed alias or id from a wrong guess.
   */
  refusedAsMissing?: boolean;
}

/** One member as this request opened it: its handle and manifest, or why it cannot serve. */
type Opened<H> = { member: WorkspaceMember; handle: H; read: ManifestRead; notebooks: KeyedNotebook[]; } | { member: WorkspaceMember; handle?: H; read?: ManifestRead; unavailable: Unavailability; };

const isUnavailability = <H>(value: H | Unavailability): value is Unavailability => Boolean(value && typeof value === 'object' && 'reason' in value && 'message' in value && !('kind' in value));
const withoutKey = ({ key: _key, ...notebook }: KeyedNotebook): NotebookConfig => notebook;
/** How a repository is named in messages: its platform repository, or its worktree. */
const repositoryLabel = (ref: RepositoryRef) => ref.source.type === 'local' ? ref.source.path : ref.source.repository;

export function createWorkspaceRepositories<H>(options: WorkspaceRepositoriesOptions<H>): WorkspaceRepositories<H> {
  const { members } = options;
  const defaultOne = members.find(member => member.default) ?? null;
  /** Each member opens once per workspace. */
  const opened = new Map<RepositoryId, Promise<Opened<H>>>();
  const notMember = () => new SourceError('Repository is not part of this workspace.', 404);
  const memberOf = (id: RepositoryId) => {
    const found = members.find(member => member.ref.id === id);
    if (!found) throw notMember();
    return found;
  };
  const refused = (found: Opened<H>) => Boolean(options.refusedAsMissing && 'unavailable' in found && found.unavailable.reason === 'no-access');
  /** The member a request names by id, opened; one refused to this request is not found, as an unknown id is not. */
  const openById = async (id: RepositoryId) => {
    const found = await open(memberOf(id));
    if (refused(found)) throw notMember();
    return found;
  };
  const open = (member: WorkspaceMember): Promise<Opened<H>> => {
    let pending = opened.get(member.ref.id);
    if (!pending) {
      pending = load(member);
      opened.set(member.ref.id, pending);
    }
    return pending;
  };
  const load = async (member: WorkspaceMember): Promise<Opened<H>> => {
    const handle = await options.openRepository(member, () => scope(member.ref.id));
    if (isUnavailability(handle)) return { member, unavailable: handle };
    const read = await options.manifest(member, handle).read();
    if (read.state === 'invalid') {
      const message = read.sourceNotebook === undefined ? `The manifest of ${repositoryLabel(member.ref)} cannot be loaded: ${read.error}` : new NotebookSourceError(read.sourceNotebook, repositoryLabel(member.ref)).message;
      return { member, handle, read, unavailable: { reason: 'invalid-manifest', message } };
    }
    const notebooks = read.state === 'missing' ? [] : read.config.notebooks.map(notebook => ({ ...notebook, key: notebookKey(member.alias, notebook.id) }));
    return { member, handle, read, notebooks };
  };
  const entry = (found: Opened<H>): WorkspaceRepository<H> => {
    const { member } = found;
    if ('unavailable' in found) return { ref: member.ref, alias: member.alias, member, notebooks: [], unavailable: found.unavailable };
    return { ref: member.ref, alias: member.alias, member, notebooks: found.notebooks, handle: found.handle };
  };
  const available = (found: Opened<H>): AvailableRepository<H> => {
    const repository = entry(found);
    if ('handle' in repository) return repository;
    throw new SourceError(repository.unavailable.message, 503);
  };
  const all = async () => (await Promise.all(members.map(open))).map(entry);
  async function scope(id: RepositoryId): Promise<WorkspaceConfig> {
    const found = await openById(id);
    if ('unavailable' in found) throw new SourceError(found.unavailable.message, 503);
    const { read } = found;
    if (read.state === 'missing') return { schema_version: SUPPORTED_SCHEMA_VERSION, workspace: { title: repositoryName(found.member.ref.source), default_notebook: '' }, notebooks: [] };
    return (read as Extract<ManifestRead, { config: WorkspaceConfig; }>).config;
  }
  return {
    default: defaultOne,
    async defaultRepository() {
      if (!defaultOne) throw new SourceError('This workspace has no default repository yet.', 404);
      return available(await open(defaultOne));
    },
    async manifestOf(id) {
      const found = await openById(id);
      return repositoryManifest(found.read ?? null, repositoryName(found.member.ref.source), found.member.alias);
    },
    async saveManifest(id, yaml, revision) {
      const found = await openById(id);
      // A repository whose manifest cannot be loaded is still open, so its manifest can be fixed and saved.
      if (found.handle === undefined) throw new SourceError((found as { unavailable: Unavailability; }).unavailable.message, 503);
      return options.manifest(found.member, found.handle).save(yaml, revision);
    },
    async keyedConfig() {
      const repositories = await Promise.all(members.map(open));
      const usable = repositories.filter((found): found is Extract<Opened<H>, { notebooks: KeyedNotebook[]; }> => !('unavailable' in found) && found.read.state !== 'missing');
      const notebooks = usable.flatMap(found => found.notebooks);
      if (!notebooks.length) return null;
      const lead = usable.find(found => found.member.default && found.notebooks.length) ?? usable.find(found => found.notebooks.length)!;
      const leading = (lead.read as Extract<ManifestRead, { config: WorkspaceConfig; }>).config;
      return { ...leading, workspace: { title: leading.workspace.title, default_notebook: notebookKey(lead.member.alias, leading.workspace.default_notebook) }, notebooks: notebooks.map(notebook => ({ ...withoutKey(notebook), id: notebook.key })) };
    },
    all,
    async forNotebook(key) {
      const parsed = parseNotebookKey(key);
      if (!parsed && isBareNotebookId(key)) throw new SourceError(`Name the notebook by its key (<alias>~${key}).`, 400);
      const member = parsed && members.find(candidate => candidate.alias === parsed.alias);
      if (!member) throw new SourceError('Notebook is not configured.', 404);
      const found = await open(member);
      if (refused(found)) throw new SourceError('Notebook is not configured.', 404);
      if ('unavailable' in found) throw new SourceError(found.unavailable.message, 503);
      const notebook = found.notebooks.find(candidate => candidate.id === parsed!.localId);
      if (!notebook) throw new SourceError('Notebook is not configured.', 404);
      return { ...available(found), notebook };
    },
    async resolveBareId(localId) {
      if (!isBareNotebookId(localId)) return null;
      const repositories = await all();
      const matches = repositories.flatMap(repository => repository.notebooks.filter(notebook => notebook.id === localId));
      if (matches.length === 1) return matches[0].key;
      return repositories.find(repository => repository.member.default)?.notebooks.find(notebook => notebook.id === localId)?.key ?? null;
    },
    async forPath(file) {
      const matches = (await all()).flatMap(repository => repository.notebooks.filter(notebook => file.startsWith(`${notebook.root}/`)).map(notebook => ({ repository, notebook })));
      if (!matches.length) throw new SourceError('Path is not in a configured notebook.', 403);
      if (new Set(matches.map(match => match.repository.ref.id)).size > 1) throw new SourceError('The path lies in notebooks of more than one repository. Name its notebook.', 400);
      // Roots of one manifest never overlap, so one repository holds at most one match.
      const [{ repository, notebook }] = matches;
      return { ...(repository as AvailableRepository<H>), notebook };
    },
    byId: async id => available(await openById(id)),
    handleOf: async id => (await openById(id)).handle,
    scope,
  };
}
