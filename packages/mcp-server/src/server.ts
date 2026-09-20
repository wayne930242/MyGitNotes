import { createRemoteSource, loadSourceConfig } from '@mygitnotes/core';
import { callRemoteTool, isMutationTool, remoteTools } from './remote-tools.js';
import { localTools } from './local-tools.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleAddAsset, handleCheckCoreUpdate, handleDeleteAsset, handleDeleteNote, handleGetFolderMetadata, handleGetGitStatus, handleGetNoteMetadata, handleGetStatuses, handleGetWorkspaceConfig, handleGitCommit, handleListAgentResources, handleListAssets, handleListFolders, handleListNotebooks, handleListNotes, handleMkdir, handleReadAgentResource, handleReadNote, handleReplaceNotes, handleSaveNote, handleSearchNotes, handleUpdateCore, handleUpdateFolderMetadata, handleUpdateNoteMetadata, ToolContext } from './tools/index.js';

export function createMCPServer(repoRoot: string): Server {
  const source = loadSourceConfig(repoRoot);
  const ctx: ToolContext = { repoRoot: source.type === 'local' ? source.path : repoRoot, productRoot: repoRoot };

  const server = new Server({ name: 'mygitnotes-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (source.type !== 'local') {
      return { tools: remoteTools.filter((t) => !isMutationTool(t.name)) };
    }
    return { tools: localTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result: unknown;

      if (source.type !== 'local') {
        result = await callRemoteTool(createRemoteSource(source), name, args, false);
      } else {
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
