import { loadSourceConfig, GitHubSource, loadWorkspaceConfig, scanNotebookFolders } from '@github-notes/core';
import { callRemoteTool, remoteTools, isMutationTool } from './remote-tools.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  handleGetWorkspaceConfig,
  handleListNotebooks,
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
  ToolContext,
} from './tools.js';

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
    if (source.type === 'github') return { tools: remoteTools.filter(t => !isMutationTool(t.name)) };
    return {
      tools: [
        { name: 'list_folders', description: 'List notebook folders and their display metadata.', inputSchema: { type: 'object', properties: {} } },
        {
          name: 'get_workspace_config',
          description: 'Reads and validates the root .github-notes.yaml workspace manifest.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_notebooks',
          description: 'Lists all notebooks configured in this workspace.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_notes',
          description: 'Lists notes within a notebook or across the workspace.',
          inputSchema: {
            type: 'object',
            properties: {
              notebookId: {
                type: 'string',
                description: 'Optional ID of the notebook to filter notes by.',
              },
            },
          },
        },
        {
          name: 'read_note',
          description: 'Reads a note file, returning parsed metadata and raw markdown body.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Relative path of the note to read within repository root.',
              },
              notebookId: {
                type: 'string',
                description: 'Optional notebook identifier.',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'save_note',
          description:
            'Safely creates or updates a note with path guards and creates an atomic Git commit. Operates only on workspace branch (main).',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Relative path of the note file inside repo (e.g. notes/example/my-note.md).',
              },
              content: {
                type: 'string',
                description: 'Markdown body content.',
              },
              metadata: {
                type: 'object',
                description: 'Optional YAML frontmatter metadata (id, title, status, tags, and arbitrary fields).',
              },
              commitMessage: {
                type: 'string',
                description: 'Optional commit message. If omitted, uses semantic commit generation or fallback.',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'delete_note',
          description: 'Deletes a note file safely and creates a Git commit.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Relative path to the note file.',
              },
              commitMessage: {
                type: 'string',
                description: 'Optional commit message.',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_agent_resources',
          description: 'Discovers Agent Instructions (AGENTS.md) and Agent Docs (docs/agent/**).',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'read_agent_resource',
          description: 'Safely reads an agent instruction or doc file.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Relative path to the agent resource.',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'list_assets',
          description: 'Lists assets in a notebook asset directory.',
          inputSchema: {
            type: 'object',
            properties: {
              notebookId: {
                type: 'string',
                description: 'Notebook ID whose assets to list.',
              },
            },
            required: ['notebookId'],
          },
        },
        {
          name: 'add_asset',
          description: 'Adds an asset file to a notebook asset directory (or optional subfolder) and creates a Git commit.',
          inputSchema: {
            type: 'object',
            properties: {
              notebookId: {
                type: 'string',
                description: 'Target notebook ID.',
              },
              filename: {
                type: 'string',
                description: 'Desired filename (will be sanitized).',
              },
              base64Content: {
                type: 'string',
                description: 'Base64 encoded file payload.',
              },
              directory: {
                type: 'string',
                description: 'Optional subfolder path relative to notebook assets directory (e.g. "images" or "covers").',
              },
            },
            required: ['notebookId', 'filename', 'base64Content'],
          },
        },
        {
          name: 'delete_asset',
          description: 'Deletes an asset file from a notebook asset directory and creates a Git commit.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Relative path to the asset file within repository (e.g. notes/example/assets/image.png).',
              },
              commitMessage: {
                type: 'string',
                description: 'Optional commit message. Defaults to "chore(assets): delete <filename>".',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'get_git_status',
          description: 'Gets current Git working tree status, branch, and staged/modified files.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'git_commit',
          description: 'Creates a Git commit for specified repository-relative files.',
          inputSchema: {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of files to stage and commit.',
              },
              message: {
                type: 'string',
                description: 'Git commit message.',
              },
            },
            required: ['files', 'message'],
          },
        },
        {
          name: 'check_core_update',
          description: 'Inspects available remote Core updates without modifying workspace.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'update_core',
          description:
            'Performs the safe Core fetch/merge workflow into user workspace branch (main).',
          inputSchema: {
            type: 'object',
            properties: {
              autoPush: {
                type: 'boolean',
                description: 'Whether to push to origin/main after successful merge. Defaults to false.',
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      if (source.type === 'github') {
        result = await callRemoteTool(new GitHubSource(source.repository, source.branch), name, args || {}, false);
      } else switch (name) {
        case 'list_folders':
          result = { folders: loadWorkspaceConfig(ctx.repoRoot)?.notebooks.flatMap(nb => scanNotebookFolders(ctx.repoRoot, nb)) || [] };
          break;
        case 'get_workspace_config':
          result = await handleGetWorkspaceConfig(ctx);
          break;
        case 'list_notebooks':
          result = await handleListNotebooks(ctx);
          break;
        case 'list_notes':
          result = await handleListNotes(ctx, (args as { notebookId?: string }) || {});
          break;
        case 'read_note':
          result = await handleReadNote(ctx, args as { path: string; notebookId?: string });
          break;
        case 'save_note':
          result = await handleSaveNote(
            ctx,
            args as {
              path: string;
              content: string;
              metadata?: Record<string, unknown>;
              commitMessage?: string;
            }
          );
          break;
        case 'delete_note':
          result = await handleDeleteNote(
            ctx,
            args as { path: string; commitMessage?: string }
          );
          break;
        case 'list_agent_resources':
          result = await handleListAgentResources(ctx);
          break;
        case 'read_agent_resource':
          result = await handleReadAgentResource(ctx, args as { path: string });
          break;
        case 'list_assets':
          result = await handleListAssets(ctx, args as { notebookId: string });
          break;
        case 'add_asset':
          result = await handleAddAsset(
            ctx,
            args as {
              notebookId: string;
              filename: string;
              base64Content: string;
              directory?: string;
            }
          );
          break;
        case 'delete_asset':
          result = await handleDeleteAsset(
            ctx,
            args as { path: string; commitMessage?: string }
          );
          break;
        case 'get_git_status':
          result = await handleGetGitStatus(ctx);
          break;
        case 'git_commit':
          result = await handleGitCommit(
            ctx,
            args as { files: string[]; message: string }
          );
          break;
        case 'check_core_update':
          result = await handleCheckCoreUpdate(ctx);
          break;
        case 'update_core':
          result = await handleUpdateCore(ctx, (args as { autoPush?: boolean }) || {});
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
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
