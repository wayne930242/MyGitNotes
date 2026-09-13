# Workflows

This document outlines key lifecycle and development workflows.

## 1. Workspace Bootstrap Flow

When a user clones the repository:
1. They start on default branch `core`.
2. They run `pnpm bootstrap-workspace`.
3. The script:
   - Verifies the repository root.
   - Checks out or creates branch `main`.
   - Copies the canonical `examples/demo-workspace/.github-notes.yaml` to the workspace root when neither root nor notes-level configuration exists.
   - Initializes the default notebook directory (e.g. `notes/example`).
   - Copies missing canonical example notes/tutorials when the example notebook is configured, preserving existing files. Creates missing workspace agent instructions.
   - Commits the user initialization to `main`.

## 2. Core Update Flow

When an update is released to the canonical product branch `core`:
1. The user on `main` runs `pnpm update-core`.
2. The script:
   - Verifies working tree is clean.
   - Discovers whether Core remote is `upstream/core` or `origin/core`.
   - Fetches the Core branch.
   - Compares revisions.
   - Performs a standard Git merge of Core into `main`.
   - Executes workspace migrations if schema versions changed.
   - Validates the workspace and reports status.
   - Never auto-stashes, never force-pushes, and never uses destructive reset.

## 3. Git Save and Semantic Commits

Local UI edits auto-save to the working tree; the Commit action stages selected changes and creates a commit.
Local MCP saves create a Git commit. Remote UI edits persist as browser working drafts; the Commit footer publishes selected notes together with a revision check. MCP mutations create a commit immediately.
- A remote save advances the branch without force; concurrent changes return a conflict.
- Semantic commit messages are generated:
  - If `GEMINI_API_KEY` is provided, requests a concise conventional commit message from Gemini Flash-Lite.
  - If no API key is available or the request fails, falls back gracefully to deterministic messages (e.g. `minor-mod` or `docs(notes): update <title>`).
  - Editing and Save always succeed even without network or API keys.

## 4. Public Demo CI/CD

`.github/workflows/release-main.yml` runs on Core pushes and manual dispatch. It installs dependencies, tests and builds the product, then merges the tested Core revision into main while preserving workspace Agent settings. The release script synchronizes the public demo from `examples/demo-workspace` and uses a non-forced push. Conflicts or concurrent remote note saves stop publication. Ordinary workspace bootstrap continues to preserve existing user content.

Vercel production tracks `main`; Core auto-deployment is disabled in `vercel.json`. The workflow waits for Vercel's commit status on the exact main SHA. The `CORE_SYNC_SSH_KEY` Actions secret contains a dedicated repository write deploy key. Application and OAuth secrets stay in Vercel environment variables.

## Workspace Agent System

See [workspace Agent ownership, initialization and migration](workspace-agent-system.md).
