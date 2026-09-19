---
name: github-notes-core-update
description: Use when updating MyGitNotes Core in a workspace, migrating a workspace schema, or converting a fork-model workspace to a content-only main.
---

# GitHub Notes Core Update

Core lives on `core`; workspace content lives on a content-only `main` in its own worktree. See `docs/agent/workflows/workspace-agent-system.md`.

## Execution Rules

1. **Pick the checkout**: Run `pnpm update-core` in the `core` worktree. It fast-forwards from `upstream/core`, falling back to `origin/core`, then migrates the workspace named by `MYGITNOTES_LOCAL_PATH`. A `core` with local commits is refused; move that work to another branch.
2. **Fork-model workspaces**: A `main` that still tracks `pnpm-workspace.yaml` updates with `pnpm update-core` on a clean `main`, which merges Core while preserving workspace Agent settings. From an updated product checkout, `pnpm update-core --workspace /absolute/workspace/path` does the same.
3. **Convert once**: `pnpm convert-workspace` on a clean, updated fork-model `main` removes the product paths in one commit. Review the kept files it lists, then point a `core` worktree's `.env` at the workspace. `update-core` never merges into a content-only `main`.
4. **Refuse Dirty Tree**: Never update or convert with uncommitted modifications.
5. **Migrations**: `pnpm migrate-workspace` applies schema migrations; the local server refuses a mismatched `schema_version`. Report the timestamp backfill hint when notes lack `created`/`updated`.
6. **Validate**: Run `pnpm install`, `pnpm build` and `pnpm test` in the `core` worktree after an update.
7. **No destructive commands**: Never auto-stash, never use `reset --hard`, never force-push, never rewrite `main` history, never discard user changes silently.
