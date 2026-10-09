import fs from 'node:fs';
import path from 'node:path';
import { createRemoteSource, createWorkspaceRepositories, deploymentConfigSource, localManifest, RemoteManifest, type RemoteSource, RepositoryUnavailableError, sharesCredential, type WorkspaceConfigSource, type WorkspaceRepositories, type WorkspaceSettings } from '@mygitnotes/core';
import { stageAndCommit } from '@mygitnotes/git';
import { keyedResult, listedNotebooks, notebookArgument } from './notebook-keys.js';
import { isMutationTool, remoteTools } from './remote-tools.js';
import { callWorkspaceRemoteTool } from './workspace-remote.js';
import { localTools } from './local-tools.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleAddAsset, handleCheckCoreUpdate, handleDeleteAsset, handleDeleteNote, handleGetFolderMetadata, handleGetGitStatus, handleGetNoteMetadata, handleGetStatuses, handleGetWorkspaceConfig, handleGitCommit, handleListAgentResources, handleListAssets, handleListFolders, handleListNotebooks, handleListNotes, handleMkdir, handleReadAgentResource, handleReadNote, handleReplaceNotes, handleSaveNote, handleSearchNotes, handleUpdateCore, handleUpdateFolderMetadata, handleUpdateNoteMetadata, ToolContext } from './tools/index.js';

/** A stdio session has no request of its own; adapters that select a workspace per request see no headers. */
const STDIO_REQUEST = { headers: {} };

/** The home repository read without a credential, with the manifest where the settings keep it. */
function openRemoteWorkspace(settings: WorkspaceSettings): WorkspaceRepositories<{ reader: RemoteSource; }> {
  const source = settings.home.source;
  if (source.type === 'local') throw new Error('A remote home repository is required.');
  return createWorkspaceRepositories({
    home: settings.home,
    openHome: scope => ({ reader: createRemoteSource(source, undefined, fetch, undefined, scope) }),
    manifest: handle => settings.manifest(() => new RemoteManifest(handle.reader)),
    async openRepository(ref, scope) {
      if (ref.source.type === 'local' || !sharesCredential(source, ref.source)) return { reason: 'unsupported-platform', message: `${ref.id} is not on the home repository's platform and site.` };
      const reader = createRemoteSource(ref.source, undefined, fetch, undefined, scope);
      try {
        await reader.getSnapshot();
      } catch (error) {
        if (error instanceof RepositoryUnavailableError) return { reason: error.reason, message: error.message };
        throw error;
      }
      return { reader };
    },
  });
}

/** `productRoot` is the Core checkout that ships product documents; the workspace comes from `configSource`. */
export function createMCPServer(productRoot: string, configSource: WorkspaceConfigSource = deploymentConfigSource(productRoot)): Server {
  const server = new Server({ name: 'mygitnotes-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { home } = await configSource.settings(STDIO_REQUEST);
    if (home.source.type !== 'local') {
      return { tools: remoteTools.filter((t) => !isMutationTool(t.name)) };
    }
    return { tools: localTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result: unknown;
      const settings = await configSource.settings(STDIO_REQUEST);
      if (settings.home.source.type !== 'local') {
        result = await callWorkspaceRemoteTool(openRemoteWorkspace(settings), name, args, false);
      } else {
        const root = settings.home.source.path;
        const workspace = createWorkspaceRepositories<{ kind: 'local'; id: string; root: string; }>({
          home: settings.home,
          openHome: () => ({ kind: 'local', id: settings.home.id, root }),
          manifest: () => settings.manifest(() => localManifest(root, stageAndCommit)),
          isHome: ref => settings.localPath(ref) === root,
          async openRepository(ref) {
            const mapped = settings.localPath(ref);
            if (!mapped || !fs.existsSync(path.join(mapped, '.git'))) return { reason: 'unmapped', message: `No Git worktree is mapped for ${ref.id}.` };
            return { kind: 'local', id: ref.id, root: mapped };
          },
        });
        const ctx: ToolContext = { repoRoot: root, workspace, productRoot };
        result = await dispatchLocalTool(ctx, name, args);
      }

      return { structuredContent: result as Record<string, unknown>, content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }], isError: true };
    }
  });

  return server;
}

type ToolHandler = (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;

const localToolHandlers: Record<string, ToolHandler> = { list_folders: (ctx, args) => handleListFolders(ctx, args as { path?: string; notebookId?: string; }), get_workspace_config: (ctx) => handleGetWorkspaceConfig(ctx), list_notebooks: (ctx) => handleListNotebooks(ctx), list_notes: (ctx, args) => handleListNotes(ctx, args), read_note: (ctx, args) => handleReadNote(ctx, args as { path: string; notebookId?: string; metadataOnly?: boolean; }), save_note: (ctx, args) => handleSaveNote(ctx, args as any), delete_note: (ctx, args) => handleDeleteNote(ctx, args as { path: string; commitMessage?: string; }), list_agent_resources: (ctx) => handleListAgentResources(ctx), read_agent_resource: (ctx, args) => handleReadAgentResource(ctx, args as { path?: string; }), list_assets: (ctx, args) => handleListAssets(ctx, args as { notebookId: string; }), add_asset: (ctx, args) => handleAddAsset(ctx, args as any), delete_asset: (ctx, args) => handleDeleteAsset(ctx, args as { path: string; commitMessage?: string; force?: boolean; }), get_git_status: (ctx) => handleGetGitStatus(ctx), git_commit: (ctx, args) => handleGitCommit(ctx, args as { files: string[]; message: string; notebookId?: string; }), check_core_update: (ctx) => handleCheckCoreUpdate(ctx), update_core: (ctx, args) => handleUpdateCore(ctx, args as { autoPush?: boolean; checkOnly?: boolean; }), search_notes: (ctx, args) => handleSearchNotes(ctx, args as any), replace_notes: (ctx, args) => handleReplaceNotes(ctx, args as any), get_statuses: (ctx, args) => handleGetStatuses(ctx, args), get_note_metadata: (ctx, args) => handleGetNoteMetadata(ctx, args as { path: string; }), update_note_metadata: (ctx, args) => handleUpdateNoteMetadata(ctx, args as any), mkdir: (ctx, args) => handleMkdir(ctx, args as any), get_folder_metadata: (ctx, args) => handleGetFolderMetadata(ctx, args as { path: string; }), update_folder_metadata: (ctx, args) => handleUpdateFolderMetadata(ctx, args as any) };

/**
 * Tools name notebooks by key (a bare local id resolves as an old URL does); each worktree's handlers see its local ids,
 * and results name notebooks by key.
 */
async function dispatchLocalTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<unknown> {
  const workspace = ctx.workspace;
  let args = input;
  if (workspace) {
    if (name === 'get_workspace_config') return { config: await workspace.keyedConfig(), notebooks: await listedNotebooks(workspace) };
    if (name === 'list_notebooks') return { notebooks: await listedNotebooks(workspace) };
    const notebookKey = await notebookArgument(workspace, input.notebookId);
    if (notebookKey) args = { ...input, notebookId: notebookKey };
    const all = await workspace.all();
    const available = all.filter(entry => 'handle' in entry);
    const unavailable = all.filter(entry => 'unavailable' in entry).map(entry => ({ repository: entry.ref.id, message: entry.unavailable.message }));
    if (name === 'get_git_status') return { repositories: await Promise.all(available.map(async entry => ({ repository: entry.ref.id, ...await handleGetGitStatus({ ...ctx, repoRoot: entry.handle.root }) }))), unavailable };
    if (['list_notes', 'search_notes', 'get_statuses', 'list_folders', 'list_assets'].includes(name) && !args.notebookId && !args.path) {
      const results = await Promise.all(available.map(async entry => {
        const scoped = { ...ctx, workspace: undefined, repoRoot: entry.handle.root, config: await workspace.scope(entry.ref.id) };
        if (name === 'list_assets') return Promise.all(scoped.config.notebooks.map(async nb => keyedResult(await handleListAssets(scoped, { notebookId: nb.id }), entry)));
        if (name === 'list_notes') return keyedResult(await handleListNotes(scoped, { ...args, offset: 0, limit: 100000 }), entry);
        return keyedResult(await localToolHandlers[name](scoped, args) as Record<string, unknown>, entry);
      }));
      const field = name === 'list_notes' ? 'notes' : name === 'search_notes' ? 'matches' : name === 'get_statuses' ? 'notebooks' : name === 'list_assets' ? 'assets' : 'folders';
      const items = results.flatMap(result => name === 'list_assets' ? (result as { assets: unknown[]; }[]).flatMap(item => item.assets) : ((result as Record<string, unknown>)[field] as unknown[] || []));
      if (name === 'list_notes') {
        const offset = Number(args.offset || 0);
        const limit = Number(args.limit || 100);
        const page = items.slice(offset, offset + limit);
        return { notes: page, count: page.length, total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null, unavailable };
      }
      if (name === 'search_notes') {
        const limit = Number(args.maxResults || 100);
        const searches = results as { totalMatches: number; scannedFiles: number; truncated: boolean; }[];
        return { matches: items.slice(0, limit), totalMatches: searches.reduce((sum, result) => sum + result.totalMatches, 0), scannedFiles: searches.reduce((sum, result) => sum + result.scannedFiles, 0), truncated: items.length > limit || searches.some(result => result.truncated), unavailable };
      }
      return { [field]: items, ...(name === 'get_statuses' ? { defaultStatuses: (results[0] as { defaultStatuses?: string[]; } | undefined)?.defaultStatuses || [] } : {}), unavailable };
    }
    if (name === 'replace_notes' && !args.notebookId && !args.dryRun) throw new Error('replace_notes requires notebookId: one mutation writes one repository.');
    if (name === 'git_commit' && !args.notebookId && all.length !== 1) throw new Error('git_commit requires notebookId in a multi-repository workspace.');
    const notebookId = typeof args.notebookId === 'string' ? args.notebookId : undefined;
    const selectedPath = typeof args.path === 'string' ? args.path : undefined;
    const rootAgentResource = name === 'read_agent_resource' && selectedPath && (!selectedPath.startsWith('notes/') || selectedPath === 'notes/AGENTS.md');
    const file = rootAgentResource ? undefined : selectedPath || (name === 'git_commit' ? undefined : Array.isArray(args.files) ? args.files[0] : undefined);
    const entry = notebookId ? await workspace.forNotebook(notebookId) : file ? await workspace.forPath(String(file)) : await workspace.byId(workspace.home.ref.id);
    const selected = notebookId ? entry.notebooks.find(nb => nb.key === notebookId) : undefined;
    if (selected && selectedPath && !selectedPath.startsWith('r2:') && !selectedPath.startsWith(`${selected.root}/`)) throw new Error('Path does not belong to the selected notebook.');
    if (name === 'git_commit') {
      for (const file of args.files as string[]) {
        if (all.length > 1 && !(await workspace.scope(entry.ref.id)).notebooks.some(nb => file.startsWith(`${nb.root}/`))) throw new Error('git_commit files must be inside the selected notebook repository.');
      }
    }
    ctx = { ...ctx, repoRoot: entry.handle.root, config: await workspace.scope(entry.ref.id) };
    // The worktree's handlers name the notebook by its local id.
    if (selected) args = { ...args, notebookId: selected.id };
    if (name === 'read_note' && !args.notebookId && file) args = { ...args, notebookId: ctx.config?.notebooks.find(nb => String(file).startsWith(`${nb.root}/`))?.id };
    const handler = localToolHandlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return keyedResult(await handler(ctx, args) as Record<string, unknown>, entry);
  }
  const handler = localToolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(ctx, args);
}
