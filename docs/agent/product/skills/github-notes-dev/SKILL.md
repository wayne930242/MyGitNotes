---
name: github-notes-dev
description: Use when developing, maintaining, or refactoring the GitHub Notes application codebase, packages, or tests.
---

# GitHub Notes Developer Workflow

Follow this workflow when modifying the GitHub Notes application source code.

## Boundaries & Principles

- **Branch Separation**: Product source changes occur on branch `core`. Real user content belongs on `main` and is never committed to `core`.
- **User Content Invariant**: Do not modify or regenerate files under `notes/**` when performing application maintenance.
- **Shared Logic**: Domain logic (such as frontmatter parsing, path guards, and config schema) must stay in `packages/core` so both the MCP server and UI share identical behaviors.

## Common Tasks

### Running Tests
```bash
pnpm test
pnpm exec vitest run <path>  # one file
```
Run Vitest from the repo root.
Apps import workspace packages from their `dist`; after changing or merging `packages/*`, run `pnpm --filter "./packages/*" run build` before testing or type-checking an app.

### Running Type Check & Build
```bash
pnpm build
```

### Writing Browser QA Steps
- Wait for the target's animations and transitions to finish before clicking it.
- After opening another page in the same browser, call `bringToFront()` on a page before interacting with it.
- Assert note text from the file on disk; live mode renders links outside the cursor line as chips, so `.cm-content` text omits them.
- In a local workspace a saved note reports `pending` (Uncommitted Changes); `saved` needs a clean working tree.

### Adding New Invariants
When adding new features or adjusting contracts:
1. Add corresponding unit tests under `packages/<package>/tests/`.
2. Ensure path traversal and symlink guards remain intact.
3. Validate that unknown frontmatter fields round-trip cleanly without truncation.
