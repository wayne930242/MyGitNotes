---
name: github-notes-core-update
description: Use when updating a user workspace by safely fetching and merging updates from the upstream or origin Core product branch.
---

# GitHub Notes Core Update

Follow this workflow when updating a user's workspace with upstream Core changes.

## Execution Rules

1. **Verify Root & Branch**: Ensure execution is at repository root and active branch is `main`.
2. **Refuse Dirty Tree**: Never update if uncommitted modifications exist.
3. **Discover Remote**: Check `upstream/core` first; fall back to `origin/core`.
4. **Fetch**: Fetch the remote Core branch without altering working tree.
5. **Compare**: Output current commit hash vs incoming Core revision.
6. **Merge**: Merge the Core branch with standard Git merge semantics (`git merge <remote>/core`).
7. **Migrations**: Apply schema migrations if `schema_version` changed.
8. **Validate**: Run validation to verify workspace integrity.
9. **No destructive commands**: Never auto-stash, never use `reset --hard`, never force-push, never discard user changes silently.
