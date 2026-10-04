# Outline notes — implementation-ready replacement design

Status: design handoff, not implementation evidence.
Baseline: clean upstream `/home/weihung/github-notes` at `ac26edfe69120fac9eff904b5cb7f53e76966588`.
Contract: [approved outline specification](spec.md); authority and terminology: [decision.md](decision.md).
Owner: `aaaav-do` Durable with `codebase-design`; one sequential writer, no parallel branches.
The existing folder name is historical; the new product is **Outline note / 大綱筆記**, short **Outline / 大綱**.

## Intent and smallest approach

Use an ordinary Markdown note with a recognizable filename suffix and a small, outline-scoped list-command adapter inside the existing editor.
Do not introduce a parallel editable tree, node registry, custom note API, custom form toolkit or specialized bookmark-link schema.
Links are optional inline content; any item may contain links and children.
Keep legacy bookmark data behind a compatibility/import boundary, not as a second source of outline truth.

### Alternatives and decision

| Shape | Depth, locality and compatibility | Decision |
| --- | --- | --- |
| Arbitrary `.md` plus frontmatter `type: outline` | Portable body, but type changes require body reads, create another editable metadata invariant and diverge from staged compilation classification. | Not selected. |
| `*.outline.md` plus normal frontmatter/body | Uses existing Markdown scans, file protection, serializers, relative-link rewriting and the compilation suffix precedent; drafts can classify without a fetch. | Selected; suffix is the only type discriminator. |
| `.outline.yml` tree or Markdown plus hidden JSON registry | Makes node operations convenient but duplicates source/editor state, weakens portability and recreates the rejected model. | Rejected. |
| Separate outline editor/view | Would own caret, undo, links, draft lifecycle and editor hosting again. | Rejected; use native live/raw editor with scoped commands. |

No workspace schema bump or automatic workspace migration is needed for a recognized Markdown suffix.
Ordinary Markdown outside list items is tolerated and preserved, not coerced into a tree on save.

## Source-grounded seams

Line references below describe BASE and may shift during implementation.

| Seam | Verified source/precedent | Required change |
| --- | --- | --- |
| Type discriminator and parsing | `packages/core/src/compilation.ts:7-12`; `note-file.ts:5-42`; `types.ts:71-72` | Add browser-safe `outline.ts` with `OUTLINE_SUFFIX`/`isOutlinePath`; extend kind without changing Markdown serialization. |
| Classification and scans | `classifier.ts:68-75`; `note-service.ts:95-114`; `remote-source.ts:180-183` | Classify outline before generic note, including no-config fallback; existing `.md` scanners already discover it. |
| Queries and drafts | `note-query.ts:46-58,126-129`; `note-catalog.ts:137-157,225-244`; web `lib/draft-overlay.ts:63-86` | Extend `kind`/`all`, separate outline facets, and staged classification; ensure compilation-only ID checks do not touch outline metadata. |
| New menu and dialog | `NoteToolbar.tsx:101-129`; `app/NewNoteDialog.tsx`; `app/useNewNoteDialog.ts:68-123`; `lib/compilation-create.ts` | Add New outline to the native split menu; parameterize native creation for title/folder/status and `.outline.md`, not another bookmark dialog. |
| Browsing | `Sidebar.tsx:235-294`; `useBrowseNotes.ts:45-71`; `useBrowseFacets.ts:24-49`; `lib/filter-query.ts`; `lib/note-facets.ts` | Add outline kind alongside compilation, using the same list/count/filter pattern; remove the old `BookmarksSection`. |
| Editor and save | `NoteEditor.tsx`; `note-editor/useNoteEditorSession.ts`; `MarkdownEditor.tsx`; `LiveMarkdownEditor.tsx`; `app/useNoteSaving.ts:28-53` | Existing note lifecycle and editor hosts; local worktree save versus remote draft/commit stays unchanged. |
| List keys today | `LiveMarkdownEditor.tsx:155-159`; `MarkdownEditor.tsx:419-450` | Live installs Markdown Enter continuation and default keymap, but no Tab indent binding; raw has only formatting/completion handlers, no list-key behavior. |
| Link editing and opening | `live-markdown/decorations.ts:23-31`; `widgets.ts:15-37`; `WorkspaceLinks.tsx:49-121,162-189` | Preserve native decorations/open affordances; fix any capture event that steals Enter from an active editable span. |
| Repository-aware link scope | `NoteEditor.tsx:129,145`; `lib/use-linked-note-preload.ts:21-42`; `lib/note-completion.ts:29-58` | Keep `data-source-notebook`; scope outline candidates to source notebook and use notebook/path keys instead of path alone. |
| Rendering and soft breaks | `lib/markdown.ts:35-42,68-80,124-149` | Existing `breaks: true` makes annotations visible; suppress URL-to-YouTube conversion for outline documents, not for all notes. |
| Relative links and moves | core `workspace-links.ts:3-19`; `folder-plan.ts:22-59,93`; `file-manager.ts:145-157` | Reuse `noteMarkdownLink`/`relocateLinks`; `.outline.md` already matches planner Markdown paths. |
| Hosted shell gap | `note-shell.ts:202-229`; `bookmark-relocation.ts` | Shell `mv` currently copies blob SHAs and relocates only old bookmark metadata, not Markdown links; add outline-link coverage within the same snapshot/commit. |
| Legacy registry and recovery | `workspace-documents.ts:8-33,56-71`; `bookmarks.ts:207`; web `use-workspace-document.ts:34-85` | Retain protection/relocation, retire collection writes and live UI controller, preserve repository-keyed legacy drafts for explicit recovery. |

No product-root AGENTS/GEMINI/CLAUDE or `.claude/skills` workflow was found; `notes/AGENTS.md` is not treated as a root instruction.
Global UI, TypeScript, architecture, Markdown and Git safety rules were read.
The four supplied artifacts are tracked at BASE (`git ls-files`); their earlier claim that they were ignored is no longer true.

## Native model and lifecycle

### Core interface

`packages/core/src/outline.ts` should export only filename/type helpers needed by browser and server, not an item database.
Add its browser-safe export in `packages/core/package.json` and `src/index.ts`.
Extend `NoteItem.kind`, `ParsedNoteFile.extra.kind`, `NoteListItem.kind` to `'compilation' | 'outline'`; absence continues to mean ordinary note.
Extend `NoteKindFilter`, `NOTE_KIND_FILTERS`, `entryKind` and `NoteFilters.kind`.
Keep `entryKind` filename fallback for remote drafts that have never passed through the server.
`parseNoteFile` uses `parseNoteContent` for outlines, adding only the kind and an outline-aware title fallback that strips the complete suffix when no title/H1 exists.
`serializeNoteFile`, tag replacement, frontmatter preservation and timestamps stay on the ordinary Markdown branch.
Stage 3 browser evidence exposed that the ordinary serializer trims a new empty `- ` to `-`; its existing serializer now accepts an outline-only body-whitespace preservation option, retaining the empty content column, indentation and annotation spaces without changing ordinary-note trimming.
No required IDs, node count schema, unique-link constraint or legacy anchor metadata is attached to outline items.

Update `classifyResource` and `ResourceType` consistently, plus every classifier consumer that distinguishes notebook content from assets/product files.
Use the existing note/folder path protections; do not loosen them to accommodate the new kind.
Outline files already satisfy `NOTE_EXTENSIONS` and `isNoteFile`; exercise both local catalog and remote index paths rather than adding another scanner.

Add `NotebookFacets.outlines` using `KindFacets`; adjust core accumulation, web `mergeNotebookFacets`, default/fallback records, draft overlays and tests together.
Ordinary-note counters must not accidentally include outlines after replacing an old `!isCompilationEntry` condition.
Keep compilation duplicate-ID validation restricted to compilation entries; an outline may have ordinary frontmatter named `id` without participating in that registry.
Keep agenda/graph on their existing non-compilation Markdown path, now explicitly including outlines; default ordinary-note queries and dynamic compilation sources still query `kind: note`.
Explicit lookup/open and kind `all` include outlines.
Existing compilation selection/filter semantics must not expand by accident merely because outlines end in `.md`.

### Web creation, browsing and persistence

Parameterize `useNewNoteDialog`/`NewNoteDialog` with the small creation variant `'note' | 'outline'` and an optional initial Markdown body for current-content insertion.
Use the same title, notebook/folder ownership, status/tags, collision lookup, `createOnly`, write permission and error lifecycle.
A blank outline starts with `- `; do not apply arbitrary normal-note templates to overwrite that initial structure.
A current-content-created outline starts with `- ` plus the prefilled ordinary link.
Do not infer an outline from the current selected filter for unrelated New note actions.

Add New outline alongside New note/New compilation in `NoteToolbar`; add an Outline kind row/filter adjacent to Compilation in `Sidebar`, with document counts, not item shortcuts.
Extend `filter-query`, facets and browse hooks so outline kind has native listing, search, status/tags, paging and view selection, without ordinary-folder index promotion.
Reuse `NoteEditorHost`/`NoteEditor` for routing, Focus, zoom and graph-expanded editors; no `OutlineView` component with its own document controller.
The suffix enables the scoped keyboard profile and small help/actions inside `MarkdownEditor`.
Keep title/status/tags/frontmatter, draft recovery, save errors and Changes exactly where native note users find them.
Do not carry `useBookmarks` autosave into the new type.

Document identity remains `NoteRef`/`noteRefKey` plus existing repository query scope.
Keep destination/source identity and editor ownership in deferred callbacks; a late load/insert from repository A must not act on B at the same path.
An extension-changing raw file-manager rename intentionally changes derived kind on refresh; ordinary rename controls retain the compound suffix by default.

## Editor interface and source operations

### One command seam, two existing adapters

Add a bounded web helper such as `lib/outline-editing.ts` accepting source text, selection and command, returning source edits plus next selection or `not-handled`.
Use the installed Markdown syntax tooling (Lezer via the existing CodeMirror Markdown package) to locate list items, paragraphs, fences and subtrees; do not introduce a persistent JSON tree.
This pure operation is the interface; the CodeMirror transaction and textarea selection/change handlers are its two concrete adapters.
Commands own item boundaries, continuation indentation and selection mapping once instead of duplicating string manipulation in both editors.
Use ordinary Markdown list markers/content columns; emit two-space child indentation for new default `-` items while respecting existing marker widths in pasted ordered lists.
Do not reserialize the whole document or normalize unrelated whitespace, CRLF, code or frontmatter.

| Command/context | Required source edit |
| --- | --- |
| Enter at nonempty item end or annotation end | Insert sibling marker after that item's entire subtree, at the item's marker column. |
| Enter inside a text line | Split the selected text line at the caret; move its trailing text to the new sibling; retain other annotations and descendants on the original item. |
| Empty item | Use native Markdown exit/outdent behavior, covered separately from nonempty-item sibling creation. |
| Shift+Enter | Insert newline plus current item content-column indentation, without another marker; resulting paragraph belongs to the same list item. |
| Tab | Move the current/selected sibling subtrees one level beneath their preceding sibling, shifting their annotations/descendants together. |
| Shift+Tab | Promote selected sibling subtrees one level, preserving internal hierarchy. |
| No previous sibling / no parent | No content change; do not invent a parent node. |
| Outside a list, fenced/code block, structurally ambiguous multi-block selection, IME composition | Return `not-handled`; native behavior remains available. |

`Enter` on a plain text item has identical semantics to `Enter` on a link-containing item.
Children are never inferred from link presence or absence.
Continuation indentation alone is not a child: a child has a list marker at its indentation.
No HTML comments, hard-break escapes or proprietary annotation syntax are needed.

Install outline commands above Markdown's high-precedence Enter binding only when they handle list context; coordinate with completion so unmodified Enter first accepts a selected completion.
The installed `@codemirror/lang-markdown` already supplies `insertNewlineContinueMarkup`; default commands bind Enter/Shift+Enter to indentation-aware newline, but neither guarantees the approved same-item annotation contract.
The installed `indentWithTab` is generic line indentation, not sufficient evidence for subtree semantics.
Do not claim the new behavior exists because these packages are installed.

Raw textarea must use the same logical edits/selection mapping and actual undoable input behavior; verify real browser undo, not only `onChange` output.
If browser-native programmatic edits do not enter its undo stack, add a narrowly scoped raw-edit history adapter for outline commands rather than replacing the editor.
Preserve the existing CRLF selection/reveal fixes: `MarkdownEditor.tsx` currently imports these helpers from `bookmark-anchor.ts`; retain them or extract generic text-offset helpers with regression tests before deleting old position UI.
Do not erase those fixes as bookmark-specific dead code.

Respect read-only and composition before key interception.
CodeMirror Tab escape behavior and a raw Escape-then-Tab escape must remain available; document it in the short editor hint.
Add indent/outdent buttons using the existing formatting-toolbar group and `ui-icon-button`, restoring caret focus after activation.
Keep normal notes' Tab behavior and raw formatting/completion unchanged.

### Same-document drag adapter

User-approved addition after planning: live outline items expose native-consistent drag handles and a visible drop marker/indent level.
Inspect existing project drag-and-drop affordances before implementing the editor adapter.
Derive item/subtree ranges from the current Markdown source, not a parallel tree model.
The bounded source-command seam also accepts same-document subtree movement, reorders or nests the entire item with annotations/descendants, and rejects a target inside its own subtree.
A completed drop dispatches one undoable CodeMirror transaction; cancel and read-only change nothing.
No cross-document or cross-notebook drag is supported.
Keep keyboard and touch toolbar alternatives; add pure source preservation tests and real-browser handle/drop/undo/redo evidence.

### Visual editing and link activation

Reuse existing source-on-active-line decorations; render no special folder/leaf icons or custom row forms.
Continuation annotations appear on following lines at the item's content column; nested bullets supply the hierarchy visually in both modes.
Keep the standard explicit open-link affordance, keyboard link activation when that affordance has focus, and editable source when the caret is in the text.
`WorkspaceLinks` currently intercepts Enter/Space on `data-workspace-link` elements in capture phase.
Ensure an active editable CodeMirror text span does not route before the editor receives an outline command; actual link anchors/read-only link elements still activate normally.
Limit any shared fix to editable-text event handling and regress ordinary notes.

Reuse `resolveWorkspaceHref`, `linkScope`, `WorkspaceLinks`, `noteMarkdownLink` and dirty navigation guards.
For generated outline links/candidates, carry source notebook and restrict candidates to that notebook, with `kind: all` to include ordinary notes, compilations and outlines.
Do not use the current global `candidateQuery` without a source scope: it currently queries `notebookId: all`, excludes by path alone and renders raw candidate keys by path.
Add an optional scope to that existing candidate seam rather than creating another picker service; retain existing ordinary-note behavior outside this task.
Pasted ordinary same-repository relative links retain native navigation behavior, with no new cross-repository protocol.

Suppress the existing bare-link-to-YouTube widget/render transform when `isOutlinePath(sourcePath)` is true, across live decorations and `renderNote` consumers.
Outline links should cause no preview/image request just by rendering, including YouTube destinations.
Unsafe destinations remain visible/editable source but cannot activate.
Do not narrow the ordinary-note renderer's existing safe `mailto:`/protocol-relative behavior globally; the new UI generates only internal relative links and absolute HTTP(S), and dangerous schemes remain rejected everywhere.

### Current-content insertion

Replace old bookmark note/compilation action with Add to outline.
Use `WorkspaceDialog`, existing `Select`/`Button`/note candidate presentation for a destination chooser, not a new set of field styles.
Show the prefilled link label/target as a preview; subsequent label edits occur inline in the destination editor.
Offer existing outline documents in the source notebook and New outline through the parameterized native creation dialog.

After guarded source navigation, open the selected destination through existing note routing and wait for its owning editor session to be ready.
Send a consumed-once insertion request keyed by destination `NoteRef`, repository/source generation and request ID through existing editor orchestration; reuse the `MarkdownEditorHandle.insert` seam.
Append a top-level item at a safe Markdown block boundary; if EOF is inside an unclosed fence/ambiguous block, open and focus the editor with an explanatory error instead of inserting into code.
The insertion changes the mounted session's current body, including any recovery draft, not a list row or previously fetched body.
Save through `handleSaveNote`/normal editor lifecycle; preserve later edits and do not create an independent API append protocol.
A staged new source note may be linked within the existing draft lifecycle; do not label that link committed or force a remote commit that the user did not request.
Read-only, cancel, failed source flush, destination disappearance and rapid notebook switches consume no insertion.

## Legacy compatibility and additive import

### Remove the old product surfaces without unprotecting data

| Existing area | Replacement / retention boundary |
| --- | --- |
| `BookmarksSection.tsx`, `BookmarkMenu.tsx`, `BookmarkDialog.tsx`, `bookmarks.css`, sidebar mounting | Remove rejected sidebar collection/forms and permanent Saved status after new native flows are connected. |
| `app/useBookmarkActions.ts`, `lib/bookmark-context.tsx`, `use-bookmark-position.ts` | Replace note/compilation creation entrypoints with outline insertion; remove position activation/capture plumbing from `NoteEditor`, outline panel and toolbar. |
| `FolderActions`, `FolderTree`, `NoteToolbar.onSaveView` | Remove old Add folder bookmark / Save view / group UI; do not invent new outline target forms for these legacy target types. |
| `App`, `use-workspace-sync`, `workspace-document-clients`, `lib/use-bookmarks` | Remove the live editable collection controller and normal Changes registration; replace with explicit read-only legacy discovery/recovery client. |
| `/api/bookmarks` and `/api/bookmarks/resolve` in `apps/local-server/src/app.ts` | Retire old authoring/resolution API; old PUT returns a typed 410 retirement response with no write, and old GET may remain a read-only compatibility/export response during this transition. New app uses import preview, not the resolver. |
| `bookmarks.ts`, `bookmark-query.ts`, `bookmark-anchor.ts`, `bookmark-resolution.ts`, `bookmark-relocation.ts` | Keep strict legacy parsing/limits and relocation needed by existing data; stop using domain operations as active outline model. Delete only demonstrably unused code after call-site review. |
| `WORKSPACE_DOCUMENTS`, `CommitScope`, remote document commits | Keep legacy filename reserved, validated and included in move snapshots; remove ordinary `bookmarks` authoring scope and reject legacy document edits through remote Changes as well as PUT. Allow only trusted existing move scopes to relocate it. |
| Shared race, path/symlink and CRLF safeguards | Preserve them, including HTTP/MCP protections, unknown-owner retention and raw offset mapping; they are not invalidated by the UI rejection. |
| `filter-query` sort fields / graph scope / shared draft settlement | Retain useful existing behavior used outside retired bookmark UI; avoid unrelated cleanup. Rename generic conflict messages away from bookmark wording where shared callers still use them. |

The compatibility registry entry is deliberately not deleted in the same release.
Removing it now would stop legacy rename updates and could turn protected metadata into a file-manager/MCP mutation target.
A future removal requires a separate deprecation decision and evidence that all remaining data has a safe disposition; import does not make that assumption.

### Import interface

Add a pure `planLegacyOutlineImport` in a browser-safe/core import module (for example `packages/core/src/outline-import.ts`).
Inputs: validated legacy page, repository-scoped configured owner, explicit selected legacy IDs, destination `.outline.md` path and title.
Output: proposed Markdown plus a report of converted IDs, retained IDs/reasons, groups and display order; no mutation of input.
Server adapters own reading raw bytes, parsing, revisions, permission, path checks and writes.
Escape text-only legacy labels so a label like `[x](...)` does not accidentally acquire link semantics; use `noteMarkdownLink` for actual internal references.
Retain duplicate labels/targets and empty groups instead of applying old deduplication rules to freeform outline items.

| Legacy target | Import disposition |
| --- | --- |
| note / compilation | Relative Markdown link from destination to the original owner-root-resolved path, preserving explicit label even when the target is missing. |
| URL | Safe validated HTTP(S) Markdown link; escape/encode Markdown-sensitive URL delimiters without changing query/fragment meaning. |
| group | Text-only parent item; member order follows old bookmark array projection, group order follows group array, ungrouped items retain display order. It is now an ordinary node. |
| exact position | Retain in source and report unsupported; no slug guess, whole-note downgrade or hidden metadata side channel. |
| query/view | Retain in source and report unsupported; no deployment URL or new query syntax. |
| folder | Retain in source and report unsupported for this first import; native folder fallback is not guaranteed equivalent to the old clean filtered-view behavior. |

Expose a bounded preview/apply adapter, e.g. `POST /api/outline-import/preview` and `POST /api/outline-import`.
Preview is read-only despite POST and remains usable on a read-only branch; it returns `writable: false` rather than requiring a mutation grant.
Require explicit repository and notebook IDs, not a home-repository default.
Preview reads the legacy raw file and destination existence from one snapshot, returns a source token, proposed content and converted/retained report, and creates nothing.
The token pairs repository identity, source byte revision/hash, configured owner/root fingerprint and destination absence; remote preview also carries the captured commit SHA.
The apply request sends those identities, selected IDs, destination/title and an explicit partial-import acknowledgement where needed; never trust client-supplied Markdown instead of recomputing the plan.
Bound requests with existing legacy limits and note/commit size limits; reject unknown properties and cross-owner IDs.

Local apply runs within `serializeWorkspaceMutation`, rechecks branch/write permission, owner config, legacy raw revision and destination absence, recomputes the plan, then creates one ordinary note using existing safe-path/atomic file primitives.
Reuse file-manager snapshot/planning/apply helpers where possible rather than inventing rollback infrastructure.
Remote apply uses one immutable snapshot for legacy/destination reads and one existing `RemoteSource.commitChanges` commit for the new outline with expected head; use GitHub/GitLab provider adapters, never a second provider client.
The confirmation explicitly says local import creates a worktree file, while remote import creates one commit; this is an intentional import operation, not the ordinary editor Save action.
Do not modify/delete legacy bytes, consume browser drafts or overwrite a destination in either adapter.
Return the created native note ref/revision and the same retained-item report.
Source changes, owner/root changes, preexisting destinations, malformed/unsupported legacy data, invalid selected IDs, unknown selected owners, unsafe paths or read-only state fail before any write.
Keep existing provider guarantees honest: GitLab changed-file preconditions plus branch recheck are not universal whole-branch CAS after the final check.
No automatic retry to a new filename; after timeout, read the originally requested destination and compare before offering a retry.

Unknown-owner collections may be shown in the recovery report but are never reassigned or imported into the currently selected notebook.
A known owner can import its representable entries while the complete original file, including unknown-owner records, remains intact.
No representable selected entries means no output file, even if groups exist.
Import does not create an import-status registry or mark the old file migrated.
Re-importing to a different explicitly selected filename is a new user action; reapplying to the same filename is a collision, not an overwrite.

### Legacy browser draft recovery

Before removing `bookmarksDocumentClient` from normal editable document enumeration, add a read-only recovery path for `github-notes:bookmarks-draft:<repository>`.
Detect drafts across all configured repository IDs, not just the selected notebook.
Keep the stored envelope byte-for-byte on read, including `page`, `base`, `revision`, `id` and ancestry; malformed/unknown-version drafts remain downloadable as raw JSON, never rewritten empty.
Show saved-versus-draft provenance and a clear pending-recovery notice through an existing dialog/notice surface, not the old bookmark section.
The bounded implementation can export the exact draft envelope and import the saved source separately; it must not offer a falsely reconciled draft import.
Explicit discard confirms which repository's recovery draft is being removed; cancel removes nothing.
Disable normal commit/autosave of that retired draft, and keep it visible as a recovery blocker rather than silently dropping it from pending changes.
The new outline docs use only normal note drafts.

## Relocation coverage and atomicity

`*.outline.md` already flows through `relocateLinks` in `planFileChange` and `planFolderChange`.
Test this rather than adding a second outline-link registry or relocation parser.
Both source and target moves matter: rewriting links in an outline moved to a new folder and rewriting links from other notes/outlines to that file.
Preserve reference-style destinations, fragments, Unicode/escaped labels and unrelated text/code; extend the existing shared rewriter only if a tested ordinary Markdown case fails.

| Entrypoint | Required proof |
| --- | --- |
| Local/remote file move and rename | Destination file and all affected refs appear together; stale snapshot refuses; local fault restores original bytes. |
| Folder move / removal keeping contents | Entire subtree and relative links rebase, including outline annotations; legacy registry participates as before. |
| Bulk note move | Each sequential file transaction uses returned revision; partial-batch failures retain existing honest reporting. |
| Hosted MCP `mv` | Add a snapshot-pinned Markdown relocation change set for moved outline source links and incoming links to moved targets; merge by final destination path with existing SHA moves/deletions before a single commit. |
| Cross-notebook same-repository shell move | Preserve actual repository-relative target meaning where native links can represent it; never select another repository by equal roots. Existing legacy same-owner-only retention rule remains unchanged. |
| Delete/restore and recursive delete | Referring outline Markdown is not pruned; restore resolves normally. |
| Copy / title edit / Git pull or external rename | Copy retains source bytes under existing semantics; metadata title changes do not rename; external path changes are not inferred. |

Shell `mv` already uses scope `folders` and one captured snapshot; extend that adapter instead of calling a second commit after movement.
Do not change ordinary compilation YAML rendering or add unsupported shell compilation operations as part of this outline task.
Keep path/count/byte limits, snapshot revisions, metadata protection and rollback intact.

## Ordered implementation tasks

All tasks are sequential in upstream; no independent parallel writers or worktree branches are planned.
Dependencies below are verified prior tasks in the same working tree, not permission to branch from uncommitted work.
The parent owns commits/integration and upstream-first delivery.
Any persistent server/watcher must use `MonitorCreate`, never `&`/`nohup`; record PID/port, stop with `MonitorStop`, verify PID/listener cleanup and close only the owned `agent-browser --session <name>`.
No task may modify user notebooks, secrets, `.env`, downstream checkouts or make live-provider writes during verification.

### 1. Add the native outline kind and lifecycle contracts

- **Files/area:** core `outline.ts` (new), `types.ts`, `note-file.ts`, `classifier.ts`, `note-query.ts`, `note-filters.ts`, `note-catalog.ts`, exports; web `filter-query.ts`, `note-facets.ts`, `draft-overlay.ts`, query types/fallback fixtures.
- **Behavior:** Suffix-derived kind, portable Markdown parse/serialize, separate queries/facets, proper remote draft kind, unchanged compilation identity and default ordinary-note filters.
- **Constraints:** No manifest migration, registry or new serializer; retain native read/write protections.
- **Acceptance:** New core classifier/parser/catalog tests plus local/remote create/query/lookup/save/tag/status/delete/restore tests; compilation catalog/move tests unchanged and green.
- **Depends on:** none; BASE `ac26edfe69120fac9eff904b5cb7f53e76966588`.
- **Workspace:** sequential.

### 2. Implement source-based outline commands in both native editor modes

- **Files/area:** new web `lib/outline-editing.ts`; `MarkdownEditor.tsx`, `LiveMarkdownEditor.tsx`, formatting toolbar and bounded help/i18n; `WorkspaceLinks.tsx` editable event handling; `markdown.ts` and live decorations for URL-only links.
- **Behavior:** Approved sibling/annotation/subtree commands and same-document live-editor subtree drag movement, optional links, source editing, safe activation and no automatic YouTube preview.
- **Constraints:** One Markdown source, existing editors, scoped behavior, IME/read-only/completion/undo/CRLF preserved, no global Markdown behavior rewrite.
- **Acceptance:** Pure source-edit assertions and real mounted CodeMirror/textarea key events covering mid-line/end/annotation/children/empty/fenced cases, selection, undo/redo, tab escape and link click versus Enter editing.
- **Depends on:** task 1.
- **Workspace:** sequential.

### 3. Connect native creation, browsing and current-content insertion

- **Files/area:** `NoteToolbar`, `Sidebar`, `NewNoteDialog`, `useNewNoteDialog`, browse hooks, `App`, `NoteEditor`/shared editing context; new bounded outline action hook; scoped `note-completion` seam; EN/zh-TW labels.
- **Behavior:** Multiple outline documents, native kind list and creation, existing save/Focus/zoom; destination chooser with prefilled current-content link and consumed-once mounted-editor insertion.
- **Constraints:** Existing `Select`, `Button`, `WorkspaceDialog` and field styles; no target/group forms, no stale out-of-band append, no permanent Saved label.
- **Acceptance:** Creation and action tests including dirty destination/source failure/cancel/repository race/read-only; native list/facet counts before and after remote staging/commit and reopening.
- **Depends on:** tasks 1–2.
- **Workspace:** sequential.

### 4. Verify and close relocation gaps

- **Files/area:** core `folder-plan.ts`, `file-manager.ts`, `note-shell.ts` and a bounded snapshot relocation helper if needed; local-server file/folder adapters; existing move/rollback/MCP tests.
- **Behavior:** Native Markdown refs from/to outlines track managed moves, including hosted shell movement, in the same transaction; retained legacy relocation still runs.
- **Constraints:** No second commit, no cross-repository matching, no deletion pruning, no broad compilation changes.
- **Acceptance:** Local fault-injection rollback; stale/move-vs-edit; GitHub tree and GitLab action assertions; source and target moves, nested directories, copy/delete/restore and compilation regression coverage.
- **Depends on:** task 1, verified with task 3 lifecycle.
- **Workspace:** sequential.

### 5. Add explicit legacy import and recovery, then retire old writes/UI

- **Files/area:** new core `outline-import.ts` and local-server adapter; `app.ts`, `workspace-documents.ts`, `remote-source.ts`; old bookmark components/hooks/context, workspace sync/document clients, normal commit boundary; existing dialog/notice surfaces.
- **Behavior:** Read-only discovery/preview, additive create-only import, explicit partial report and exact exports; retained drafts/unknown owners; old UI and authoring paths removed or rejected.
- **Constraints:** Never auto-migrate/delete original data or silently merge drafts; keep path protections, strict legacy schemas, rename relocation, useful shared race/CRLF fixes.
- **Acceptance:** Pure conversion/report tests and local/GitHub/GitLab API tests for cancel/no-write, stale/source/owner changes, destination collision, invalid/unsupported data, unknown owner, partial acknowledgement, no convertible entries, provider failure and unmodified legacy bytes; browser draft recovery/export/discard-cancel tests.
- **Depends on:** tasks 1–4; new flow and recovery must exist before old registrations disappear.
- **Workspace:** sequential.

### 6. Exercise the disposable reality anchor and update usage documents

- **Files/area:** adapt `scripts/qa-bookmarks-fixture.mjs` (retain name or rename callers consistently), new/updated tests, both READMEs, `docs/CONTEXT.md`, this folder's `verification.md`.
- **Behavior:** Two disposable repositories with identical paths, multiple outlines, ordinary notes, compilation and legacy fixtures; independent parent native-browser journey and existing-UI screenshot comparison.
- **Constraints:** No production/user-workspace migration; old UI human FAIL remains recorded; keep README troubleshooting last; obey process/browser cleanup rule above.
- **Acceptance:** Targeted/full tests, builds/type/lint/format, parent browser evidence and explicit human appropriateness verdict remain separate; requirements not exercised remain unknown.
- **Depends on:** tasks 1–5.
- **Workspace:** sequential.

## Verification strategy

Implementation should first build package exports for server/web tests importing core `dist`, run targeted tests at each seam, then run `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm format:check`, and fresh web/server `tsc --noEmit` with the repository project configs.
Use active LSP path diagnostics on changed TypeScript; empty cached results are not proof.
Extend actual existing suites: core `tests/compilation-catalog.test.ts`, `tests/compilation-moves.test.ts`, `tests/file-manager.test.ts`, `src/folder-plan.test.ts`, `tests/note-shell.test.ts`, `tests/bookmark-relocation.test.ts`, `tests/bookmarks-remote.test.ts`; server `tests/bookmarks.test.ts`, `tests/bookmark-rollback.test.ts` and notebook repository tests; MCP `tests/bookmark-protection.test.ts`; web `Sidebar.test.tsx`, `NoteToolbar.test.tsx`, editor/draft/save and workspace-link tests.
New outline-specific suites should assert public parser/query/import contracts and actual editor adapters, not only mock a proposed command function.
Deterministic GitHub/GitLab fixtures are not live-provider proof.
The full browser matrix and honest results start in [verification.md](verification.md).

## Risks and open questions

- Native key behavior must be proven on actual CodeMirror and textarea, especially caret-in-link capture, annotated subtree splits, undo and IME; package defaults are insufficient.
- Kind expansion touches facet defaults/draft overlays and broad `not compilation` branches; compilation uniqueness and ordinary-note filtering are regression-sensitive.
- Hosted shell currently does not rewrite Markdown links; leaving it unchanged would violate managed outline relocation even if UI moves pass.
- Pending legacy drafts and direct remote document commits can keep the rejected write model alive unless both are explicitly retired/recovered.
- Ordinary Markdown cannot faithfully express old exact positions/views; this plan retains them rather than inventing syntax or silently approximating them.
- No blocking user question remains for this scope; active conversion of unsupported target kinds or deletion of legacy archives requires a separate decision.

## Friction Notes

- Tried: parent review against immutable stages 1–3, followed by local/remote no-force R2 deletion regressions.
  Found: ordinary-note kind isolation had narrowed the scans used as all-reference bodies, allowing deletion of outline-only assets. Dedicated local `scanNotebookMarkdownNotes` and remote `markdownNotes` enumeration restores the safety guard without broadening ordinary listings.
  Led by: parent reviewer OUTLINE-R1-F001 and R7 lifecycle/protection requirements.
  Classification: implementation regression; actual loopback bucket tests assert zero DELETE requests and unchanged objects.
- Tried: parent adjacency reproductions and actual mounted drag adapter tests with annotated subtrees, LF/CRLF, EOF and trailing prose.
  Found: same-offset delete and insert overlap in `applyEdits`, duplicating a subtree for both no-op drops and legitimate adjacent nesting. Coalescing that boundary into one replacement preserves no-op bytes and valid indentation changes.
  Led by: parent reviewer OUTLINE-R1-F002 and R3a source/undo contract.
  Classification: implementation regression; pure cases, mounted pointer finish/undo/redo and actual browser recheck cover the correction.

- Tried: stage 4 red-anchor relocation cases before shared rewriting changes.
  Found: escaped closing brackets were not rewritten; unfinished fences and indented code were rewritten as links. Hosted shell moves omitted all Markdown relocation, as documented.
  Led by: task 4 source-preservation and shell snapshot contract.
  Classification: evidenced shared-seam gaps; retain source edits, add bounded code shielding and escaped-label handling instead of a second outline parser.
- Tried: top-level code shielding and the existing GitHub fixture for a concurrent-head move test.
  Found: nested indented code needs list/blockquote block-token line ranges, and the fixture asserted `force: false` without enforcing non-fast-forward refusal. GitHub can create an unreachable commit before refusing the ref update; GitLab rejects before creating its commit.
  Led by: R8 code preservation and snapshot/revision pairing.
  Classification: bounded shared-seam and fixture gaps; use existing Marked block tokens mapped back to original line offsets, model fixture ref rejection, and assert unchanged branch/tree instead of claiming zero GitHub commit objects. A follow-up red test showed a longer closing fence acting as an inline backtick opener; rewrite only prose between protected ranges so block delimiters cannot consume subsequent links.
- Tried: adding GitLab test files after fixture initialization and using a guessed `baseUrl` descriptor property.
  Found: existing-file actions require the fixture's initialized last-commit table, and the descriptor uses `url`; seed extra files before initializing versions.
  Led by: deterministic provider verification.
  Classification: test setup gap; additive fixture input only, no provider behavior change.

- Tried: inspecting a presumed `packages/core/src/local-source.ts` and `lib/use-workspace-links.ts`.
  Found: local note pipelines live in note-service/server adapters; the web link dispatcher is `components/WorkspaceLinks.tsx`, with repository scope in `lib/use-linked-note-preload.ts`.
  Led by: none.
  Classification: discovery gap; corrected paths in the seam table, no production conclusion relies on the missing files.
- Tried: carrying the intermediate bookmark-document terminology into the replacement decision.
  Found: the user's later clarification approved general Outline notes; link presence must not define item kind or impose a group/leaf distinction.
  Led by: initial caller brief, superseded by the parent's later user-confirmed model.
  Classification: changed authority, not a code defect; all four artifacts now use the latest model.
- Tried: `read_symbol` with `RemoteSource.notebookFiles`.
  Found: this tool resolves the class method by `notebookFiles`, despite its documented dotted-member form.
  Led by: `read_symbol` tool documentation.
  Classification: tool mismatch; continued with the returned exact symbol name, no source assumption changed.
- Tried: asserting a newly serialized note body exactly equals its supplied body and running multiple GitHub mutations with Vitest's default five-second timeout.
  Found: native Markdown serialization adds the established frontmatter separator newline; the GitHub adapter intentionally spaces writes by one second, and existing provider suites use a 30-second budget.
  Led by: existing native note pipeline and provider-fixture precedent.
  Classification: test discovery gap; preserve native serialization and provider throttling, assert the stored native body and use the established test budget.
- Tried: testing worktree-only creation via bare POST `/api/notes`.
  Found: native local HTTP writes commit by default; the editor explicitly supplies `noCommit: true` for worktree saves.
  Led by: approved native save lifecycle.
  Classification: test setup gap; integration checks now use the actual editor's explicit no-commit flag and native restore endpoint.
- Tried: active web LSP diagnostics after rebuilding core exports.
  Found: the language server retained the old `dist` declarations, while fresh web `tsc --noEmit` passed.
  Led by: required active LSP verification.
  Classification: tool cache gap; retain both results and use fresh compiler evidence rather than label stale diagnostics as product errors.
- Tried: restoring raw-outline command selection in `requestAnimationFrame`, following the existing formatting adapter.
  Found: consecutive commands could arrive before that frame and act on the textarea's reset selection instead of the original item.
  Led by: existing raw formatting code.
  Classification: gap resolved by the change; outline selection restoration now runs in the controlled editor's layout effect, with mounted rapid-key regression coverage.
- Tried: relying only on CodeMirror `composing` and its default Escape handling.
  Found: `composing` becomes true only after a composition text mutation, and a consumed Escape does not necessarily enable Tab escape.
  Led by: approved IME/accessibility contract.
  Classification: gap resolved by the change; a scoped native capture guard preserves IME default behavior and explicit `setTabFocusMode` guarantees Escape-Tab.
- Tried: treating `acceptCompletion` returning false as permission to run outline Enter.
  Found: CodeMirror's interaction-delay guard may return false while a completion is already active.
  Led by: native completion reuse.
  Classification: gap resolved by the change; active completion always owns plain Enter, including its delay window; modified Enter remains an annotation.
- Tried: placing native drag handles in a CodeMirror gutter.
  Found: the native centered document card can be far from the gutter, and the gutter is aria-hidden.
  Led by: native editor seam reuse.
  Classification: gap resolved by the change; zero-width inline CodeMirror widgets put handles beside their item markers without changing source or card layout.
- Tried: expecting rendered HTML alone to retain `target=_blank` and treating every live-editor `img` as a preview.
  Found: the native final sanitizer strips `target`; `WorkspaceLinks` owns safe new-tab activation, and CodeMirror uses source-less `img.cm-widgetBuffer` nodes for caret positioning.
  Led by: no-network-preview and safe-link acceptance tests.
  Classification: test gap resolved by checking actual link activation with opener isolation and only image `src`/media-preview nodes.
- Tried: short repeated exact-replacement anchors in two edit batches.
  Found: the tool partially applies unique edits and rejects a repeated anchor.
  Led by: exact edit tool usage.
  Classification: general tool-use slip; only unapplied replacements were retried with unique context; no rule or product workaround added.
- Tried: rejecting an unfinished HTML block solely by Lezer's `HTMLBlock` node name.
  Found: HTML comments and processing instructions have distinct `CommentBlock` and `ProcessingInstructionBlock` nodes; the safe-append seam now refuses all three ambiguous EOF block families.
  Led by: approved source-aware insertion contract.
  Classification: parser discovery gap; bounded pure regression added, no new global rule.
- Tried: creating a blank outline with the ordinary serializer's default body handling.
  Found: real HTTP readback was `\n-\n`, because `content.trim()` removed the item's content-column space; an outline-only option in the shared serializer now preserves body whitespace and has round-trip/ordinary-note regression coverage.
  Led by: existing native Markdown lifecycle reuse.
  Classification: shared seam gap; retained one serializer and ordinary-note behavior.
- Tried: transferring from the destination chooser to native creation using existing dialog cleanup.
  Found: real browser autofocus moved back to the prior Add to outline button; `WorkspaceDialog` now restores its trigger only when focus has not already moved into the succeeding dialog.
  Led by: existing WorkspaceDialog focus lifecycle.
  Classification: integration gap; mounted regression and real-browser recheck required, no new UI toolkit.
- Tried: spying on JSDOM's dialog `showModal`/`close` for the focus regression.
  Found: those native methods are absent in this test environment; the bounded test supplies and removes the same methods, while actual browser behavior is verified independently.
  Led by: mounted dialog test setup.
  Classification: test-environment gap, not production evidence.
- Tried: treating dispatch to existing note navigation as immediately ready for insertion.
  Found: graph navigation may perform a second guarded editor flush; requests are now unarmed until navigation succeeds, including a self-link destination already mounted at the source route.
  Led by: source-save failure and consumed-once insertion contract.
  Classification: integration gap; explicit failed-navigation regression added.
- Tried: staging the explicit changed production and tracked specification paths together.
  Found: Git returned an ignored `docs/specs` directory warning after successfully staging the tracked files; `git ls-files --stage` and the cached diff confirmed their tracked updated blobs.
  Led by: explicit-path Git safety rule.
  Classification: Git staging diagnostic gap; inspect the index and use tracked-only updates, without changing ignore rules or adding machine-local cache files.
