Status: approved
Approved at: 2026-10-04 (conversation approval; exact wall-clock time not supplied)
Approved from: User approved native list editing and implementation with「好，開始處理吧」, then confirmed the clarified general-purpose model/name with「可以，那就叫大綱筆記」.

# Outline notes

The approval covers the user-facing outline model, not a claim that this redesign is implemented or visually accepted.
This specification replaces the earlier notebook bookmark collection contract and the intermediate bookmark-document terminology.
Engineering choices and the conservative legacy-import boundary are recorded in [design.md](design.md).

## Observable requirements

### R1 — Native note type and identity

An **Outline note / 大綱筆記** is a note type parallel to compilation; short UI labels are **Outline / 大綱**.
A notebook can create, name, open and keep multiple outline documents through the existing Notes creation and browsing surfaces.
Each document has its own path, title, frontmatter, body, tags/status and normal note identity.
Use `*.outline.md`; body content remains portable Markdown, without a separate item registry, required item IDs or a frontmatter type flag duplicating the filename.
Normal `.md` files stay normal notes; old `.compilation.yml` behavior is unchanged.
Opening a document does not rewrite its formatting or create a legacy metadata file.

### R2 — General items, optional links and annotations

Default new content is an unordered `-` list.
Every item can contain plain text, Markdown formatting, zero or more links, annotations and child items.
There is no text-group/link-leaf distinction, filesystem action attached to an item, or one-group-level limit.
Indentation and Markdown list syntax express children; continuation lines without a list marker express the same item's annotation.
Deleting an item or outline never deletes a linked target.
Labels are ordinary source text and never rename a target.

```markdown
- Research plan
  Clarify the next experiment.
  - Compare the baseline
  - Read [design notes](design.md) and [reference](https://example.com/)
    Record the useful parts here.
    - Verify the assumptions
- Unlinked thought
```

The continuation lines remain within their preceding list item in CommonMark; a standard renderer may render a soft break as a space.
The app shows the line break using its existing live/raw and rendered-Markdown behavior.
Existing prose, headings, ordered lists or incomplete Markdown are preserved and remain editable; this is not a strict schema that rejects a partially typed note.

### R3 — Keyboard and editing behavior

In outline list context, Enter adds a sibling at the current item's level, including when invoked from its annotation; it does not create a child accidentally.
At the end of an item with children, the sibling follows the complete subtree, leaving those children attached to their original item.
At a text caret in the middle of an item's line, split that line: text after the caret becomes the new sibling's text; other annotation blocks and child items remain attached to the original item.
A selection is replaced without deleting unselected content; selections spanning structural blocks use native Markdown fallback instead of guessing a restructuring.
An empty item follows native list-exit/outdent behavior so the user can leave the list.
Shift+Enter inserts a newline at the item's content indentation without a new bullet, keeping an annotation in the same item.
Tab nests the current item/subtree under its preceding sibling; Shift+Tab promotes it one level while retaining its subtree.
An impossible indent/outdent leaves content unchanged; no blank parent is invented.
Multi-item indentation handles contiguous sibling subtrees as one change and preserves their relative order.

These semantics work in both the existing live CodeMirror editor and raw textarea, with undo/redo, IME composition, selections and read-only state respected.
They are scoped to outline list context, not installed as global changes to all Markdown notes.
Outside list context, inside code fences and during composition, retain the native editor behavior.
Completion acceptance takes priority over plain Enter; modified Enter must not inadvertently accept a completion.
Keep an accessible way to leave the editor with Tab and existing toolbar-style indent/outdent actions usable without a hardware keyboard.
No independent tree/editor state is synchronized beside the Markdown source.

### R3a — Same-document drag movement

Approved from: User asked「拖曳移動也會做吧？」after confirming Tab/Shift+Tab; parent explicitly included this bounded addition on 2026-10-04.
In the live outline editor, a native-consistent item drag handle and visible drop position/indent level allow sibling reorder and nesting changes.
Move the whole item, annotations and descendants together, preserving their source and relative order.
Dropping inside the item's own descendants is forbidden; cancel changes nothing; read-only disallows movement.
Each drop is one undoable/redoable editor transaction over the same Markdown source, with no parallel editable tree state.
Scope is one outline document only, not cross-note or cross-notebook dragging.
Tab/Shift+Tab and toolbar indentation remain keyboard/touch alternatives.
Verify actual dragging in a real browser, independently of pure movement-helper tests.

### R4 — Familiar UI and persistence feedback

Creation uses the existing New menu beside New note/New compilation and the native note creation dialog's layout, fields and buttons.
Outline documents appear through the native kind filter/list, not as individual sidebar shortcuts in a new singleton section.
Editing, frontmatter, formatting tools, zoom/Focus hosting, save, drafts, errors and Changes use existing note components.
No permanent Saved badge, generic type/path/group form, or Add group dialog remains.
A short editor hint explains Enter, Shift+Enter and indentation without turning the document into a special form.
Fields, labels, buttons, spacing and focus behavior must match the existing note/compilation UI, not merely fit within the viewport.
Provide English and Traditional Chinese labels and keyboard/touch access.

### R5 — Links and navigation

Internal Markdown links use existing workspace-link resolution, notebook/repository identity, dirty-editor guards and note routing.
Generated links use portable relative paths, not deployment URLs or absolute filesystem paths.
External HTTP(S) links open only from explicit user action, in a new tab with opener isolation; unsafe schemes and embedded credentials are non-navigable.
No link previews, automatic website health checks or URL-derived embeds are introduced for outline links.
In particular, an ordinary YouTube link in an outline stays a link rather than becoming a network-fetching media preview.
A missing internal target produces the existing visible link error and retains the source; an unavailable repository is not treated as deletion.
Live mode retains editable source when the caret enters an item and explicit native open-link affordances; raw mode remains source editing, not row-click navigation.
An item containing a link can still have children and annotations.
The source notebook must be present in editor/link scope so equal paths in different repositories cannot cross-resolve.

### R6 — Add current content to an outline

From current note or compilation actions, Add to outline prefills a Markdown link's target and title.
Choose an existing outline in that notebook or create one using native outline creation; there is no target-type/path/group editor.
The chosen destination opens in its existing editor and receives one new item through a normal editable transaction; users can then change its label, annotate or indent inline.
The source action never silently appends to an unmounted stale copy or overwrites a dirty destination draft.
Cancel, source-save failure, read-only permission or destination-load failure adds nothing.
Do not force a remote commit just to create an ordinary link; the normal note-draft and Changes lifecycle remains explicit.

### R7 — Full lifecycle and kind isolation

List/query/lookup/facets, draft overlays, local creation/save/reopen, remote staging/commit, tag/status edits, copy/move/rename, deletion/restore and Git Changes treat an outline as a native note file with its own kind.
Default ordinary-note listings and compilation listings keep their established meaning; kind `all` includes outlines.
Renaming a title does not alter the suffix; normal rename/copy UI preserves `.outline.md` by default.
An explicit file-manager extension change changes classification on refresh, without rewriting body contents or a hidden type flag.
Existing Markdown graph/agenda behavior can consume outline Markdown through the existing paths; no new Workflowy task/graph subsystem is added.
Local worktree save, browser recovery draft, remote pending change and Git commit/push remain distinct states.
Read-only and failed/conflicting operations keep recoverable content and existing protection boundaries.

### R8 — Relocation and non-destructive references

Managed file/folder rename/move updates relative links from and to outline files in the same transaction as the path change.
Moving the outline itself rebases its outgoing links; moving a linked note updates incoming references.
Preserve labels, annotation text, hierarchy, external URLs, fragments and code literals.
Cover local and remote file/folder planners, bulk moves through their shared seam and hosted MCP `mv`; do not assume the shell already rewrites Markdown links.
Same-path documents in other repositories remain untouched.
Deletion retains referring Markdown; restore can make the link resolve again.
Out-of-band Git/filesystem edits are refreshed, not guessed into renames.
Local rollback and provider snapshot/revision pairing remain intact, including retained legacy reference updates.

### R9 — Explicit non-lossy legacy handling

Existing `.mygitnotes-bookmarks.yaml` files are not outlines and are never auto-migrated, silently deleted or reset on read.
Offer an explicit import/recovery entry using existing menu/dialog components, not the rejected bookmark editor.
Preview the chosen repository/notebook, destination new outline, source revision, item/group order, convertible entries and every unsupported entry before applying.
Import is create-only and additive; cancellation writes nothing and import never modifies the original legacy file.
Notes, compilations and safe HTTP(S) URLs can become ordinary links; text groups become ordinary parent items and retain their relative display order.
Exact-position and saved-query entries are not silently approximated; retain them in the source, display their IDs/labels/reasons and allow exact source export.
Folder entries remain legacy in this bounded first import because native folder activation does not guarantee the old saved filtering semantics in every case.
Importing only the representable subset requires an explicit preview acknowledgement and must be called **partial import**, not complete migration.
If nothing is representable, create nothing and explain why.

Malformed/unsupported versions, stale revisions, unknown selected owners, protected destinations, symlinks and permission failures reject the whole apply without partial files.
Other owners, including unknown owners, are never filtered out of the source.
A legacy browser draft must not disappear when the old controller is removed: detect and expose it for exact export/recovery or explicit discard, preserving its original base/revision.
Do not silently merge draft and saved data or pass a new repository head off as its base.
Repeated apply to the same destination cannot duplicate/overwrite it; after an uncertain network result inspect the destination rather than automatically retry at another filename.
Retain legacy path protection and rename relocation while legacy files can still exist.

### R10 — Verification and delivery gates

New requirements start **unknown** until exercised; old feature tests do not prove this redesign.
Use a disposable two-repository fixture, not user notes or credentials.
The parent independently drives native creation, keyboard hierarchy/annotations, optional/internal/external links, save/reopen, current-content insertion and same-path repository isolation in a real browser.
Compare desktop/mobile screenshots against existing note/compilation dialogs/editor chrome and record human appropriateness separately from functional tests.
Core/API tests cover note-kind lifecycle, local/GitHub/GitLab transactions, relocation and canceled/invalid/stale/unknown-owner import.
Existing compilation, ordinary Markdown, Focus and shared recovery/protection tests must still pass.
Update both READMEs and the domain glossary during implementation; keep Startup troubleshooting as the last top-level section in each README.
Upstream-first integration remains the parent's responsibility; no publication is claimed by this plan.

## Non-goals and standards

No full Workflowy parity, node zoom, custom tree editor, stable node IDs, task engine, second group registry, new link protocol, exact-position/query authoring, global singleton bookmarks or automatic migration.
Reuse current components, Markdown parser/rendering and note APIs; add no dependencies unless the implementation exposes a concrete need and obtains authorization.
Preserve current path/symlink protections, repository identity, local mutation queues and provider revision checks.
Apply root TypeScript, UI, Git safety, architecture and Markdown rules; `notes/AGENTS.md` is not a product-root instruction file.

## Reality anchor

Checkpoint: after the sequential implementation and targeted tests, before upstream delivery, the parent runs the independent disposable real-browser journey and existing-UI screenshot comparison in [verification.md](verification.md).
The UI appropriateness gate is not replaced by green tests or a no-overflow measurement.
