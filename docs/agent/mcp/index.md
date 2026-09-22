# Model Context Protocol (MCP) Server

The `@mygitnotes/mcp-server` package provides an MCP interface for external agents to safely inspect and manipulate a MyGitNotes workspace.

## Transport

Default transport is **stdio** for local agent integration (e.g. Claude Desktop, Codex, Antigravity, or custom agent orchestrators).

## Exposed Tools

1. `get_workspace_config`: Returns parsed `.mygitnotes.yaml` (or legacy `.github-notes.yaml`) workspace manifest.
2. `list_notebooks`: Lists all configured notebooks and their root directories.
3. `list_notes`: Lists note summaries within a notebook, paged by `offset` and `limit` (default 100), returning `total` and `nextOffset`. Each entry carries frontmatter, a file path and a bounded `description` in place of the Markdown body.
4. `read_note`: Reads a note file and parses its frontmatter and raw Markdown body (supports `metadataOnly: true` to return metadata without the markdown body).
5. `save_note`: Atomically creates or updates a note file with path traversal and branch checks, and commits to Git. If `content` is omitted, updates frontmatter metadata only. Returns the note `path`.
6. `delete_note`: Removes a note file and creates a corresponding deletion commit.
7. `read_agent_resource`: Reads an agent instruction or doc file safely; lists available agent resources (`AGENTS.md`, `docs/agent/**`) if `path` is omitted.
8. `list_assets`: Lists a notebook's assets. With private R2 storage configured the bucket objects are listed alongside the repository files, and every entry names its `storage` and the `reference` a note links it by.
9. `add_asset`: Stores an asset file (with optional subfolder directory) and returns the reference a note links it by. With private R2 storage configured the file is uploaded to `<notebookId>/<directory>/<filename>` in the bucket and the response carries `storage: "r2"`, the object `key` and an `r2:<object-key>` `reference`; otherwise it is written into the notebook asset directory, committed, and returned as a notebook-relative path.
10. `delete_asset`: Removes an asset. A repository path is deleted with a Git commit; an `r2:<object-key>` reference deletes that bucket object, refused while a note still links it unless `force` is true.
11. `get_git_status`: Returns branch name, clean/dirty state, and recent commit history.
12. `git_commit`: Creates an atomic commit across staged/modified files.
13. `update_core`: Performs the guarded Core update workflow, or inspects available updates if `checkOnly: true`.
14. `list_folders`: Returns notebook-relative folder paths and `_dir.yml` display metadata, or inspects a specific folder if `path` is provided.
15. `mkdir`: Creates a notebook folder or updates display metadata (`title`, `order`, `description`, and custom fields) in `_dir.yml` (supports `overwrite: true`), creating an atomic Git commit.
16. `search_notes`: Searches note files using plain text or regular expressions (regex). Hosted sources rank results; see below.
17. `replace_notes`: Searches and replaces plain text or regular expressions across note files and creates an atomic Git commit.
18. `get_statuses`: Returns configured, observed, and available valid note statuses for a notebook or workspace to ensure accurate status tagging.

> [!NOTE]
> Backward Compatibility: Redundant endpoints (`get_note_metadata`, `update_note_metadata`, `get_folder_metadata`, `update_folder_metadata`, `list_agent_resources`, `check_core_update`) remain supported via tool dispatch aliases for backward compatibility with existing callers.

## Source selection and hosted access

The stdio entry resolves `mygitnotes.server.yaml` (or legacy `github-notes.server.yaml`) from its repository argument.
A local source uses the filesystem tools above; a GitHub or GitLab source exposes the
remote read tools against the configured public repository.

Hosted `/mcp` uses stateless Streamable HTTP. Settings → Access control creates
named read-only or write grants and shows a complete `/mcp/<token>` connector URL
once. ChatGPT uses that URL with No Authentication. Bearer headers at `/mcp`
remain supported. The URL is a credential scoped to the configured source and
canonical audience. New grants have no application TTL and survive logout,
session expiry and deployments; owners revoke individual grants in Settings.
GitLab access tokens, and short-lived GitHub OAuth app tokens issued with a refresh token, refresh through the shared server credential. Revoked provider authorization requires signing in again.
Rejected requests log a secret-free reason (`[mcp] unauthorized: …`, `[auth] credential rejected: …`, or a record sealed with another `SESSION_SECRET`).
A rejected request on an existing grant also keeps its reason and time for seven days as `lastRejection` on the Settings grant list (`GET /api/auth/agent-tokens`).
Legacy session-bound grants retain their original expiry.

Hosted tools include `ls`, `glob`, `read`, `find`, `write`, `append`, `edit`,
`mkdir`, `cp`, `mv`, and `rm`, plus the existing remote note and folder tools. Shell reads
and line edits include frontmatter; lines are one-based. `find` performs literal
text search over glob-selected notes. Hosted `search_notes` ranks notes for topic
lookups: space-separated words match independently across title, path,
frontmatter and body, Chinese phrases also match through bigrams, and
`notebookId`, `status`, `tags` and `pattern` filter before ranking (filters alone
list notes). Each match carries status, tags, matched terms and a snippet;
`limit` defaults to 20. Hosted `list_notes` pages note summaries with `offset`
and `limit` (default 100, maximum 500) and returns `total` and `nextOffset`; each
entry carries the frontmatter `description`, or the opening body line, capped at
240 characters, in place of the Markdown body. Listing and reading return a revision.
All writes require that revision, push permission and the `main` branch. Each
successful mutation creates one program-named commit and updates the remote
branch without force. Multi-file changes share one commit; GitLab uses batch actions with per-file version checks. Stale
revisions reject the operation. Mutations allow at most 200 files and 5 MiB of
new text. Directory operations require recursive consent; protected files and
asset-containing directories reject the complete operation. Moves preserve file
text, including relative links.
Note writes (`write`, `append`, `edit`, `save_note`, `update_note_metadata`)
also return the note `path` and, when `APP_URL` is configured, the note's web page `url`.

Hosted agent-system tools read what governs a notebook or note. A target is a
`notebookId` or a note or folder `path` inside a notebook; a note path works
before the note exists. `get_system_prompt` returns every `AGENTS.md` from the
repository root down to the target, root first, and their joined `content`.
`list_skills` returns the `.agents/skills/<name>/SKILL.md` skills of each
directory from the target up to the root, the nearest winning a shared name, or
every workspace skill without a target. `invoke_skill` returns a skill's
`SKILL.md` body, description and readable supporting files. Skills may live in
the repository root, notebook roots and their ancestors, and folders inside
notebooks; their Markdown and text files and `agents/openai.yaml` are readable.
`read`, `write`, `append`, `edit` and `rm` accept those skill files, so writing
`SKILL.md` creates a skill and a recursive `rm` of its directory deletes it.
Skill mutations commit as `docs(skills): …`, return no web `url`, and cannot
share an `rm` call with notes. `read` and `read_note` on a note return a `hint`
to read the agent system before creating or editing notes when the note has
one.

Every hosted tool declares input and output schemas, structured content and
readOnly/destructive/idempotent/openWorld annotations. Read-only grants omit all
mutation tools. Automatic MCP OAuth discovery is not provided. See the
[usage guide](../../../README.md) for setup.

The [hosted acceptance sequence](uat.md) covers connector discovery, revisions,
remote commit receipts, shell operations, note visibility and grant revocation.
