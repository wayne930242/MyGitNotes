---
name: github-notes-core-update
description: Use when updating MyGitNotes Core in a workspace, migrating a workspace schema, or converting a fork-model workspace to a content-only main.
---

# GitHub Notes Core Update

Core lives on `core`; workspace content lives on a content-only `main` in its own worktree. See `docs/agent/workflows/workspace-agent-system.md`.

## Execution Rules

1. **Pick the checkout**: Run `pnpm update-core` in the `core` worktree. It fast-forwards from `upstream/core`, falling back to `origin/core`, then migrates the workspace named by `MYGITNOTES_LOCAL_PATH`. A `core` with local commits is refused; move that work to another branch.
2. **Convert once**: A `main` that still tracks `pnpm-workspace.yaml` runs `pnpm convert-workspace` on a clean `main`; it removes the current Core's product paths in one commit. Review the kept files it lists, then point a `core` worktree's `.env` at the workspace. `update-core` runs only on `core`.
3. **Refuse Dirty Tree**: Never update or convert with uncommitted modifications.
4. **Migrations**: `pnpm migrate-workspace` applies schema migrations; the local server refuses a mismatched `schema_version`. Report the timestamp backfill hint when notes lack `created`/`updated`.
5. **Validate**: Run `pnpm install`, `pnpm build` and `pnpm test` in the `core` worktree after an update.
6. **No destructive commands**: Never auto-stash, never use `reset --hard`, never force-push, never rewrite `main` history, never discard user changes silently.
