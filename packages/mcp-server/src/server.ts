import { createRemoteSource, createWorkspaceRepositories, deploymentConfigSource, RemoteManifest, type RemoteSource, type WorkspaceConfigSource, type WorkspaceSettings } from '@mygitnotes/core';
import { callRemoteTool, isMutationTool, remoteTools } from './remote-tools.js';
import { localTools } from './local-tools.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleAddAsset, handleCheckCoreUpdate, handleDeleteAsset, handleDeleteNote, handleGetFolderMetadata, handleGetGitStatus, handleGetNoteMetadata, handleGetStatuses, handleGetWorkspaceConfig, handleGitCommit, handleListAgentResources, handleListAssets, handleListFolders, handleListNotebooks, handleListNotes, handleMkdir, handleReadAgentResource, handleReadNote, handleReplaceNotes, handleSaveNote, handleSearchNotes, handleUpdateCore, handleUpdateFolderMetadata, handleUpdateNoteMetadata, ToolContext } from './tools/index.js';

/** A stdio session has no request of its own; adapters that select a workspace per request see no headers. */
const STDIO_REQUEST = { headers: {} };

/** The home repository read without a credential, with the manifest where the settings keep it. */
function openRemoteHome(settings: WorkspaceSettings): RemoteSource {
  const source = settings.home.source;
  if (source.type === 'local') throw new Error('A remote home repository is required.');
  return createWorkspaceRepositories<RemoteSource>({ home: settings.home, openHome: scope => createRemoteSource(source, undefined, fetch, undefined, scope), manifest: reader => settings.manifest(() => new RemoteManifest(reader)) }).home.handle;
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
        result = await callRemoteTool(openRemoteHome(settings), name, args, false);
      } else {
        const ctx: ToolContext = { repoRoot: settings.home.source.path, productRoot };
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

type ToolHandler = (ctx: ToolContext, args: Record<string, any>) => Promise<unknown>;

const localToolHandlers: Record<string, ToolHandler> = { list_folders: (ctx, args) => handleListFolders(ctx, args as { path?: string; notebookId?: string; }), get_workspace_config: (ctx) => handleGetWorkspaceConfig(ctx), list_notebooks: (ctx) => handleListNotebooks(ctx), list_notes: (ctx, args) => handleListNotes(ctx, args), read_note: (ctx, args) => handleReadNote(ctx, args as { path: string; notebookId?: string; metadataOnly?: boolean; }), save_note: (ctx, args) => handleSaveNote(ctx, args as any), delete_note: (ctx, args) => handleDeleteNote(ctx, args as { path: string; commitMessage?: string; }), list_agent_resources: (ctx) => handleListAgentResources(ctx), read_agent_resource: (ctx, args) => handleReadAgentResource(ctx, args as { path?: string; }), list_assets: (ctx, args) => handleListAssets(ctx, args as { notebookId: string; }), add_asset: (ctx, args) => handleAddAsset(ctx, args as any), delete_asset: (ctx, args) => handleDeleteAsset(ctx, args as { path: string; commitMessage?: string; force?: boolean; }), get_git_status: (ctx) => handleGetGitStatus(ctx), git_commit: (ctx, args) => handleGitCommit(ctx, args as { files: string[]; message: string; }), check_core_update: (ctx) => handleCheckCoreUpdate(ctx), update_core: (ctx, args) => handleUpdateCore(ctx, args as { autoPush?: boolean; checkOnly?: boolean; }), search_notes: (ctx, args) => handleSearchNotes(ctx, args as any), replace_notes: (ctx, args) => handleReplaceNotes(ctx, args as any), get_statuses: (ctx, args) => handleGetStatuses(ctx, args), get_note_metadata: (ctx, args) => handleGetNoteMetadata(ctx, args as { path: string; }), update_note_metadata: (ctx, args) => handleUpdateNoteMetadata(ctx, args as any), mkdir: (ctx, args) => handleMkdir(ctx, args as any), get_folder_metadata: (ctx, args) => handleGetFolderMetadata(ctx, args as { path: string; }), update_folder_metadata: (ctx, args) => handleUpdateFolderMetadata(ctx, args as any) };

async function dispatchLocalTool(ctx: ToolContext, name: string, args: Record<string, any>): Promise<unknown> {
  const handler = localToolHandlers[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(ctx, args);
}
