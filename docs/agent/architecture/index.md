# Architecture

MyGitNotes is structured as a TypeScript monorepo using pnpm workspaces.

## Monorepo Layout

- `packages/core`: Core domain models, `.mygitnotes.yaml` (or the compatible `.github-notes.yaml`) schema & parsing, Markdown & YAML frontmatter parsing with exact round-trip preservation, resource classification, and path traversal guards.
- `packages/git`: Guarded Git service operations, Core update engine, and semantic commit message generation (with Gemini Flash-Lite and deterministic fallback).
- `packages/mcp-server`: Stdio Model Context Protocol (MCP) server providing safe note, asset, git, and workspace operations to coding agents.
- `apps/local-server`: Lightweight local HTTP bridge serving workspace APIs and static assets to the frontend web application.
- `apps/web`: Responsive, modern React frontend supporting List, Card, and Kanban views, pure Markdown & plain-text editors, asset manager, and crash-recovery drafts.
- `scripts/`: Cross-platform Node/TypeScript scripts for `bootstrap-workspace`, `update-core`, `migrate-workspace` and `convert-workspace`.

## Core Invariants

1. **Markdown is the source of truth**: Notes are plain Markdown files with optional YAML frontmatter. No proprietary database or HTML blob becomes authoritative over files on disk.
2. **Boundary between Core and User content**: `core` carries only product source and `main` carries only workspace content (`.mygitnotes.yaml`, notebook roots, assets, workspace Agent settings). The local server runs from a `core` worktree and edits the `main` worktree named by `MYGITNOTES_LOCAL_PATH`; `core` only fast-forwards and never merges into a content-only `main`. Fork-model workspaces whose `main` still carries the product merge Core with workspace Agent paths restored until they run `convert-workspace`.
3. **Round-trip fidelity**: Updating a note's frontmatter (e.g. changing Kanban column/status) preserves all unknown frontmatter fields and the original markdown text unchanged.

## Configurable sources

`mygitnotes.server.yaml` (or the compatible `github-notes.server.yaml`) selects a local repository, GitHub repository or GitLab project. Without a configured local path, a local source reads the application root only when it holds a workspace manifest (fork model); otherwise startup fails and names `bootstrap-workspace`. Local startup also rejects a workspace whose `schema_version` differs from `SUPPORTED_SCHEMA_VERSION`; `migrate-workspace` upgrades it. Product reference documents under `docs/agent/**` are served read-only from the application root, not from the workspace. Source configuration accepts `MYGITNOTES_*` and legacy `GITHUB_NOTES_*` environment variables.

`RemoteSource` contains shared note, folder, asset, Screen and Study rules. `GitHubSource` and `GitLabSource` implement immutable reads and atomic commits. `createRemoteSource` selects the adapter for HTTP and remote MCP. GitLab supports an HTTPS base URL and nested project namespaces.

OAuth follows the selected provider. Encrypted server records isolate site and account identity. GitLab refresh tokens are rotated under a credential lock and shared by browser sessions and persistent MCP grants. GitHub keeps its existing credential and grant identifiers; short-lived GitHub OAuth app tokens rotate under the same credential lock for persistent MCP grants, while GitHub browser sessions end with their access token.

See the [deployment guide](../../../README.md).

## Self-hosted runtime

The [Dockerfile](../../../Dockerfile) builds the web application and runs the compiled Express server as the `node` user. `HOST` defaults to loopback for direct startup and is set to `0.0.0.0` inside the image. The local-source Host and Origin checks remain active; `compose.local.yaml` binds an existing workspace checkout at `/workspace` and publishes only a loopback port.

Note pages come from query routes shared by both sources: `/api/notes/query` (notebook, folder, tag, status, visibility, text and sort filters, cursor pages, optional content, or a full path list), `/api/notes/facets`, `/api/notes/lookup`, `/api/notes/agenda` and `/api/notes/graph`. `NoteCatalog` is the read model behind them; `parseNoteQuery` and the query functions live in `packages/core/src/note-catalog.ts`, and filtering, sorting and serialization are shared with the browser through `note-query.ts`. Read routes accept the `revision` the browser is working from and answer 409 when the branch head has moved, so a screen never mixes two commits and a request cannot steer reads at arbitrary history.

Remote readers cache notes and their per-notebook indexes in the session Redis, keyed by repository and Git object id with a 30 day lifetime, falling back to a process-local cache when Redis is absent. Cache failures end the request rather than silently reloading from the platform.

`compose.yaml` runs the remote-source application with its own Redis service on an internal network. Redis persists AOF data in `redis-data`; only the application HTTP port is published. `SessionStore` chooses native Redis via `REDIS_URL`, then the existing Redis REST configuration, then a local encrypted session directory outside Vercel. Native Redis reuses connections, bounds connection/command waits, and propagates errors; a later request reconnects after a failure. Session/grant keys, encryption, TTLs, indexes, and credential refresh locks use the same operations across both Redis transports.

See the [deployment guide](../../../README.md#docker-and-docker-compose-deployment) for volumes, OAuth callbacks, reverse proxies, and updates.

## Notebook statuses and visibility

Each manifest notebook accepts an optional ordered `statuses` array, for example
`statuses: [capture, review, published]`. Missing or empty definitions fall back to
`inbox`, `working`, `done`, `archived`. The first entry is the initial status for
new notes; the order also determines Kanban columns. Update definitions through
the local Settings manifest editor or the source repository manifest.

The browser-safe core note-status module combines definitions with observed note
values. Unknown values extend choices for that notebook; definitions remain
unchanged. Values are case-sensitive and retain their original spelling. Existing
notes retain all metadata, and unassigned notes remain without a status.

The note YAML boolean `hiden` controls visibility. When absent, archived notes
are hidden and other notes are visible. An explicit false keeps even an archived
note visible. UI archive actions set hiden to true; leaving archived sets it to
false. Other status changes preserve manual visibility. The metadata editor also
exposes Hide note. Sidebar Show hidden notes includes hidden notes in List, Card,
Kanban and search, with the choice stored in the showHidden URL query. Direct
note links, repository reads and MCP access still resolve hidden notes. Visibility
is a presentation preference, not an authorization boundary.
