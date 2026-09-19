import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const localTools: Tool[] = [
  {
    name: 'list_folders',
    description: 'List notebook folders and their display metadata, or inspect display metadata for a specific folder if path is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional relative path of a specific notebook folder to inspect.',
        },
      },
    },
  },
  {
    name: 'get_workspace_config',
    description: 'Reads and validates the root .mygitnotes.yaml workspace manifest (or legacy .github-notes.yaml).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_notebooks',
    description: 'Lists all notebooks configured in this workspace.',
    inputSchema: { type: 'object', properties: {} },
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
    description: 'Reads a note file, returning parsed metadata and raw markdown body (or metadata and valid statuses only if metadataOnly is true).',
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
        metadataOnly: {
          type: 'boolean',
          description: 'If true, returns note metadata and valid statuses without loading full markdown body.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'save_note',
    description:
      'Safely creates or updates a note with path guards and creates an atomic Git commit. If content is omitted, updates note frontmatter metadata only. Operates only on workspace branch (main).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the note file inside repo (e.g. notes/example/my-note.md).',
        },
        content: {
          type: 'string',
          description: 'Markdown body content. If omitted, existing body is preserved and only metadata is updated.',
        },
        metadata: {
          type: 'object',
          description: 'Optional YAML frontmatter metadata (id, title, status, tags, and arbitrary fields).',
        },
        status: {
          type: 'string',
          description: 'Optional status shortcut (e.g. "inbox", "working", "done", "archived").',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of tags.',
        },
        title: {
          type: 'string',
          description: 'Optional note title.',
        },
        commitMessage: {
          type: 'string',
          description: 'Optional commit message. If omitted, uses semantic commit generation or fallback.',
        },
      },
      required: ['path'],
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
    name: 'read_agent_resource',
    description: 'Safely reads an agent instruction or doc file, or lists available agent resources if path is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional relative path to the agent resource. If omitted, returns list of available resources.',
        },
      },
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
    inputSchema: { type: 'object', properties: {} },
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
    name: 'update_core',
    description: 'Fast-forwards the core checkout from upstream Core, or inspects available updates if checkOnly is true.',
    inputSchema: {
      type: 'object',
      properties: {
        checkOnly: {
          type: 'boolean',
          description: 'If true, inspects available remote Core updates without modifying workspace.',
        },
        autoPush: {
          type: 'boolean',
          description: 'Whether to push to origin/main after successful merge. Defaults to false.',
        },
      },
    },
  },
  {
    name: 'search_notes',
    description: 'Searches note files across the workspace using plain text or regular expressions (regex).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string or regular expression pattern.',
        },
        isRegex: {
          type: 'boolean',
          description: 'Whether query should be treated as a regular expression. Defaults to false.',
        },
        pattern: {
          type: 'string',
          description: 'Optional glob pattern to filter notes (e.g. "notes/example/**/*.md").',
        },
        notebookId: {
          type: 'string',
          description: 'Optional notebook identifier to limit search to.',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case sensitive matching. Defaults to false.',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum number of matched lines to return. Defaults to 100.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'replace_notes',
    description: 'Searches and replaces text or regular expressions across note files and creates an atomic Git commit. Supports dryRun.',
    inputSchema: {
      type: 'object',
      properties: {
        find: {
          type: 'string',
          description: 'Search string or regular expression pattern to replace.',
        },
        replace: {
          type: 'string',
          description: 'Replacement text (supports regex capture groups like $1 if isRegex is true).',
        },
        isRegex: {
          type: 'boolean',
          description: 'Whether find should be treated as a regular expression. Defaults to false.',
        },
        pattern: {
          type: 'string',
          description: 'Optional note path or glob pattern (e.g. "notes/example/my-note.md" or "notes/example/**/*.md").',
        },
        notebookId: {
          type: 'string',
          description: 'Optional notebook identifier to limit replacement to.',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case sensitive replacement. Defaults to false.',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, returns preview of changed files without modifying files or committing. Defaults to false.',
        },
        commitMessage: {
          type: 'string',
          description: 'Optional Git commit message for the change.',
        },
      },
      required: ['find', 'replace'],
    },
  },
  {
    name: 'get_statuses',
    description: 'Returns all configured and observed note statuses for a notebook or the entire workspace to ensure correct status annotation.',
    inputSchema: {
      type: 'object',
      properties: {
        notebookId: {
          type: 'string',
          description: 'Optional notebook ID. If omitted, returns statuses for all notebooks in workspace.',
        },
      },
    },
  },
  {
    name: 'mkdir',
    description: 'Creates a notebook folder or updates display metadata (_dir.yml) for an existing folder, creating an atomic Git commit.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the folder to create or update inside the repository (e.g. notes/example/my-folder).',
        },
        title: {
          type: 'string',
          description: 'Optional display title for the folder. Defaults to folder basename.',
        },
        order: {
          type: 'integer',
          description: 'Optional sort order number.',
        },
        description: {
          type: 'string',
          description: 'Optional folder description.',
        },
        metadata: {
          type: 'object',
          description: 'Optional additional folder metadata fields.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Allow updating folder metadata if folder already exists. Defaults to false.',
        },
        commitMessage: {
          type: 'string',
          description: 'Optional Git commit message.',
        },
      },
      required: ['path'],
    },
  },
];

