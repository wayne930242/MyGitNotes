import { loadSourceConfig, GitHubSource } from '@github-notes/core';
import { callRemoteTool, remoteTools, isMutationTool } from './remote-tools.js';
import { localTools } from './local-tools.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  handleGetWorkspaceConfig,
  handleListNotebooks,
  handleListFolders,
  handleListNotes,
  handleReadNote,
  handleSaveNote,
  handleDeleteNote,
  handleListAgentResources,
  handleReadAgentResource,
  handleListAssets,
  handleAddAsset,
  handleDeleteAsset,
  handleGetGitStatus,
  handleGitCommit,
  handleCheckCoreUpdate,
  handleUpdateCore,
  handleSearchNotes,
  handleReplaceNotes,
  handleGetStatuses,
  handleGetNoteMetadata,
  handleUpdateNoteMetadata,
  ToolContext,
} from './tools/index.js';

export function createMCPServer(repoRoot: string): Server {
  const source = loadSourceConfig(repoRoot);
  const ctx: ToolContext = { repoRoot: source.type === 'local' ? source.path : repoRoot };

  const server = new Server(
    {
      name: 'github-notes-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (source.type === 'github') {
      return { tools: remoteTools.filter((t) => !isMutationTool(t.name)) };
    }
    return { tools: localTools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result: unknown;

      if (source.type === 'github') {
        result = await callRemoteTool(
          new GitHubSource(source.repository, source.branch),
          name,
          args,
          false
        );
      } else {
        result = await dispatchLocalTool(ctx, name, args);
      }

      return {
        structuredContent: result as Record<string, unknown>,
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

async function dispatchLocalTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, any>
): Promise<unknown> {
  switch (name) {
    case 'list_folders':
      return handleListFolders(ctx);
    case 'get_workspace_config':
      return handleGetWorkspaceConfig(ctx);
    case 'list_notebooks':
      return handleListNotebooks(ctx);
    case 'list_notes':
      return handleListNotes(ctx, args);
    case 'read_note':
      return handleReadNote(ctx, args as { path: string; notebookId?: string });
    case 'save_note':
      return handleSaveNote(ctx, args as any);
    case 'delete_note':
      return handleDeleteNote(ctx, args as { path: string; commitMessage?: string });
    case 'list_agent_resources':
      return handleListAgentResources(ctx);
    case 'read_agent_resource':
      return handleReadAgentResource(ctx, args as { path: string });
    case 'list_assets':
      return handleListAssets(ctx, args as { notebookId: string });
    case 'add_asset':
      return handleAddAsset(ctx, args as any);
    case 'delete_asset':
      return handleDeleteAsset(ctx, args as { path: string; commitMessage?: string });
    case 'get_git_status':
      return handleGetGitStatus(ctx);
    case 'git_commit':
      return handleGitCommit(ctx, args as { files: string[]; message: string });
    case 'check_core_update':
      return handleCheckCoreUpdate(ctx);
    case 'update_core':
      return handleUpdateCore(ctx, args);
    case 'search_notes':
      return handleSearchNotes(ctx, args as any);
    case 'replace_notes':
      return handleReplaceNotes(ctx, args as any);
    case 'get_statuses':
      return handleGetStatuses(ctx, args);
    case 'get_note_metadata':
      return handleGetNoteMetadata(ctx, args as { path: string });
    case 'update_note_metadata':
      return handleUpdateNoteMetadata(ctx, args as any);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
