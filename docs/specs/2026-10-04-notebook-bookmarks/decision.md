# Outline notes — replacement decisions

## Outcome and authority

Replace the rejected notebook-wide bookmark collection with **Outline note / 大綱筆記**, a Markdown note type parallel to compilation.
The short UI labels are **Outline / 大綱**.
A notebook can contain several independently named outline notes.
Every bullet is a general item/node: text, optional Markdown links, optional child items and same-item annotations.
A bookmark list is one use of an outline, not its defining purpose.
Text-only items are not inherently folders, and link-containing items are not restricted to leaves.

The user first confirmed list editing and authorized work with「好，開始處理吧」, then clarified the general-purpose model by asking about Workflowy and explicitly approved「可以，那就叫大綱筆記」.
These decisions supersede both the original collection design and the intermediate bookmark-document name/group-versus-link distinction.
Do not ask those settled choices again or infer full Workflowy feature parity.

Planning baseline: clean upstream `/home/weihung/github-notes`, HEAD `ac26edfe69120fac9eff904b5cb7f53e76966588`, confirmed by `git status --short` and `git rev-parse HEAD`.
This handoff changes only the four existing files in this folder; no product edits, user-note edits, commits, pushes, downstream changes, agents, network access, or feature tests occurred.
Owner: `aaaav-do` Durable, with `codebase-design` and the durable decision-tree discipline.
The legacy folder name is retained to supersede its existing artifacts in place, not to name the new product type.

## Terms and boundaries

- **Outline note**: a notebook-owned Markdown document of kind `outline`, opened and saved like a note.
- **Item/node**: one list item with ordinary Markdown inline content; links are optional and multiple links are allowed.
- **Child item**: an indented list item nested under another item, including under an item containing a link.
- **Annotation**: continuation text within the same item, without a child list marker; it is not a child node.
- **Legacy collection**: existing `.mygitnotes-bookmarks.yaml` data, retained only for protection, recovery and explicit import, not used as the new outline model.
- **Compilation**: the existing `.compilation.yml` collection/rendering model, unchanged.

`docs/CONTEXT.md` currently defines the rejected bookmark collection model.
The user decision takes precedence; implementation must update that glossary, but it is outside this planner's write allowlist.

## Decision tree

| Question | Answer | Basis | Status |
| --- | --- | --- | --- |
| Product name/model? | Outline note / 大綱筆記; short Outline / 大綱; general nested items, not a specialized bookmark tree. | User approved「可以，那就叫大綱筆記」after the Workflowy/outliner explanation. | confirmed |
| One singleton or many documents? | Many outline notes per notebook, parallel to compilation. | User's replacement approval. | confirmed |
| Organization? | Default `-` list; any item may have nested children; text-only does not imply folder. | Final model clarification supersedes the intermediate group definition. | confirmed |
| Links? | Optional ordinary `[label](destination)`, including external HTTP(S) and internal notes; no required target field. | User's external-link requirement and final optional-link clarification. | confirmed |
| Creation and annotations? | Enter adds a sibling; Shift+Enter continues the same item; Tab/Shift+Tab change hierarchy. | User-confirmed keyboard behavior. | confirmed |
| Same-document item drag movement? | Live-editor handles move whole item subtrees, reorder/nest with drop feedback, reject own-descendant drops, one undoable transaction; no cross-document movement or separate tree state. | User asked「拖曳移動也會做吧？」and parent confirmed inclusion on 2026-10-04. | confirmed |
| UI owner? | Existing note editor/save/layout/components, not separate Add bookmark/Add group forms or a custom tree editor. | Rejected UI feedback and replacement approval. | confirmed |
| Current-content shortcut? | Keep Add to outline with target and label filled; select an outline or create one through native creation. | Prior confirmed shortcut desire, reconciled with multiple general documents. | confirmed |
| Permanent Saved badge? | Remove it; ordinary note dirty/save/Changes state communicates persistence. | User found the constant badge unclear. | confirmed |
| File discriminator? | `*.outline.md`, derived `kind: 'outline'`, ordinary note frontmatter/body; no duplicate frontmatter type flag. | Compilation suffix precedent and current Markdown scanning, serialization and relocation seams. | grounded |
| Link scope? | Generated current-content links use the source notebook; pasted links retain native same-repository workspace-link behavior, never infer another repository from an equal path. | Existing `WorkspaceLinks`/`linkScope` and native-editor reuse. | grounded |
| Preserve old position/query behavior in ordinary links? | Do not invent a directive, hidden registry, query URL dialect or fake whole-note replacement. | Ordinary links cannot faithfully express exact-context anchors or typed view state. | grounded |
| Old data handling? | Explicit create-only import of representable entries; preview unsupported entries and preserve the complete source. | No-loss requirement; `design.md` defines preview/apply and draft recovery. | grounded |
| Delete old file or recover drafts automatically? | No; retain raw data and browser drafts; explicit recovery/export/discard only. | Safety scope and existing repository-keyed document drafts. | grounded |
| Was prior UI accepted? | No: human UI acceptance **FAIL**, regardless of historical tests or no-overflow screenshots. | User rejected field/button alignment, Saved meaning and creation/group workflow. | confirmed |
| Workflowy parity? | Not included: no node zoom, node IDs, separate drag tree, collapse persistence, task system or second editor. | User approved a name/model, not an expanded feature set. | grounded |

Core rules are ready for implementation.
No settled interaction choice needs renewed approval.
Storage suffix, bounded editor commands and additive import are engineering choices inside the confirmed model.

## Consequential frontier

No user decision blocks the approved outline replacement or conservative import.
If active exact-position/saved-query behavior is required inside outlines, return to the user before designing a representation: ordinary Markdown cannot preserve those semantics by itself.
Removal of the preserved legacy file, dropping unsupported records, assigning an unknown owner, or merging a stale legacy draft likewise requires separate explicit authority.
This plan authorizes none of those actions and does not call partial import complete migration.

## Scope

In: native note-kind lifecycle, nested Markdown editing, safe existing link navigation, current-content insertion, removal of rejected UI/write model, explicit additive legacy import/recovery, relevant tests and disposable browser fixture.
Out: another editor/form toolkit, Workflowy feature parity, new query/anchor syntax, URL metadata fetching, automatic migration, user-workspace modifications, live-provider writes, deployment or downstream integration in this planning run.

## Evidence

- [Approved replacement contract](spec.md)
- [Implementation seams and ordered tasks](design.md)
- [Historical failure and new evidence ledger](verification.md)
- [Compilation suffix](../../../packages/core/src/compilation.ts)
- [Native file parsing](../../../packages/core/src/note-file.ts)
- [Native creation](../../../apps/web/src/app/useNewNoteDialog.ts)
- [Native link dispatcher](../../../apps/web/src/components/WorkspaceLinks.tsx)
- [Legacy registry protection](../../../packages/core/src/workspace-documents.ts)
