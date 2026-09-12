# Workflows

This document outlines key lifecycle and development workflows.

## 1. Workspace Bootstrap Flow

When a user clones the repository:
1. They start on default branch `core`.
2. They run `pnpm bootstrap-workspace`.
3. The script:
   - Verifies the repository root.
   - Checks out or creates branch `main`.
   - Creates `notes/.github-notes.yaml` (if absent).
   - Initializes the default notebook directory (e.g. `notes/example`).
   - Creates the initial welcome note and notes workspace agent instructions when absent.
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
Local MCP saves create a Git commit. Remote UI and MCP note saves create an explicit GitHub commit with a revision check.
- A remote save advances the branch without force; concurrent changes return a conflict.
- Semantic commit messages are generated:
  - If `GEMINI_API_KEY` is provided, requests a concise conventional commit message from Gemini Flash-Lite.
  - If no API key is available or the request fails, falls back gracefully to deterministic messages (e.g. `minor-mod` or `docs(notes): update <title>`).
  - Editing and Save always succeed even without network or API keys.
