# Model Context Protocol (MCP) Server

The `@github-notes/mcp-server` package provides an MCP interface for external agents to safely inspect and manipulate a GitHub Notes workspace.

## Transport

Default transport is **stdio** for local agent integration (e.g. Claude Desktop, Codex, Antigravity, or custom agent orchestrators).

## Exposed Tools

1. `get_workspace_config`: Returns parsed `.github-notes.yaml` workspace manifest.
2. `list_notebooks`: Lists all configured notebooks and their root directories.
3. `list_notes`: Lists all notes within a notebook, returning metadata and file paths.
4. `read_note`: Reads a note file and parses its frontmatter and raw Markdown body.
5. `save_note`: Atomically creates or updates a note file, with path traversal and branch checks, and commits the change to Git.
6. `delete_note`: Removes a note file and creates a corresponding deletion commit.
7. `list_agent_resources`: Discovers Agent Instructions (`AGENTS.md`) and Agent Docs (`docs/agent/**`).
8. `read_agent_resource`: Reads an agent instruction or doc file safely.
9. `list_assets`: Lists assets within a notebook's asset directory.
10. `add_asset`: Safely writes an asset file and returns the relative Markdown reference link.
11. `get_git_status`: Returns branch name, clean/dirty state, and recent commit history.
12. `git_commit`: Creates an atomic commit across staged/modified files.
13. `check_core_update`: Inspects available remote Core updates.
14. `update_core`: Performs the guarded Core update workflow.

15. `list_folders`: Returns notebook-relative folder paths and `_dir.yml` display metadata.

## Source selection and hosted access

The stdio entry resolves `github-notes.server.yaml` from its repository argument.
A local source uses the filesystem tools above; a GitHub source exposes the
remote read tools against the configured public repository.

Hosted `/mcp` uses stateless Streamable HTTP. Settings → Access control creates
named read-only or write grants and shows a complete `/mcp/<token>` connector URL
once. ChatGPT uses that URL with No Authentication. Bearer headers at `/mcp`
remain supported. The URL is a credential scoped to the configured source and
canonical audience. New grants have no application TTL and survive logout,
session expiry and deployments; owners revoke individual grants in Settings.
Upstream GitHub expiration or revocation can require another GitHub login.
Legacy session-bound grants retain their original expiry.

Hosted tools include `ls`, `glob`, `read`, `find`, `write`, `append`, `edit`,
`mkdir`, `cp`, `mv`, and `rm`, plus the existing remote note tools. Shell reads
and line edits include frontmatter; lines are one-based. `find` performs literal
text search over glob-selected notes. Listing and reading return a revision.
All writes require that revision, push permission and the `main` branch. Each
successful mutation creates one program-named commit and updates the remote
branch without force. Multi-file changes share one tree and commit. Stale
revisions reject the operation. Mutations allow at most 200 files and 5 MiB of
new text. Directory operations require recursive consent; protected files and
asset-containing directories reject the complete operation. Moves preserve file
text, including relative links.

Every hosted tool declares input and output schemas, structured content and
readOnly/destructive/idempotent/openWorld annotations. Read-only grants omit all
mutation tools. Automatic MCP OAuth discovery is not provided. See the
[usage guide](../../../README.md) for setup.

The [hosted acceptance sequence](uat.md) covers connector discovery, revisions,
remote commit receipts, shell operations, note visibility and grant revocation.
