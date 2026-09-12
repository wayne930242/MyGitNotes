# Architecture

GitHub Notes is structured as a TypeScript monorepo using pnpm workspaces.

## Monorepo Layout

- `packages/core`: Core domain models, `.github-notes.yaml` schema & parsing, Markdown & YAML frontmatter parsing with exact round-trip preservation, resource classification, and path traversal guards.
- `packages/git`: Guarded Git service operations, Core update engine, and semantic commit message generation (with Gemini Flash-Lite and deterministic fallback).
- `packages/mcp-server`: Stdio Model Context Protocol (MCP) server providing safe note, asset, git, and workspace operations to coding agents.
- `apps/local-server`: Lightweight local HTTP bridge serving workspace APIs and static assets to the frontend web application.
- `apps/web`: Responsive, modern React frontend supporting List, Card, and Kanban views, pure Markdown & plain-text editors, asset manager, and crash-recovery drafts.
- `scripts/`: Cross-platform Node/TypeScript scripts for `bootstrap-workspace` and `update-core`.

## Core Invariants

1. **Markdown is the source of truth**: Notes are plain Markdown files with optional YAML frontmatter. No proprietary database or HTML blob becomes authoritative over files on disk.
2. **Boundary between Core and User content**: Core updates merge into the user workspace branch `main` without touching or overwriting `notes/**`.
3. **Round-trip fidelity**: Updating a note's frontmatter (e.g. changing Kanban column/status) preserves all unknown frontmatter fields and the original markdown text unchanged.

## Configurable sources

`github-notes.server.yaml` selects a local Git repository or a GitHub repository
and branch. Deployment environment variables can supply the same selection.
`packages/core` owns source parsing, folder metadata and the request-scoped
GitHub reader. The selected repository supplies its notebook manifest.

`apps/local-server/src/app.ts` composes the local adapter, GitHub HTTP routes,
GitHub login, server-held sessions and scoped remote MCP. The Vercel entry
imports the compiled server after the workspace build. Cloud notes persist
through GitHub APIs; local filesystem mutation remains in the local adapter.

See [source design](../../specs/2026-09-12-configurable-note-sources/design.md)
and the [usage guide](../../../README.md) for configuration and deployment.

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
