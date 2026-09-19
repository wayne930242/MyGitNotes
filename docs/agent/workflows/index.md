# Workflows

This document outlines key lifecycle and development workflows.

## 1. Workspace Bootstrap Flow

When a user clones the repository:
1. They start on default branch `core`.
2. They run `pnpm bootstrap-workspace`.
3. The script:
   - Verifies the repository root.
   - Checks out or creates branch `main`.
   - Copies the canonical `examples/demo-workspace/.mygitnotes.yaml` to the workspace root when neither root nor notes-level configuration (standard or legacy name) exists.
   - Initializes the default notebook directory (e.g. `notes/example`).
   - Copies missing canonical example notes/tutorials when the example notebook is configured, preserving existing files. Creates missing workspace agent instructions.
   - Commits the user initialization to `main`.

## 2. Core Update Flow

When an update is released to the canonical product branch `core`:
1. The user runs `pnpm update-core` in the `core` worktree.
2. The script:
   - Verifies working tree is clean.
   - Discovers whether Core remote is `upstream/core` or `origin/core`.
   - Fetches the Core branch.
   - Compares revisions.
   - Fast-forwards `core`; a `core` with local commits is refused.
   - Runs `migrate-workspace` with the new Core on the workspace named by `MYGITNOTES_LOCAL_PATH`.
   - Never auto-stashes, never force-pushes, and never uses destructive reset.

## 3. Git Save and Semantic Commits

Local UI edits auto-save to the working tree. The Changes manager reviews each file, stages or unstages its snapshot, and commits the reviewed index. Later working edits remain uncommitted. Single-file restore resets that file to HEAD; discarded local working content is copied into the Git directory for recovery. Other selected-file save/commit operations preserve unrelated pre-staged files.
Local MCP saves create a Git commit. Remote UI edits persist as browser working drafts; the Changes panel publishes selected notes together with a revision check. MCP mutations create a commit immediately.
- A remote save advances the branch without force; concurrent changes return a conflict.
- Semantic commit messages are generated:
  - If `GEMINI_API_KEY` is provided, requests a concise conventional commit message from Gemini Flash-Lite.
  - If no API key is available or the request fails, falls back gracefully to deterministic messages (e.g. `minor-mod` or `docs(notes): update <title>`).
  - Editing and Save always succeed even without network or API keys.

## 4. Local Git Sync

The Changes panel syncs a local workspace's `main` with its upstream through `POST /api/git/sync` (`packages/git/src/sync.ts`).
Sync requires `main`, a configured upstream and no uncommitted tracked changes; it never auto-stashes or force-pushes.
It fetches, rebases with `--rebase-merges` so Core update merges keep their merged commits, then pushes `HEAD` to the upstream branch.
A conflicting rebase is aborted and returns the conflicting files.
The user may retry with `-X ours` (remote side wins), `-X theirs` (local side wins), or resolve the rebase in a terminal.
A strategy retry first saves the previous `HEAD` under `refs/github-notes/sync-backups/`.
Conflicts Git cannot resolve with a strategy, such as delete conflicts, are aborted again.
Network commands run without credential prompts and time out after 60 seconds.
Remote sources have no sync step because each remote commit updates the branch directly.

## 5. Public Demo CI/CD

`.github/workflows/release-main.yml` runs on Core pushes and manual dispatch. It installs dependencies, tests and builds the product, then synchronizes the public demo examples from `examples/demo-workspace` into the content-only main with a `Core-Revision:` trailer and a non-forced push. A main that still tracks product paths or a concurrent remote note save stops publication. Ordinary workspace bootstrap continues to preserve existing user content.

Vercel production tracks `core`; `main` auto-deployment is disabled in `vercel.json`. The workflow waits for Vercel's commit status on the exact Core SHA. The `CORE_SYNC_SSH_KEY` Actions secret contains a dedicated repository write deploy key. Application and OAuth secrets stay in Vercel environment variables.

## Workspace Agent System

See [workspace Agent ownership, initialization and migration](workspace-agent-system.md).
