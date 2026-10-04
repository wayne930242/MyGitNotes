# Notebook bookmarks — decisions

## Outcome and scope

Plan notebook-owned shortcuts to internal content, document positions, external websites, and saved queries.
The initial request authorized planning only; the user subsequently selected「定案，接著實作」and authorized implementation of the approved specification.
Product implementation belongs to the upstream MyGitNotes checkout before downstream synchronization.

## Terms

- A **bookmark** is a named navigation target; removing it never deletes its target.
- A **bookmark group** organizes bookmarks at one level; it is not a filesystem folder.
- A **compilation** remains a content collection and can itself be a bookmark target.
- An **unresolved bookmark** retains its identity and target information for repair; a transient permission/network error is not proof that its target was deleted.

## Decision tree

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Which targets? | Notes, folders, compilations, headings/paragraphs, external URLs, saved searches/views. | User selected all four target categories. | confirmed |
| Ownership and persistence? | Shared notebook data synchronized with Git, not browser-local personal favorites. | User selected notebook/Git synchronization. | confirmed |
| Organization? | Single-level groups, custom labels and manual ordering. | User selected single-level groups and sorting. | confirmed |
| Document anchors? | Store text and surrounding context without changing Markdown; ambiguous matches must not be guessed. | User selected text/context anchoring. | confirmed |
| Cross-notebook targets? | Internal targets and queries stay in the owning notebook. | User selected same-notebook scope. | confirmed |
| Missing target or position? | Retain and mark unresolved; allow re-targeting or removal; offer opening the whole note when it exists. | User selected retaining unresolved bookmarks. | confirmed |
| Existing bookmark storage? | None found in NotebookConfig; compilations have their own pinned content model. | types.ts and compilation.ts. | grounded |
| Existing saved-view precedent? | Typed filter query already encodes search, kind, tags, folders, status and view. | apps/web/src/lib/filter-query.ts. | grounded |
| Existing heading navigation? | Markdown rendering uses headingSlug; no stable paragraph ID was established by reconnaissance. | packages/core/src/workspace-links.ts and apps/web/src/lib/markdown.ts. | grounded |

There are no remaining consequential user-owned branches before the specification proposal.
Proposed operational defaults are collected in spec.md for final approval.

## Evidence

- [Notebook configuration and workspace types](../../../packages/core/src/types.ts)
- [Compilation model](../../../packages/core/src/compilation.ts)
- [Typed filter query](../../../apps/web/src/lib/filter-query.ts)
- [Workspace links and heading slugs](../../../packages/core/src/workspace-links.ts)
- [Markdown heading rendering](../../../apps/web/src/lib/markdown.ts)
- [Sidebar](../../../apps/web/src/components/Sidebar.tsx)
- [File mutation planner](../../../packages/core/src/file-manager.ts)
