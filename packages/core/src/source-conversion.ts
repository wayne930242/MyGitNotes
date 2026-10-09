import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parseWorkspaceConfigAt, resolveWorkspaceConfigPath, SUPPORTED_SCHEMA_VERSION, WORKSPACE_CONFIG_FILENAME } from './config.js';
import { FOCUS_PAGE_FILE } from './focus-page.js';
import { repositoryName } from './notebook-key.js';
import { mapsRepository, parseSourceConfig, type RemoteSourceConfig, type RepositoryMapping } from './source-config.js';
import { STUDY_FILE } from './study.js';

/** The conversion cannot go ahead; nothing was written. */
export class SourceConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceConversionError';
  }
}

/** One repository's part of a conversion: the manifest text it will hold, or none when it is deleted. */
export interface ConvertedRepository {
  root: string;
  /** How the repository is named in the plan: its platform repository, or the converting worktree. */
  label: string;
  /** The manifest, relative to `root`. */
  file: string;
  /** What the conversion does to the manifest: writes `text`, deletes it (an emptied converting manifest) or leaves it. */
  action: 'write' | 'delete' | 'none';
  /** The manifest as it will be written; empty unless `action` is `write`. */
  text: string;
  /** The repository had no manifest; `text` is the whole new one, shown before writing. */
  created: boolean;
  /** Notebooks this conversion adds to the repository's manifest. */
  added: string[];
  /** Notebooks already present, identically, from an earlier run. */
  present: string[];
}

/** Focus or Study entries of a moved notebook found in the converting repository's documents; they stay where they are. */
export interface LegacyDocumentEntries {
  file: string;
  notebookId: string;
  count: number;
}

export interface SourceConversionPlan {
  /** The repository whose manifest declares the notebooks with `source`. */
  converting: ConvertedRepository;
  /** Every repository a notebook moves to, in the order they appear in the converting manifest. */
  targets: ConvertedRepository[];
  /** The converting manifest's default notebook moved away: it opens at the first remaining notebook instead. */
  defaultNotebook?: { from: string; to: string; };
  /** Every notebook leaves the converting manifest, which the conversion deletes. */
  emptied: boolean;
  legacyEntries: LegacyDocumentEntries[];
}

export interface SourceConversionOptions {
  /** The worktrees `mygitnotes.server.yaml` maps to platform repositories. */
  mappings: RepositoryMapping[];
  /** Delete the converting manifest when every notebook leaves it, instead of stopping. */
  removeEmptied?: boolean;
  /** The files of `files` with uncommitted changes in the worktree `root`; a repository with any is not converted. */
  dirtyFiles?(root: string, files: string[]): string[];
}

/** Whether two paths are the same directory, following symbolic links. */
function sameDirectory(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/** The repository a notebook's `source` names, `branch` defaulting to `main` as schema 3 read it. */
function notebookSource(id: string, value: unknown, file: string): RemoteSourceConfig {
  const declared = value as Record<string, unknown> | null;
  if (!declared || typeof declared !== 'object' || (declared.type !== 'github' && declared.type !== 'gitlab')) throw new SourceConversionError(`${file}: notebook ${id} source.type must be github or gitlab.`);
  try {
    return parseSourceConfig({ source: { ...declared, branch: declared.branch ?? 'main' } }, '.') as RemoteSourceConfig;
  } catch (error) {
    throw new SourceConversionError(`${file}: notebook ${id} source is invalid: ${(error as Error).message}`);
  }
}

/** A notebook entry as YAML data, without its `source`. */
function withoutSource(node: YAML.YAMLMap): Record<string, unknown> {
  const { source: _source, ...rest } = node.toJSON() as Record<string, unknown>;
  return rest;
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A manifest below schema 3 may still have a Screen file, which only `pnpm migrate-workspace` of a Core on schema 3
 * converts; this Core's migration refuses a manifest with `source`, so the conversion must not skip past it.
 */
function requireSchema3(document: YAML.Document, where: string) {
  const version = document.get('schema_version');
  if (typeof version === 'number' && version >= 3) return;
  throw new SourceConversionError(`${where} uses schema_version ${String(version)}. Run pnpm migrate-workspace from a Core checkout at fd0fd42, the last Core on schema 3, first; then run pnpm convert-sources.`);
}

/** Moves `schema_version: 4` to the top of a manifest document. */
function setSchema(document: YAML.Document) {
  document.set('schema_version', SUPPORTED_SCHEMA_VERSION);
  const map = document.contents as YAML.YAMLMap;
  const index = map.items.findIndex(item => YAML.isScalar(item.key) && item.key.value === 'schema_version');
  map.items.unshift(...map.items.splice(index, 1));
}

/** Validates a manifest as the server would load it from `root`, naming the repository in the error. */
function validate(root: string, label: string, file: string, text: string) {
  try {
    parseWorkspaceConfigAt(root, file, text);
  } catch (error) {
    throw new SourceConversionError(`The manifest of ${label} would not load after the conversion: ${(error as Error).message}`);
  }
}

/** Counts the entries of a document file that name `notebookId`, at any depth. */
function countNotebookEntries(value: unknown, notebookId: string): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countNotebookEntries(item, notebookId), 0);
  if (!value || typeof value !== 'object') return 0;
  const own = (value as { notebookId?: unknown; }).notebookId === notebookId ? 1 : 0;
  return own + Object.values(value).reduce((sum: number, item) => sum + countNotebookEntries(item, notebookId), 0);
}

/**
 * Plans moving each notebook of the manifest at `root` that names its repository by `source` into that repository's
 * own manifest, read from the worktree `mygitnotes.server.yaml` maps to it. Every manifest it would write is validated
 * and every file it would touch is checked for local changes before anything is written; nothing is written here.
 */
export function planSourceConversion(root: string, options: SourceConversionOptions): SourceConversionPlan | null {
  const relative = resolveWorkspaceConfigPath(root);
  if (!relative) throw new SourceConversionError(`No MyGitNotes workspace manifest found at ${root}.`);
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  const document = YAML.parseDocument(text);
  if (document.errors.length) throw new SourceConversionError(`${relative}: ${document.errors[0].message}`);
  const notebooks = document.get('notebooks');
  if (!YAML.isSeq(notebooks)) throw new SourceConversionError(`${relative}: notebooks must be a list.`);
  const items = notebooks.items.filter((item): item is YAML.YAMLMap => YAML.isMap(item));
  const sourced = items.filter(item => item.has('source'));
  if (!sourced.length) return null;
  requireSchema3(document, path.join(root, relative));

  const targets = new Map<string, { root: string; source: RemoteSourceConfig; nodes: YAML.YAMLMap[]; }>();
  for (const node of sourced) {
    const id = String(node.get('id'));
    const source = notebookSource(id, (node.get('source', true) as YAML.Node | undefined)?.toJSON(), relative);
    const mapping = options.mappings.find(candidate => mapsRepository(candidate, source));
    if (!mapping) throw new SourceConversionError(`Notebook ${id} names ${source.repository}, which mygitnotes.server.yaml maps to no worktree. Add it under repositories with its path, then run pnpm convert-sources again.`);
    // A notebook naming the converting repository by another name stays where it is and only loses `source`.
    if (sameDirectory(mapping.path, root)) continue;
    if (!fs.existsSync(path.join(mapping.path, '.git'))) throw new SourceConversionError(`${mapping.path}, the worktree of ${source.repository}, is not a Git worktree.`);
    const key = fs.realpathSync(mapping.path);
    const target = targets.get(key) ?? { root: mapping.path, source, nodes: [] };
    target.nodes.push(node);
    targets.set(key, target);
  }

  // The converting manifest keeps the notebooks that stay, each without `source`.
  const moving = new Set([...targets.values()].flatMap(target => target.nodes));
  const remaining = items.filter(item => !moving.has(item));
  const emptied = remaining.length === 0;
  if (emptied && !options.removeEmptied) throw new SourceConversionError(`Every notebook of ${relative} moves to another repository, which would leave its manifest empty. Run pnpm convert-sources --remove-emptied to delete that manifest and remove the repository from mygitnotes.server.yaml.`);
  const converted = document.clone();
  const convertedNotebooks = converted.get('notebooks') as YAML.YAMLSeq;
  // The clone keeps the order of the original's items, so an index names the same notebook in both.
  convertedNotebooks.items = convertedNotebooks.items.filter((_item, index) => !moving.has(notebooks.items[index] as YAML.YAMLMap));
  for (const item of convertedNotebooks.items) if (YAML.isMap(item)) item.delete('source');
  setSchema(converted);
  const ownDefault = String(document.getIn(['workspace', 'default_notebook']) ?? '');
  const defaultNode = items.find(item => String(item.get('id')) === ownDefault);
  let defaultNotebook: SourceConversionPlan['defaultNotebook'];
  if (!emptied && defaultNode && moving.has(defaultNode)) {
    defaultNotebook = { from: ownDefault, to: String(remaining[0].get('id')) };
    converted.setIn(['workspace', 'default_notebook'], defaultNotebook.to);
  }
  const convertingText = emptied ? '' : converted.toString();
  if (!emptied) validate(root, root, relative, convertingText);

  const preferences = document.get('preferences', true) as YAML.Node | undefined;
  const planned: ConvertedRepository[] = [];
  for (const target of targets.values()) {
    const existing = resolveWorkspaceConfigPath(target.root);
    const file = existing ?? WORKSPACE_CONFIG_FILENAME;
    const before = existing ? fs.readFileSync(path.join(target.root, existing), 'utf8') : null;
    const label = target.source.repository;
    // A new manifest is titled by its repository's name and opens at the first notebook moved to it.
    const own = before === null ? new YAML.Document({ schema_version: SUPPORTED_SCHEMA_VERSION, workspace: { title: repositoryName(target.source), default_notebook: String(target.nodes[0].get('id')) }, notebooks: [] }) : YAML.parseDocument(before);
    if (own.errors.length) throw new SourceConversionError(`The manifest of ${label} (${file}): ${own.errors[0].message}`);
    if (before !== null) requireSchema3(own, path.join(target.root, file));
    if (before === null && preferences) own.set('preferences', preferences.clone());
    const ownNotebooks = own.get('notebooks');
    if (!YAML.isSeq(ownNotebooks)) throw new SourceConversionError(`The manifest of ${label} (${file}): notebooks must be a list.`);
    if (ownNotebooks.items.some(item => YAML.isMap(item) && item.has('source'))) throw new SourceConversionError(`The manifest of ${label} still uses source. Run pnpm convert-sources in ${target.root} first.`);
    const added: string[] = [], present: string[] = [];
    for (const node of target.nodes) {
      const id = String(node.get('id'));
      const notebook = withoutSource(node);
      const found = ownNotebooks.items.find(item => YAML.isMap(item) && String(item.get('id')) === id) as YAML.YAMLMap | undefined;
      if (found && sameValue(found.toJSON(), notebook)) {
        present.push(id);
        continue;
      }
      if (found) throw new SourceConversionError(`The manifest of ${label} already has a different notebook ${id}. Rename one of them, then run pnpm convert-sources again.`);
      const copy = node.clone() as YAML.YAMLMap;
      copy.delete('source');
      ownNotebooks.items.push(copy);
      added.push(id);
    }
    const versionMoves = own.get('schema_version') !== SUPPORTED_SCHEMA_VERSION;
    if (versionMoves) setSchema(own);
    const after = own.toString();
    validate(target.root, label, file, after);
    planned.push({ root: target.root, label, file, action: added.length || versionMoves ? 'write' : 'none', text: after, created: before === null, added, present });
  }

  const legacyEntries: LegacyDocumentEntries[] = [];
  for (const documentFile of [FOCUS_PAGE_FILE, STUDY_FILE]) {
    const full = path.join(root, documentFile);
    if (!fs.existsSync(full)) continue;
    const content = YAML.parse(fs.readFileSync(full, 'utf8')) as unknown;
    for (const node of moving) {
      const notebookId = String(node.get('id'));
      const count = countNotebookEntries(content, notebookId);
      if (count) legacyEntries.push({ file: documentFile, notebookId, count });
    }
  }

  const converting: ConvertedRepository = { root, label: root, file: relative, action: emptied ? 'delete' : 'write', text: convertingText, created: false, added: [], present: [] };
  for (const repository of [...planned, converting]) {
    const dirty = options.dirtyFiles?.(repository.root, [repository.file]) ?? [];
    if (!dirty.length) continue;
    // A manifest an earlier run wrote but could not commit holds every notebook already: it only needs that commit.
    if (repository.action === 'none') throw new SourceConversionError(`${repository.root} has uncommitted changes in ${dirty.join(', ')}, which an earlier pnpm convert-sources wrote with notebook(s) ${repository.present.join(', ')}. Commit it, then run pnpm convert-sources again:\n  ${commitCommand(repository.root, repository.file, targetCommitMessage(repository.present))}`);
    throw new SourceConversionError(`${repository.root} has uncommitted changes in ${dirty.join(', ')}. Commit or discard them, then run pnpm convert-sources again.`);
  }
  return { converting, targets: planned, ...(defaultNotebook ? { defaultNotebook } : {}), emptied, legacyEntries };
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
/** The shell command that commits `file`, and only it, in the worktree `root`. */
export function commitCommand(root: string, file: string, message: string): string {
  return `git -C ${quote(root)} add --all -- ${quote(file)} && git -C ${quote(root)} commit -m ${quote(message)} --only -- ${quote(file)}`;
}
/** The commit message of a repository that takes `notebooks` into its manifest. */
export function targetCommitMessage(notebooks: string[]): string {
  return `chore(workspace): take notebook(s) ${notebooks.length ? notebooks.join(', ') : 'its notebooks'} into this repository's manifest`;
}

/**
 * Before schema 4 each repository's alias derived from its name in the order the home manifest's notebooks named it
 * with `source`; now it derives in the order of `repositories:` in the server configuration. Orders those entries so
 * the repositories the conversion of the deployment's own source moves notebooks to come first, in the order its
 * manifest names them, and the others keep theirs after: every repository keeps the alias it had, so the notebook keys
 * in URLs and Focus layouts keep naming it. `mappings` are the entries of `file` as `loadRepositoryMappings` read them.
 */
export function repositoriesInAliasOrder(file: string, mappings: RepositoryMapping[], targets: ConvertedRepository[]): { mappings: RepositoryMapping[]; changed: boolean; write(): void; } {
  const rank = (mapping: RepositoryMapping) => {
    const index = targets.findIndex(target => sameDirectory(target.root, mapping.path));
    return index < 0 ? targets.length : index;
  };
  const order = mappings.map((_mapping, index) => index).sort((a, b) => rank(mappings[a]) - rank(mappings[b]) || a - b);
  const changed = order.some((index, position) => index !== position);
  return {
    mappings: order.map(index => mappings[index]),
    changed,
    write() {
      if (!changed) return;
      const document = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
      const listed = document.get('repositories');
      if (!YAML.isSeq(listed) || listed.items.length !== mappings.length) throw new SourceConversionError(`${file} changed while pnpm convert-sources ran. Run it again.`);
      listed.items = order.map(index => listed.items[index]);
      fs.writeFileSync(file, document.toString());
    },
  };
}

/** Writes one repository's part of a planned conversion. */
export function applyConvertedRepository(repository: ConvertedRepository): void {
  const full = path.join(repository.root, repository.file);
  if (repository.action === 'delete') fs.rmSync(full);
  else if (repository.action === 'write') fs.writeFileSync(full, repository.text);
}

/**
 * The `repositories:` entry of the server configuration `file` that maps the worktree `root`, for removing an emptied
 * converting repository. The deployment's own source is no such entry, and it is refused: this Core has no way to name
 * another default repository yet.
 */
export function mappedRepositoryEntry(file: string, root: string): { remove(): void; } {
  const refuse = () => new SourceConversionError(`${root} is this deployment's own source, not an entry under repositories in ${file}, so --remove-emptied cannot remove it. Name another repository as the source (MYGITNOTES_LOCAL_PATH or source: in ${file}) first.`);
  if (!fs.existsSync(file)) throw refuse();
  const document = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
  const listed = document.get('repositories');
  const index = YAML.isSeq(listed) ? listed.items.findIndex(item => YAML.isMap(item) && typeof item.get('path') === 'string' && sameDirectory(path.resolve(path.dirname(file), String(item.get('path'))), root)) : -1;
  if (index < 0) throw refuse();
  return {
    remove() {
      (listed as YAML.YAMLSeq).items.splice(index, 1);
      fs.writeFileSync(file, document.toString());
    },
  };
}
