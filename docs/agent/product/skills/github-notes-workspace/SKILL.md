---
name: github-notes-workspace
description: Use when initializing or manipulating a GitHub Notes workspace, notebooks, notes, or manifests.
---

# GitHub Notes Workspace Management

Follow this workflow when creating or updating workspace manifests, notebooks, notes, or assets.

## Workspace Hierarchy

```text
Workspace (/.github-notes.yaml)
└─ Notebooks (e.g. notes/example/)
   └─ Notes (*.md) & Assets (assets/)
```

## Invariants

1. **Manifest Location**: `/.github-notes.yaml` exists only on user workspace branches (e.g. `main`), never on `core`.
2. **Notebook Slugs**: Notebook IDs must be unique URL/filesystem-safe slugs.
3. **Roots**: Notebook roots must be relative to repository root and must not overlap.
4. **Frontmatter**: Preserve unknown frontmatter keys. A note without frontmatter is valid.
5. **Git Save**: Every programmatic or user edit transaction should create a clean Git commit.
