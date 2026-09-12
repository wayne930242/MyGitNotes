---
title: Status and Visibility
tags: [getting-started, organization]
status: done
---
# Status and Visibility

This example workspace uses the default lifecycle statuses without notebook-level overrides.

| Status | Recommended Usage |
|---|---|
| inbox | Newly captured, unprocessed thoughts and quick notes |
| working | Notes actively being written, researched, or executed |
| done | Completed and structured reference material |
| archived | Completed items kept for long-term reference and historical context |

List, Card, and Kanban views share the same status schema with YAML frontmatter. Status can be left blank; notes without a status remain readable.

## Hiding and Archiving

When changing a note's status to `archived`, the interface sets `hiden: true`, hiding the note from default views. Changing to any non-archived status resets it to `hiden: false`.

```yaml
status: archived
hiden: true
```

Toggle **Show hidden notes** in the left sidebar to reveal [Archived Review Example](../projects/archived-review.md). Direct URLs can also open hidden notes. Setting `hiden: false` allows archived notes to stay visible in default views.

The "Hide note" toggle in frontmatter controls visibility independently. Hiding affects navigation only and never deletes files.
