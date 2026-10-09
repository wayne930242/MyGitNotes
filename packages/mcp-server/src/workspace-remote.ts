import { type RemoteSource, type RevisionSet, StaleRevisionError, type WorkspaceRepositories } from '@mygitnotes/core';
import { keyedResult, listedNotebooks, notebookArgument } from './notebook-keys.js';
import { callRemoteTool, isMutationTool } from './remote-tools.js';
import type { ToolAssets } from './tools/assets.js';

type RemoteHandle = { reader: RemoteSource; };
type Args = Record<string, unknown>;
const bareSha = /^[a-fA-F0-9]{40}(?:[a-fA-F0-9]{24})?$/;

/** v1: base64url of a JSON object mapping repository identities to commit SHAs. */
export function encodeWorkspaceRevision(revisions: RevisionSet): string {
  return `v1.${Buffer.from(JSON.stringify(revisions)).toString('base64url')}`;
}

export function decodeWorkspaceRevision(token: string, repository: string, repositoryCount: number): string {
  return parseWorkspaceRevision(token, repository, repositoryCount)[repository];
}

function parseWorkspaceRevision(token: string, repository: string, repositoryCount: number): RevisionSet {
  if (bareSha.test(token)) {
    if (repositoryCount !== 1) throw new Error('A bare commit SHA is only valid in a single-repository workspace; pass the workspace revision token.');
    return { [repository]: token };
  }
  if (!/^v1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid workspace revision token.');
  let revisions: unknown;
  try {
    const payload = token.slice(3);
    const bytes = Buffer.from(payload, 'base64url');
    if (bytes.toString('base64url') !== payload) throw new Error('Noncanonical base64url');
    revisions = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Invalid workspace revision token.');
  }
  if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions) || Object.values(revisions).some(value => typeof value !== 'string' || !bareSha.test(value))) throw new Error('Invalid workspace revision token.');
  const sha = (revisions as RevisionSet)[repository];
  if (!sha) throw new Error(`Workspace revision token has no entry for repository ${repository}.`);
  return revisions as RevisionSet;
}

const workspaceReads = new Set(['glob', 'find', 'list_notes', 'search_notes', 'list_skills', 'list_assets', 'get_statuses', 'list_folders']);
const pathTools = new Set(['read', 'read_note', 'write', 'append', 'edit', 'save_note', 'delete_note', 'mkdir', 'rm', 'cp', 'mv', 'get_folder_metadata', 'update_folder_metadata', 'get_note_metadata', 'update_note_metadata', 'delete_asset', 'list_folders', 'ls']);
const optionalWrites = new Set(['delete_note', 'delete_asset', 'update_note_metadata', 'add_asset', 'replace_notes']);
const mutation = (name: string) => isMutationTool(name) || optionalWrites.has(name);

/**
 * Route a hosted tool by notebook identity; only workspace-wide reads fan out. Tools name notebooks by key (a bare
 * local id resolves as an old URL does), each repository's tools see its local ids, and results name notebooks by key.
 * `assetsFor` names the bucket each repository's asset tools use (the environment's by default).
 */
export async function callWorkspaceRemoteTool(workspace: WorkspaceRepositories<RemoteHandle>, name: string, input: Args, write: boolean, appUrl?: string, assetsFor?: (handle: RemoteHandle) => ToolAssets): Promise<Record<string, unknown>> {
  const repositories = await workspace.all();
  const available = repositories.filter((entry): entry is typeof entry & { handle: RemoteHandle; } => 'handle' in entry);
  const unavailable = repositories.filter(entry => 'unavailable' in entry).map(entry => ({ repository: entry.ref.id, message: entry.unavailable.message }));
  if (name === 'get_workspace_config') return { config: await workspace.keyedConfig(), notebooks: await listedNotebooks(workspace), revision: await revisions(available.slice(0, 1)) };
  if (name === 'list_notebooks') return { notebooks: await listedNotebooks(workspace), revision: await revisions(available.slice(0, 1)) };
  const notebookKey = await notebookArgument(workspace, input.notebookId);
  const args: Args = notebookKey ? { ...input, notebookId: notebookKey } : input;
  const web = (entry: (typeof available)[number]) => appUrl ? { appUrl, alias: entry.alias } : undefined;
  if (name === 'get_statuses' && !args.notebookId && repositories.length > 1) {
    const results = await Promise.all(available.map(entry => callRemoteTool(entry.handle.reader, name, args, write)));
    const union = (field: string) => [...new Set(results.flatMap(result => result[field] as string[]))];
    return { notebookId: 'all', defaultStatuses: union('defaultStatuses'), configuredStatuses: union('configuredStatuses'), observedStatuses: union('observedStatuses'), allStatuses: union('allStatuses'), revision: await revisions(available), unavailable };
  }
  const broad = (name === 'ls' && (!args.path || args.path === '.')) || (workspaceReads.has(name) && !args.notebookId && !args.path && repositories.length > 1);
  if (broad && name !== 'get_statuses') {
    if (name === 'list_skills' || name === 'list_assets' || name === 'list_folders') {
      const results = await Promise.all(available.map(async entry => keyedResult(await callRemoteTool(entry.handle.reader, name, args, write, web(entry), assetsFor?.(entry.handle)), entry)));
      const field = name === 'list_skills' ? 'skills' : name === 'list_assets' ? 'assets' : 'folders';
      return { [field]: results.flatMap(result => result[field] as unknown[]), ...(name === 'list_skills' ? { target: null } : {}), revision: await revisions(available), unavailable };
    }
    if (name === 'find') {
      // fileOffset counts glob-matching files across repositories in manifest order.
      const counts = await Promise.all(available.map(async entry => Number((await callRemoteTool(entry.handle.reader, 'glob', { ...(args.pattern ? { pattern: args.pattern } : {}), limit: 1 }, write)).total)));
      const totalFiles = counts.reduce((sum, count) => sum + count, 0);
      const fileOffset = Number(args.fileOffset || 0);
      let skip = fileOffset;
      let scannedFiles = 0;
      const matches: unknown[] = [];
      let cannotContinue = false;
      for (let i = 0; i < available.length; i++) {
        if (skip >= counts[i]) {
          skip -= counts[i];
          continue;
        }
        const maxFiles = Number(args.maxFiles || 25) - scannedFiles;
        const maxResults = Number(args.maxResults || 100) - matches.length;
        if (maxFiles <= 0 || maxResults <= 0) break;
        const result = await callRemoteTool(available[i].handle.reader, name, { ...args, fileOffset: skip, maxFiles, maxResults }, write);
        matches.push(...result.matches as unknown[]);
        scannedFiles += Number(result.scannedFiles);
        if (result.truncated && result.nextFileOffset === null) {
          cannotContinue = true;
          break;
        }
        skip = 0;
      }
      const nextFileOffset = cannotContinue || fileOffset + scannedFiles >= totalFiles ? null : fileOffset + scannedFiles;
      return { matches, scannedFiles, truncated: cannotContinue || nextFileOffset !== null, nextFileOffset, revision: await revisions(available), unavailable };
    }
    const paged = name === 'ls' || name === 'glob' || name === 'list_notes';
    const field = name === 'ls' ? 'entries' : name === 'glob' ? 'paths' : name === 'list_notes' ? 'notes' : 'matches';
    const results = await Promise.all(available.map(async entry => {
      if (!paged) return [keyedResult(await callRemoteTool(entry.handle.reader, name, args, write, web(entry)), entry)];
      const pages: Record<string, unknown>[] = [];
      let nextOffset: number | null = 0;
      while (nextOffset !== null) {
        const page = keyedResult(await callRemoteTool(entry.handle.reader, name, { ...args, offset: nextOffset, limit: 500 }, write, web(entry)), entry);
        pages.push(page);
        nextOffset = page.nextOffset as number | null;
      }
      return pages;
    }));
    const pages = results.flat();
    const merged = pages.flatMap(result => result[field] as unknown[]);
    const offset = Number(args.offset || 0);
    const limit = Number(args.limit || 100);
    const total = paged ? merged.length : pages.reduce((n, r) => n + Number(r.total), 0);
    const entries = paged ? merged.slice(offset, offset + limit) : name === 'search_notes' ? merged.sort((a, b) => Number((b as { score: number; }).score) - Number((a as { score: number; }).score)).slice(0, Number(args.limit || 20)) : merged;
    return { ...(name === 'ls' ? { path: '.' } : {}), ...(name === 'search_notes' ? { query: args.query || '', isRegex: Boolean(args.isRegex), totalMatches: pages.reduce((n, r) => n + Number(r.totalMatches), 0), truncated: pages.some(r => r.truncated) || merged.length > entries.length } : {}), [field]: entries, total, ...(paged ? { nextOffset: offset + limit < total ? offset + limit : null } : {}), ...(name === 'list_notes' ? { count: entries.length } : {}), revision: await revisions(available), unavailable };
  }
  const entry = ['cp', 'mv', 'rm'].includes(name) ? await resolvePath(workspace, name, args, assetsFor) : notebookKey ? await workspace.forNotebook(notebookKey) : await resolvePath(workspace, name, args, assetsFor);
  const selectedPath = args.path;
  const selected = notebookKey ? entry.notebooks.find(nb => nb.key === notebookKey) : undefined;
  if (notebookKey && typeof selectedPath === 'string' && !selectedPath.startsWith('r2:') && !(selected && (selectedPath === selected.root || selectedPath.startsWith(`${selected.root}/`) || selectedPath.startsWith('.agents/skills/') || selectedPath.startsWith(`${selected.root.replace(/\/[^/]+$/, '')}/.agents/skills/`)))) throw new Error('Path does not belong to the selected notebook.');
  // The repository's tools name the notebook by its local id.
  const scoped: Args = { ...args, ...(selected ? { notebookId: selected.id } : {}) };
  if (typeof scoped.revision === 'string' && scoped.revision.length > 8192) throw new Error('Workspace revision token is too long.');
  const received = typeof scoped.revision === 'string' ? parseWorkspaceRevision(scoped.revision, entry.ref.id, repositories.length) : {};
  if (typeof scoped.revision === 'string') scoped.revision = received[entry.ref.id];
  let result: Record<string, unknown>;
  try {
    result = keyedResult(await callRemoteTool(entry.handle.reader, name, scoped, write, web(entry), assetsFor?.(entry.handle)), entry);
  } catch (error) {
    if (error instanceof StaleRevisionError) throw new StaleRevisionError([entry.ref.id], `Stale revision for repository ${entry.ref.id}. Reload before writing.`);
    throw error;
  }
  if (typeof result.revision === 'string' || mutation(name)) {
    const sha = typeof result.revision === 'string' ? result.revision : (result.commit as { commitHash?: string; } | undefined)?.commitHash;
    if (sha) result.revision = encodeWorkspaceRevision({ ...received, [entry.ref.id]: sha });
  }
  if (!mutation(name) && typeof result.revision !== 'string') result.revision = encodeWorkspaceRevision({ [entry.ref.id]: (await entry.handle.reader.getSnapshot()).sha });
  if (result.note && typeof (result.note as Record<string, unknown>).revision === 'string') {
    const note = result.note as Record<string, unknown>;
    result.note = { ...note, revision: encodeWorkspaceRevision({ [entry.ref.id]: note.revision as string }) };
  }
  return result;
}

async function revisions(entries: { ref: { id: string; }; handle: RemoteHandle; }[]) {
  return encodeWorkspaceRevision(Object.fromEntries(await Promise.all(entries.map(async entry => [entry.ref.id, (await entry.handle.reader.getSnapshot()).sha]))));
}

async function notebookPath(workspace: WorkspaceRepositories<RemoteHandle>, file: string) {
  const roots = (await workspace.all()).flatMap(entry => entry.notebooks.filter(nb => nb.root === file));
  if (roots.length > 1) throw new Error('The path lies in notebooks of more than one repository. Name its notebook.');
  return roots.length ? workspace.forNotebook(roots[0].key) : workspace.forPath(file);
}

/**
 * The repository whose notebook an `r2:` key belongs to: the key's first folder after the storage's key prefix is a
 * notebook's local id, so a key no prefix places resolves that id as a bare notebook id.
 */
async function r2Repository(workspace: WorkspaceRepositories<RemoteHandle>, key: string, assetsFor?: (handle: RemoteHandle) => ToolAssets) {
  for (const entry of await workspace.all()) {
    if (!('handle' in entry)) continue;
    const prefix = (await assetsFor?.(entry.handle).scope())?.prefix ?? '';
    const localId = key.startsWith(prefix) ? key.slice(prefix.length).split('/')[0] : undefined;
    const notebook = entry.notebooks.find(nb => nb.id === localId);
    if (notebook) return workspace.forNotebook(notebook.key);
  }
  const resolved = await workspace.resolveBareId(key.split('/')[0]);
  if (!resolved) throw new Error(`Notebook is not configured for r2:${key}.`);
  return workspace.forNotebook(resolved);
}

async function resolvePath(workspace: WorkspaceRepositories<RemoteHandle>, name: string, args: Args, assetsFor?: (handle: RemoteHandle) => ToolAssets) {
  const selected = typeof args.notebookId === 'string' ? await workspace.forNotebook(args.notebookId) : undefined;
  const pathEntry = (file: string) => {
    if (selected && (file === selected.notebook.root || file.startsWith(`${selected.notebook.root}/`))) return Promise.resolve(selected);
    return notebookPath(workspace, file);
  };
  if (name === 'cp' || name === 'mv') {
    const source = await pathEntry(String(args.source));
    const destination = await pathEntry(String(args.destination));
    if (source.ref.id !== destination.ref.id) throw new Error(`${name} cannot cross repositories (${source.ref.id} → ${destination.ref.id}).`);
    return source;
  }
  if (name === 'rm') {
    const paths = args.paths as string[];
    const entries = await Promise.all(paths.map(pathEntry));
    if (entries.some(entry => entry.ref.id !== entries[0].ref.id)) throw new Error('rm cannot span repositories; use one call per repository.');
    return entries[0];
  }
  if (typeof args.path === 'string' && args.path !== '.' && !args.path.startsWith('r2:')) {
    const repositories = await workspace.all();
    if (args.path.startsWith('.agents/skills/') && repositories.length === 1) return workspace.byId(repositories[0].ref.id);
    return notebookPath(workspace, args.path);
  }
  if (pathTools.has(name) && !args.path?.toString().startsWith('r2:')) throw new Error('Name a notebook or a path inside a configured notebook.');
  if (name === 'replace_notes' && !args.notebookId && !args.dryRun) throw new Error('replace_notes requires notebookId so one mutation writes one repository.');
  if (name === 'invoke_skill' && !args.path && (await workspace.all()).length !== 1) throw new Error('Name a notebook or note path when invoking a skill in a multi-repository workspace.');
  if (typeof args.path === 'string' && args.path.startsWith('r2:')) return r2Repository(workspace, args.path.slice(3), assetsFor);
  return workspace.defaultRepository();
}
