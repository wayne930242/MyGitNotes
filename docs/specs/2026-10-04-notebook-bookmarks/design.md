# Notebook bookmarks — implementation design

Status: implementation-ready design; no product implementation or feature verification is claimed here.
Baseline: upstream `/home/weihung/github-notes`, Core `298eb47`.
Contract: [approved specification](spec.md); terminology and authorization: [decisions](decision.md).
Owner: `aaaav-do` Durable Design, with `codebase-design` for seams and `domain-modeling` for invariants.

## Intent and scope

Deliver every approved target in one coherent implementation: note, folder, compilation, heading/paragraph position, HTTP(S) URL, and saved query/view.
Bookmarks belong to a notebook, share its repository permissions, and remain references rather than copies of content.
This design changes neither the approved specification nor the meaning of compilation, Focus, or notebook.
There is no schema migration, new dependency, deployment, or private favorites store.
The implementation and subsequent verification belong in upstream before the parent's authorized push and downstream synchronization.

## Source-grounded architecture

| Area | Current evidence | Consequence |
| --- | --- | --- |
| Optional shared metadata | [WorkspaceDocument registry](../../../packages/core/src/workspace-documents.ts), [Focus document](../../../packages/core/src/focus-page.ts), [document HTTP adapter](../../../apps/local-server/src/workspace-document.ts) | Reuse a repository-root, versioned YAML document rather than extending `.mygitnotes.yaml`. |
| Repository ownership | [request workspace](../../../apps/local-server/src/request-workspace.ts), especially `notebookRepository`, `repositoryOrHome`, and `openWorkspace`; [domain context](../../CONTEXT.md) | Resolve the owning notebook through configured repository handles; deployment origin and primary worktree do not identify a bookmark's repository. |
| Local transactions | [mutation queue](../../../apps/local-server/src/workspace-mutation.ts), [folder apply/rollback](../../../apps/local-server/src/folder-manager.ts), [file apply/rollback](../../../apps/local-server/src/file-manager.ts) | Bookmark writes and reference relocation share the same worktree queue and rollback boundary. |
| Remote transactions | [RemoteSource](../../../packages/core/src/remote-source.ts), `getSnapshot`, `commitNotes`, `commitChanges`; [GitHub](../../../packages/core/src/github-source.ts); [GitLab](../../../packages/core/src/gitlab-source.ts) | Read metadata and targets from one snapshot, then commit all changed paths using that snapshot's revision. |
| Existing relocation | [folder planner](../../../packages/core/src/folder-plan.ts), [file planner](../../../packages/core/src/file-manager.ts) | Both already call `relocateWorkspaceDocuments`; register bookmarks there rather than implementing relocation in UI handlers. |
| Additional movement surface | [remote note shell](../../../packages/core/src/note-shell.ts), `callNoteShell` `mv`; [MCP repository routing](../../../packages/mcp-server/src/workspace-remote.ts) | MCP moves currently bypass the planners and must explicitly include bookmark relocation in their existing atomic commit. |
| Query definitions | [filter URL codec](../../../apps/web/src/lib/filter-query.ts), [filters](../../../packages/core/src/note-filters.ts), [browse query](../../../apps/web/src/app/useBrowseNotes.ts), [sort state](../../../apps/web/src/app/useNoteSort.ts) | Persist typed filters and sort, not a URL or result list; sort currently lives outside the filter URL. |
| Positions | [outline source offsets](../../../apps/web/src/lib/note-navigation.ts), [MarkdownEditor handle](../../../apps/web/src/components/MarkdownEditor.tsx), [live editor](../../../apps/web/src/components/LiveMarkdownEditor.tsx) | Exact source matching can reveal a range through existing editors; heading slugs and rendered DOM text are not stable identities. |
| Dirty state | [document drafts](../../../apps/web/src/lib/use-workspace-document.ts), [note save](../../../apps/web/src/app/useNoteSaving.ts), [remote commit](../../../apps/web/src/app/useWorkingNoteCommit.ts), [editor registry](../../../apps/web/src/lib/note-editing.tsx) | Local save writes the worktree, but remote editor save only stages a browser draft; position creation must explicitly distinguish them. |

### Storage/interface alternatives

| Option | Advantages | Cost and decision |
| --- | --- | --- |
| Optional bookmarks inside each `NotebookConfig` | Notebook identity is immediately present. | Rejected: the manifest lives in the primary repository, while notebook content can live elsewhere; unrelated configuration contention and credentials would own bookmark writes. |
| `<notebook.root>/.mygitnotes-bookmarks.yaml` per notebook | Physical ownership and smaller conflict unit. | Viable, but not selected: all existing document registries, remote commit allowlists, Changes clients, and auxiliary snapshot readers use a fixed repository-root filename; dynamic files add a second storage protocol. |
| One optional repository-root `.mygitnotes-bookmarks.yaml`, containing notebook-owned collections | Matches Focus/Study storage, existing Git Changes and document draft lifecycle, and both relocation planners. | Selected: one revision covers the repository's collections; the UI edits only the owning notebook's collection and preserves the others. |
| Separate operation-specific REST endpoints for every group/bookmark operation | Server could own each edit command. | Rejected for this run: creates a second draft/commit protocol and obstructs existing whole-document Changes. Use pure domain operations and one versioned document endpoint with server validation. |

The selected seam is `WorkspaceDocument<BookmarksPage>` plus pure bookmark operations, exact anchor matching, and query canonicalization.
Do not import Express, filesystem, React, router state, or `window` into the domain module.
Expose browser-safe subpath exports, as Focus and compilation already do.
A small transport resolver translates relative targets into the owning repository's read operations; it never follows arbitrary URLs.

## Persisted model and invariants

Add `packages/core/src/bookmarks.ts`, `bookmark-anchor.ts`, and `bookmark-query.ts`.
Use Zod strict schemas and domain-specific `BookmarkError` codes, translated to HTTP errors at the edge.
Public object types use interfaces where practical; discriminated unions describe target variants.

```typescript
interface BookmarksPage {
  version: 1;
  notebooks: NotebookBookmarks[];
}
interface NotebookBookmarks {
  notebookId: string;
  groups: BookmarkGroup[];
  bookmarks: Bookmark[];
}
interface BookmarkGroup {
  id: string;
  label: string;
}
interface Bookmark {
  id: string;
  label: string;
  groupId: string | null;
  target: BookmarkTarget;
}
type BookmarkTarget =
  | { kind: 'note'; path: string }
  | { kind: 'folder'; path: string }
  | { kind: 'compilation'; path: string }
  | { kind: 'position'; path: string; anchor: TextAnchor }
  | { kind: 'url'; url: string }
  | { kind: 'query'; query: SavedBookmarkQuery };
interface TextAnchor {
  version: 1;
  kind: 'heading' | 'paragraph';
  exact: string;
  prefix: string;
  suffix: string;
  fromHint: number;
}
interface SavedBookmarkQuery {
  q: string;
  kind: 'note' | 'compilation';
  tags: string[];
  folders: string[];
  descendants: boolean;
  tagMode: 'any' | 'all';
  status: string | null;
  showHidden: boolean;
  neighbors: boolean;
  view: 'flat' | 'list' | 'card' | 'kanban' | 'graph';
  sort: { field: 'updated' | 'created' | 'title' | 'status'; order: 'asc' | 'desc' };
}
```

### Scope, paths, and limits

- `notebookId` is the logical owner, never a repository URL or filesystem path.
- All persisted `path` and query `folders` values are **notebook-root-relative**.
  Store `chapter/a.md`, not `notes/books/chapter/a.md`, an absolute path, or a browser route.
  Empty string is allowed only for a folder target or folder filter meaning the notebook root.
- Convert to repository paths at adapters using the notebook's configured root.
  Validate segments before joining; reject absolute/drive-qualified paths, URL-scheme prefixes, backslashes, control characters, empty interior segments, `.` and `..`.
  Keep case and Unicode unchanged; never URI-decode an already parsed stored path a second time.
  Recheck ownership against the complete repository notebook scope, including a more-specific nested root; a relative path must not enter a different notebook, asset alias, protected metadata, or Agent directory.
- `version: 1` and `anchor.version: 1` are literal schema versions.
  Unsupported versions, malformed YAML, unknown properties, invalid IDs, or invalid group references are visible errors, not an empty page or a migration opportunity.
- Use existing YAML parsing with bounded aliases, plus limits before and after parsing.
  Proposed implementation constants: 1 MiB serialized YAML per repository, 500 bookmarks total, 100 groups total, at most 100 notebook collections.
  IDs use existing `[A-Za-z0-9_-]{1,64}` convention; notebook IDs are 1–128 characters; labels are trimmed nonempty strings of at most 120 characters; paths at most 2048 characters.
  Query text is at most 1000 characters; at most 100 tags and 100 folders; each tag/status at most 128 characters.
  URL is at most 4096 characters; exact anchor is nonempty and at most 8192 UTF-16 code units; prefix/suffix at most 128 each; hint is a nonnegative safe integer.
  Never silently truncate an anchor or query to fit; ask the user to select a smaller passage through an in-app validation message.
- A missing file reads as `{ version: 1, notebooks: [] }` without creating a file.
  Removing the last bookmark persists a valid empty document on an explicit save; reads and target checks never write.
- Notebook collection IDs are unique in the page; group IDs and bookmark IDs are unique within their owning collection; each non-null `groupId` must identify exactly one group in that collection.
  UI/query identity is the pair `(notebookId, bookmarkId)`, additionally scoped by repository for transport/cache state.
  IDs are stable across rename, re-target, grouping, ordering, and unresolved states.
  Labels are explicit, with creation prefilled from the current target title; subsequent target title changes do not overwrite the label.
- Group array order is presentation order.
  Bookmark array order is the stable manual order; each group's list and the ungrouped list are projections preserving array order.
  Moving within a list repositions the entry; moving to a group appends after that group's last entry unless a specific insertion position is supplied.
  Group deletion appends its members after current ungrouped entries in their prior relative order, removes only the group, and sets member `groupId` to null.
- Duplicate target identities are not a reason to discard a file or existing entries.
  Relocation can converge two folder references; preserve both IDs rather than losing user labels.
  Creation and re-target operations reject a newly equivalent target and return the existing ID for the UI's Edit existing action.
  An unchanged target may still have its label/group/order edited even when a previous relocation produced equivalent entries.
- Unknown notebook IDs found in an existing repository document remain semantically intact in the parsed page; never filter them out while reading.
  They have no navigable owner in the current manifest and are not offered for creation.
  Writes may preserve these collections unchanged but cannot create or alter an unconfigured collection.

### Domain operations

Expose `emptyBookmarksPage`, `notebookBookmarks`, `addBookmark`, `updateBookmark`, `removeBookmark`, `addBookmarkGroup`, `renameBookmarkGroup`, `removeBookmarkGroup`, `moveBookmark`, and `moveBookmarkGroup`.
Each returns a validated next page or a typed error; no operation mutates notes or opens a URL.
Use a supplied/generated ID at creation (`crypto.randomUUID` at the caller is sufficient).
`updateBookmark` keeps identity and all omitted fields, including label/group/order when re-targeting.
Export `bookmarkTargetKey` for canonical target identity and `findEquivalentBookmark` for the Add flow.
The key includes kind and canonical target, excludes hints, IDs, label, group and ordering, and retains query sort/view and anchor context.
For position duplicates, when both candidates resolve against the same saved body, identical kind/path/resolved range is also equivalent even if context changed since the first capture.
Do not equate two unresolved anchors using approximate text or line numbers.

## Metadata registration and write protection

Register `BOOKMARKS_DOCUMENT` in `WORKSPACE_DOCUMENTS`, with scopes `['bookmarks', 'folders', 'files']` and new `CommitScope` member `bookmarks`.
Add `bookmarks` to `RemoteSource.commitChanges`' document-only scope exclusions so it cannot write arbitrary note paths.
Do not add it to `NotebookConfig`, `WorkspaceConfig.schema_version`, or workspace migration scripts.

Root storage already falls outside ordinary notebook scans, and dotfiles are hidden by [classifier](../../../packages/core/src/classifier.ts) and [folder content rules](../../../packages/core/src/folders.ts).
Make protection explicit at the file-manager boundary: a registered workspace-document path must never be returned by `managedNotebook`, even when notebook aliases could reach it.
Its bytes are loaded as auxiliary metadata for relocation, not exposed as a selectable/editable file.
Reject direct create/write/upload/move/delete targeting that file and directory operations that would encompass a protected document.
Verify note read/save/delete and raw-file endpoints cannot be used to bypass this guard; protect the exact registered path in local MCP note mutation handlers too, whose existing `assertSafeRepoPath` only checks filesystem containment.
Keep explicit Git Changes diff/stage/commit/restore working for metadata; these are intentional version-control actions, not file-manager editing.
Git restore/pull and external Git operations trigger revalidation rather than rename inference.

Add an optional `WorkspaceDocument.validateChange(current, next, notebooks)` hook for stateful bookmark validation.
It checks configured ownership of changed collections, preserves unknown-owner collections unchanged, validates newly changed target definitions and duplicate additions/re-targets, and never requires every retained target to exist.
Call it from both `createWorkspaceDocumentRouter` PUT and `RemoteSource.commitNotes` document handling.
For the bookmark document, decode the existing raw file before any replacement, even if its revision matches: a caller must not overwrite corrupt/unsupported data with an empty page.
Do not use Focus's `own` filtering behavior for bookmarks; dropping references is forbidden.
At the lower remote write boundary, validate the bookmark schema, size, scoped target paths and ownership for relocation writes as well.
Relocation is an explicit trusted planner operation and may preserve converged targets; an ordinary edit cannot use that exception to add duplicates.

## HTTP and persistence contract

### Collection endpoint

Mount `GET/PUT /api/bookmarks` through the existing workspace-document adapter in `apps/local-server/src/app.ts`, before the local/remote branch, matching `/api/focus-page`.
Use explicit `repository` from `repositoryFor(notebookId).id` in every new browser call; never default a notebook action to the home repository.
The adapter may retain its existing home default for backward consistency, but bookmark UI clients must not use it.
Mount `/api/bookmarks/resolve` before the document router and ensure the resolver does not pass through local middleware that mistakes every POST for a write; it must remain usable on read-only branches.

| Request | Response and rules |
| --- | --- |
| `GET /api/bookmarks?repository=<id>` | `200 { page, revision, path: '.mygitnotes-bookmarks.yaml', writable, repository }`; reads the repository's full page once. |
| `PUT /api/bookmarks` with `{ repository, revision, page }` | `200` with the same envelope for the exact saved page and its new revision; local saves leave normal Git changes, remote PUT uses one atomic commit. |
| Remote Changes commit: existing `POST /api/notes/commit` | Include `{ path: BOOKMARKS_FILE, page, base }` in `documents`, the selected repository, its expected commit revision, and existing note changes/message. No second bookmark commit protocol. |

Reject unknown request properties for the new resolver and collection request schema.
Return `400` invalid request/target/scope, `403` read-only or unsafe path, `409` stale revision or duplicate target (include `code` and `existingId` for duplicate), `413` limits, and `422` corrupt/unsupported stored data.
Repository authentication/network/rate-limit failures retain their appropriate `401/403/429/5xx` semantics and retry information; they are never converted into an empty collection.
A duplicate detected before persistence keeps the draft and offers the existing entry rather than automatically removing either entry.

Local revision is `revisionOf(raw)` (`missing` for absence), read from exactly the raw content decoded into the page.
Inside `serializeWorkspaceMutation(root)`: check main branch, read/decode current raw, compare revision, validate change, and atomically replace the regular file.
The new file's revision comes from the exact serialized bytes written, not a later reread.
Use existing regular-file/symlink checks and `writeFileAtomic`; preserve rollback semantics when multiple files change.
Local save success means worktree persistence, not commit/push.

Remote revision is the repository snapshot's commit SHA.
Obtain one fresh snapshot for write preflight; read current document and all needed targets from its immutable blobs; validate expected revision and scope; pass that **same snapshot** into `commitChanges`.
Never read content at A, refresh to B, and return B with A's page or plan.
GitHub uses one tree/commit plus non-force ref update; GitLab uses one actions commit with file-version preconditions and branch recheck.
Do not implement a second provider client or write to the deployment's primary repository by assumption.
The existing GitLab adapter is not a general compare-and-swap on unrelated branch changes after its final branch check; its atomic changed-file version checks protect bookmark overwrites, and tests must distinguish that guarantee from whole-branch serialization.
No silent retries or automatic overwrite on any conflict.

### Target resolution endpoint

Add `apps/local-server/src/bookmarks.ts` for `POST /api/bookmarks/resolve`.
Request: `{ notebookId, targets: Array<{ id, target }> }`, 1–100 targets with unique request IDs; `target` uses the same strict target schema.
The endpoint is read-only despite POST and needs read access, not write permission.
It supports current stored bookmarks and unsaved picker candidates without persisting either.
Response: `{ notebookId, repository, revision, results: Array<{ id, resolution }> }`.
Remote `revision` is the single fresh repository snapshot used for the batch; local `revision` is an empty repository revision, not a bookmark write token.
Every resolved position includes `contentRevision`, defined as SHA-256 of the LF-normalized saved body; it identifies the body used for its range, not permission to skip re-matching the mounted editor.

```typescript
type BookmarkResolution =
  | { state: 'resolved'; target: BookmarkTarget; range?: { from: number; to: number }; contentRevision?: string }
  | { state: 'unresolved'; reason: 'missing-note' | 'missing-folder' | 'missing-compilation' | 'invalid-compilation' | 'missing-position' | 'ambiguous-position' | 'missing-query-folder' }
  | { state: 'unavailable'; retryable: boolean }
  | { state: 'external'; url: string };
```

For unavailable repositories, the request may return the existing repository-level error envelope; the browser maps it to Unavailable/retry for every affected entry without changing persisted data.
Within an available repository, a target is missing only if its complete current tree/local filesystem proves absence.
A blob fetch failure or provider 404 after a tree lists a blob is Unavailable, not deletion.
A directory in remote Git exists if represented by a tree entry or descendant; local empty directories also count.
Compilation resolution verifies the path's compilation kind and parse validity without rewriting it or searching for a matching compilation ID elsewhere.
Saved query folders must still resolve; do not remove a missing folder and accidentally widen the query.
A query with zero matching notes is resolved, not broken.
A URL is external/unverified and is never fetched.

Batch duplicate note reads, limit remote blob-read concurrency to the established six-at-a-time pattern, and apply existing 5 MiB note read limits.
Revalidate visible/expanded collections on load, Git refresh, file mutation and activation; chunk larger collections into bounded batches.
Cancel/ignore stale async responses by repository, notebook, page generation and request identity.
Derived resolution state stays in browser/query memory, never in YAML.

## Exact document anchors

### Capture and matching

Anchor text is an exact slice of the parsed Markdown **body**, not rendered text, heading slug, frontmatter, or a line-number pointer.
Normalize CRLF to LF for matching/capture only and keep a normalized-to-original offset map when revealing against a body that contains CRLF.
Perform no whitespace collapsing, case folding, Unicode normalization, Markdown stripping, or approximate matching.
Store up to 128 code units immediately before and after the selected source range.
`fromHint` is useful for preview labels and checking the selected candidate during capture, never a tie-breaker during resolution.

Expose `captureTextAnchor(body, range, kind)`, `resolveTextAnchor(body, anchor)`, `listBookmarkPositions(body, format)`, and an offset conversion helper.
`resolveTextAnchor` enumerates all exact occurrences, including overlapping ones.
One exact occurrence resolves even if surrounding context changed, so moving a uniquely identifiable paragraph succeeds.
For multiple occurrences, require exact prefix and suffix matches at their immediate boundaries; zero or more than one surviving occurrence is unresolved.
Empty context is allowed at a document edge but provides no distinguishing evidence.
Return `missing-position` for zero exact matches and `ambiguous-position` for multiple non-uniquely-disambiguated matches.
Never fall back to the nearest offset, first heading, first DOM match, or a title/slug lookup.

Heading capture uses the source span of the chosen outline heading, including the ATX marker or setext underline, not its display label.
Move the existing outline parser into a browser-safe core helper if needed and re-export it from `lib/note-navigation.ts` so outline behavior has one owner.
Paragraph capture uses an exact contiguous source range within a prose block; the default picker offers whole blank-line-delimited prose blocks, preserving Markdown/list/quote syntax in the captured slice.
Exclude fenced/indented code, frontmatter, and separator-only blocks from paragraph picker candidates.
An editor selection wholly within one prose block can select a smaller range; reject selections across separate blocks or code with a clear hint and retain the picker alternative.
Markdown/MDX headings and paragraphs and plain-text paragraphs are supported; the candidate picker shows a source excerpt so inline markup is not misrepresented as rendered selection text.
Use existing source parsing/`marked` where helpful, but source spans must be taken from the original body, not found by searching rendered text.
Tests establish blank lines, code fences, setext, inline formatting, CJK, CRLF, lists/quotes, and repeated blocks before UI integration.

### Save-before-capture boundary

1. Snapshot the requested range and source text before opening a menu steals editor selection.
2. If the owner editor or its staged remote note is dirty, show an in-app Save first/Cancel confirmation with the local versus remote effect stated.
3. Flush the specific note via `flushEditors([noteRefKey(note)])` and require success.
   For local workspaces, await the actual worktree save and reread the saved note.
   For remote workspaces, flushing only stages a draft: explicitly commit that selected note using the existing `commitWorkingNotes`/quick-commit path, and await success before reading it again.
   This includes newly created notes; a staged-only new note cannot supply a synchronized position target.
4. Re-resolve the originally requested slice against the saved body using exact text/context; if it no longer uniquely identifies the selected range, keep the dialog open and request a fresh selection.
5. Capture the final anchor from that saved body, then add the bookmark to the document draft/save lifecycle.
   If the note commit succeeds but bookmark save later fails, report the partial outcome honestly; never claim the bookmark was synchronized.

Read-only users may navigate an anchor but cannot run its capture/write flow.
At activation, use the saved target body for initial resolution and resolve again against the actual editor session content before revealing.
A dirty editor must not use offsets computed from a different committed body; flush through the established navigation guard or retain the editor and show the location warning.
Reveal through `MarkdownEditorHandle.revealRange(from, to, true)` after the correct note/editor owner has mounted.
Thread a consumed-once request containing bookmark identity and anchor, not a global DOM query or persistent offset.
This works in raw/live, zoom, and borrowed Focus/graph editor hosts without changing Markdown or adding rendered IDs.
An unresolved position offers Open whole note and Re-target; opening the note must not display a successful-location indicator.

## Saved query and URL canonicalization

`canonicalizeBookmarkQuery` is a pure strict validator/canonicalizer in core.
It accepts the explicit saved fields above, fills defined defaults at capture, sorts/deduplicates set-valued tags/folders deterministically, and preserves query text, status case and tag case as the existing filters do.
Sort/view participate in identity; array order for tags/folders does not.
Do not silently trim or rewrite query text in ways that alter the current search behavior.

`captureBookmarkQuery(filters, sort, notebook)` in web translates `tag` to `tags` and repository-root folder filters into notebook-relative folders.
Reject `allNotebooks: true`, a foreign folder, or an effective notebook scope of `all` with a visible hint to choose one notebook first.
Do not quietly convert a global search into a partial notebook query.
The persisted schema has no notebook selector, `allNotebooks`, origin, route URL, pagination, Focus, pane sizes, dialogs, or cached results.
Any supplied unknown field is rejected by core/API validation.

`bookmarkQueryRoute(notebook, query)` builds a clean route from `notebookRoute` and `writeFilterQuery` rather than merging current location parameters.
Restore every saved filter, view and explicit sort order, resetting transient pagination/focus/returnTo state.
For `view: graph`, use the existing `/graph?notebook=...` navigation semantics without losing the saved filters; do not rely on an intermediate legacy redirect to retain state.
Add explicit sort-field/order parameters to the web route codec and teach `useNoteSort` to prefer a valid route sort over its local-storage default, so activation/reload/back navigation preserve saved sort.
Existing URLs without sort keep current behavior.
When graph neighbors are enabled, restrict the graph's nodes/links to the owning notebook before neighbor expansion; the current `selectFilteredGraph` can otherwise include cross-notebook neighbors.
Run the current note query against current content; never persist result IDs or a query revision.

`canonicalizeBookmarkUrl` uses `new URL` with no base, accepts only `http:`/`https:`, requires a hostname, and rejects credentials, backslashes and control characters before parsing.
Use its serialized absolute URL as identity (standard host/default-port normalization); preserve query order and fragments rather than guessing website equivalence.
No preview, favicon, DNS lookup or health request.
Activate through a real `<a target='_blank' rel='noopener noreferrer'>` from the user's click, avoiding popup blockers and opener access.

## Relocation and deletion coverage

Change the registry relocation seam to receive `Pick<NotebookConfig, 'id' | 'root'>` instead of only notebook ID.
Adapt Focus/Study callbacks with the same existing behavior and pass the notebook object from both planners.
Bookmarks can then translate relative paths to repository paths, apply the planner's exact path mapping, validate ownership, and translate back.
Do not store a redundant notebook root in bookmark YAML just to support relocation.
Export `relocateBookmarkPaths(page, notebook, move)` and a small `bookmarkRelocationChange(reader, snapshot, notebook, move)` adapter for the shell path.
Only same-owner note/folder/compilation/position paths and query folder filters change; anchors, IDs, labels and order remain identical.
Prefix mappings must use full path-segment boundaries (`one` never matches `one-more`).

| Entrypoint | Existing path | Required treatment |
| --- | --- | --- |
| Note/compilation move action, rename and file manager move | `useFileNavigation.moveNoteAction` → files dialog / `components/files/useFileManager.ts` → `POST /api/files`, command `move` → `planFileChange` | Registered bookmark auxiliary file participates in the same plan/apply or commit. Rename is this same operation, not note metadata title editing. |
| Bulk note move | `app/useBulkNoteActions.ts`, `runBulkMove` → sequential `mutateFile(kind: 'move')` calls with each returned revision | Each individual note plus affected metadata moves atomically. Preserve the existing partial-batch reporting and refresh all successful path maps after a later failure; do not claim the entire bulk loop is one transaction. |
| Folder drag/nest/reorder | `FolderTree` → `POST /api/folder-manager`, command `move` → `planFolderChange` | Map folder target itself, descendants and all saved folder filters. Pure same-path reorder must not manufacture bookmark edits. |
| Folder removal while keeping content | Folder action `delete` in folder planner, or `remove-directory` in file planner | This is relocation into an existing destination, not content deletion; map the source folder target/filter to the destination and move descendant references atomically. |
| File-manager recursive deletion | `POST /api/files`, `delete-directory` | Retain all bookmarks verbatim; refreshed resolution marks missing targets/filters. No metadata pruning. |
| File-manager note/compilation deletion | `POST /api/files`, `delete` | Retain references, refresh resolution after the existing successful operation. |
| Direct local note deletion and undo | `DELETE /api/notes`, `POST /api/notes/restore` in `local-notes.ts`; `useDeletionUndo.ts` | Retain bookmarks on deletion and let restore re-resolve them. No bookmark rewrite or inferred rename. |
| Remote UI deletion | `useDeletionUndo.handleRemoteDeleteNote` → `mutateFile({ kind: 'delete', ... })` → `POST /api/files` | Keep metadata untouched; revalidate after the commit. There is no remote `DELETE /api/notes` endpoint in the current app. |
| Hosted MCP move/rename, including directory `mv` | `callWorkspaceRemoteTool` → `callRemoteTool` → `callNoteShell(..., 'mv', ...)` | Compute mapping from the already resolved final destination (including directory-destination basename rule); add bookmark document change to the same SHA-based commit, with the same original snapshot/revision. Preserve shell's current relative-link semantics. |
| Hosted MCP deletion | `callNoteShell` `rm`, and `callRemoteTool` `delete_note` | Keep metadata unchanged and resolve on next load; protect metadata from direct access. |
| Local MCP deletion | `handleDeleteNote` in `packages/mcp-server/src/tools/notes.ts` | Keep references; guard registered metadata paths. Local MCP currently exposes no `mv`/`cp` handler, so do not invent one. |
| Copy/create/body edit/metadata title edit | File `create/upload/write`, shell `cp/write/append/edit`, note save, compilation save, tag/status updates | No path relocation or bookmark duplication. Revalidate anchors after body edits and compilations after validity changes. |
| Git restore/pull, user filesystem edits, manifest-root edits | Git routes and worktree watcher | Revalidate on load/activation; do not guess path correspondences or rewrite bookmark data. |

`app.ts`'s method/operation loop handles asset operations, not note deletion; test the actual remote file-manager path used by `useDeletionUndo`.
Asset/R2 and Agent skill moves are not bookmark target types; their file writes may still alter note bodies, so anchor resolution refreshes, but no new bookmark type or relocation mapping is needed.

The current MCP shell permits transfers between notebooks in one repository, unlike the UI file planners.
Do not extend a bookmark across its owner boundary or silently migrate it to another notebook.
For such a transfer, the owning notebook observes removal: retain its original reference unresolved, while same-notebook moves follow their destination.
Destination notebook bookmarks and all other repositories remain untouched.
This is the deletion/same-notebook rule applied to the existing broader shell operation, not permission to invent cross-notebook targets.
An explicit re-target may only choose another target within the original owner.

### Atomicity and stale protection checklist

- Include present bookmark metadata in folder/file snapshots and in their revision computation; the registry already drives auxiliary file loading.
- Do not load an absent bookmark file as an empty placeholder that then appears in the output as a new file during a move.
- File snapshots must load actual auxiliary bytes on movement paths, not the zero-byte collision placeholders used for untouched files.
- Decode/validate a present bookmark document before planning reference-affecting moves; corrupt/unknown versions fail before any source mutation.
- The local snapshot, revision comparison, planner, apply and rollback stay inside one `serializeWorkspaceMutation(root)` action; do not nest that queue recursively.
- The remote folder/file snapshot loaders should return their captured snapshot revision explicitly, rather than deriving it from a later potentially refreshed reader state.
  Pass that revision and known snapshot through the final commit where applicable.
- Existing file count (200), text snapshot (32 MiB) and commit bytes (5 MiB) limits include bookmark changes; oversize fails without a partial relocation.
- A concurrent bookmark PUT changes the local metadata hash/stamp and invalidates a previously reviewed move revision.
  A move changes the bookmark document and invalidates the old bookmark PUT revision.
  Remote writes fail expected-head/content-base checks instead of reapplying a stale page to the new head.
- Direct local note writes/deletes/restores and Git restore of this metadata should use the same worktree queue when they can interleave with a bookmark resolution/save or planner transaction.
  Keep synchronous multi-file apply/rollback unchanged; this queue is process-local and is not an OS lock against arbitrary external editors.
  Tests must not claim inter-process filesystem isolation beyond the existing application boundary.
- Returning a new note revision after a move is not permission to attach it to a pre-move bookmark page; refresh the document snapshot or show a conflict.

## Browser state, UX, and navigation

### Document lifecycle

Add a bookmark document client in `apps/web/src/lib/use-bookmarks.ts` and register it in `workspace-document-clients.ts`.
Local edits follow the existing document recovery-draft/autosave-to-worktree behavior.
Remote edits remain visibly pending in Changes and commit through `useWorkingNoteCommit`; the sidebar must distinguish Pending from Saved rather than claiming immediate Git synchronization.
Retain failed drafts and their original `base/revision`; show Reload/review and explicit Discard, never silently replace them on conflict.

Reuse `useWorkspaceDocument`, but fix/cover its relevant lifecycle holes while integrating bookmarks:

- A late response for a previous repository must not populate a new notebook's collection or reenable write controls.
- Snapshot page/revision/base must remain paired; unrelated repository-head refresh cannot rebase an old page automatically.
- When an in-flight save finishes and another tab changed the stored draft, only carry later edits forward if they descend from the sent draft/base.
  Otherwise preserve the newer draft with its original base and report conflict; do not stamp it with the successful request's newer revision.
- A remote successful commit must preserve later edits or report a conflict rather than overwriting a different tab's state in `settleDocumentDraft`.
- Reset or hide stale `writable` state when the repository becomes unavailable or changes, and stop autosave after load/conflict errors.
- Failed note save/commit cancels position creation and keeps the selected candidate/dirty editor intact.

The existing active-document list is scoped to the selected notebook's repository.
Keep that architecture: the selected repository has one live editable bookmark controller, shared by its notebook collections.
For other notebooks visible in the all-notebooks sidebar, use cached read-only document queries keyed by repository and render their sections from that snapshot.
A mutation action on another notebook first performs guarded notebook selection, waits for that repository's live controller, then opens its editor dialog with the original target/ID.
No mutation may act on a merely read-only cache entry or overwrite a document loaded by a different controller.
Remote pending draft overlays for inactive repositories come from the existing keyed document draft store and remain visible as Pending; unknown/corrupt drafts show an error rather than falling back to server data.
Refresh/invalidate both live and cached document views on save, commit, file changes, Git refresh and storage events.
Add bookmarks to `useWorkspaceSync.documents`, `refreshDocuments`, Changes enumeration and pre-file-change draft guards.
The guards must inspect pending bookmark drafts across all writable repository keys, not just the selected repository's mounted controller; an inactive notebook draft must not be silently overtaken by a move.

### Components and entrypoints

Create `components/BookmarksSection.tsx` and `components/BookmarkDialog.tsx`; keep orchestration in `app/useBookmarkActions.ts` and pure route/query conversion in `lib/bookmark-navigation.ts`.
Do not put the full feature in `App.tsx` or `Sidebar.tsx`; those wire existing application callbacks and state only.
Use existing Radix dropdowns, native/dialog wrappers, `NavTree` styles, theme tokens and translation keys.

| Surface | Integration |
| --- | --- |
| Sidebar | In `Sidebar.tsx`, each notebook's Bookmarks section appears immediately before its `FolderTree`, including the selected notebook's empty-folder state. Show ungrouped entries, ordered single-level groups, collapse toggles, status badges and Add bookmark. Collapsed state is local presentation, scoped by repository/notebook; labels/order/group membership are shared. |
| Note actions | Add Bookmark note and Bookmark position to `NoteEditorToolbar`/the existing note action surface, passed through `NoteEditingProvider` shared props so zoom and embedded owners behave identically. Do not hide bookmark navigation for read-only notes; creation follows notebook write permission. |
| Outline and selection | `NoteDocumentPanel` adds an action beside each heading; `MarkdownEditorHandle`/`LiveMarkdownHandle` expose current source selection without changing text. Provide a toolbar/menu action usable by keyboard and touch, plus the position picker as the non-selection alternative. |
| Folder dropdown | Extend `FolderActions` with a separate bookmark callback rather than mapping it into `FolderAction` filesystem operations. Thread it through `FolderTree`. Bookmark activation never invokes `onManageFiles`. |
| Compilation | Add through `CompilationHeader.extra` / `lib/compilation-actions.tsx`, plus picker; target is the compilation path, not a lane ID or a copy of its items. |
| Save current view | Add a translated action to `NoteToolbar`; capture the complete effective Notes query and supported sort, not the debounced previous query. Reject global/foreign scope visibly. |
| Add picker | Offer all six target kinds in one dialog; note/compilation candidates use existing paged query/lookup, folders use the notebook tree, positions first select a note then its saved source position, URL uses validated form, saved view uses the current scoped query. Show notebook ownership explicitly. |
| Repair/edit | The same dialog edits label, group and target independently. Re-target preserves ID/order/custom label. Existing-equivalent detection offers Edit existing rather than replacing it. |

Provide Move up/Move down controls for both groups and entries, plus a group selector (including Ungrouped).
Implement drag reordering for groups and bookmarks as approved, delegating to the same domain operations.
Move up/down and the group selector are the complete accessible/touch alternatives; drag must not be the only way to organize bookmarks.
Use proper button names, visible focus, Escape/cancel, dialog focus return and menu-to-dialog focus sequencing, as `FolderActions` already does.
Removal confirms which bookmark/group is being removed and explains group ungrouping; never call a note delete endpoint from this action.
Include English and Traditional Chinese labels in `lib/i18n/en.ts` and `zh-TW.ts`.

### Activation dispatch

`activateBookmark(owner, bookmark)` is the single dispatcher, with repository-aware resolution and stale-request cancellation.
For internal targets, run the existing editor/file/Agent leave guard as appropriate; a failed save cancels navigation.
External URL activation does not unmount the editor and needs no save/leave flow.

- Note: existing note-open callback/route with the owner notebook; respect Focus/zoom and current return context.
- Compilation: existing compilation-open path through note routing/compilation actions.
- Folder: clean owner Notes route with exactly that folder, `kind: note`, `allNotebooks: false`, and clear unrelated search/tag/status filters; use descendants true and current supported view/sort.
- Position: open the note with a pending typed anchor request; resolve against the mounted editor body and reveal the unique range.
- Query: apply the validated full filter/sort/view state in one guarded transition; invalidate/query current content through existing query hooks.
- Unresolved: retain the sidebar entry, show the specific problem and Repair/remove; for a position whose note exists also show Open whole note.
- Unavailable: show Retry and preserve the target without offering a false deletion diagnosis.

## Single-writer implementation tasks

All tasks run sequentially in the upstream checkout; there are no parallel writing branches or downstream edits in this design.
The parent owns any commits/integration; dependencies below mean the preceding working-tree step must be verified before the next starts.
Do not leave stubs or defer a target type to a later release.
No persistent process is needed for implementation planning.
During implementation verification, start any persistent server only with `MonitorCreate`, record PID/port, stop it with `MonitorStop`, and verify its PID/port are gone; close only the browser session created for this work.

### 1. Implement the domain document and pure invariants

- **Files/area:** new `packages/core/src/bookmarks.ts`, `bookmark-query.ts`, `bookmark-anchor.ts`; exports in `packages/core/src/index.ts` and `packages/core/package.json`; focused tests alongside core tests.
- **Behavior:** All target schemas, limits, immutable operations, canonical identity/query/URL validation, exact capture/matching and position candidate spans.
- **Constraints:** Browser-safe modules; no product URLs, Markdown mutation, fuzzy match, or dependency addition.
- **Acceptance:** Unit tests cover every target, group removal/order, duplicates, invalid paths/URLs, canonical queries and ambiguous/moved/deleted anchors, including CRLF offset conversion.
- **Depends on:** none.
- **Workspace:** sequential.

### 2. Register metadata and implement safe collection/resolution APIs

- **Files/area:** `workspace-documents.ts`, `remote-source.ts`, `apps/local-server/src/workspace-document.ts`, new `apps/local-server/src/bookmarks.ts`, `app.ts`, `workspace-files.ts`, protection in core file manager and local MCP note mutations.
- **Behavior:** Optional empty read, scoped GET/PUT, strict existing-file decode before overwrite, change validator, bounded snapshot-based resolution, repository-aware ownership and write permission.
- **Constraints:** Fixed optional root document; explicit snapshot/revision pair; preserve unknown-owner collections unchanged; no metadata fetch for external URLs.
- **Acceptance:** Local and both remote adapter tests for empty/round-trip, malformed/unsupported/oversize, read-only, unsafe paths, duplicate conflict, two writers, same-root notebooks in different repositories, and unavailable versus proven missing.
- **Depends on:** task 1.
- **Workspace:** sequential.

### 3. Integrate all relocation and protection surfaces

- **Files/area:** `folder-plan.ts`, `file-manager.ts`, `focus-page.ts`, `study.ts`, `workspace-documents.ts`, local-server folder/file snapshot adapters, `note-shell.ts`, relevant local note/Git queue boundaries.
- **Behavior:** Notebook-relative bookmark refs and saved folder filters follow same-notebook moves in the same operation; all deletion paths retain refs; MCP moves include metadata in the same atomic commit.
- **Constraints:** Preserve existing note-link/Focus/Study semantics; never create absent metadata during move; fail corrupt metadata before mutation; no new cross-notebook reference.
- **Acceptance:** Full entrypoint matrix, directory removal/rename, nested paths, convergence, local rollback fault injection, remote tree/actions content, and concurrent move-versus-bookmark-write tests.
- **Depends on:** task 2.
- **Workspace:** sequential.

### 4. Integrate document drafts and saved-query navigation

- **Files/area:** new `lib/use-bookmarks.ts`, `lib/bookmark-navigation.ts`; `use-workspace-document.ts`, `workspace-document-clients.ts`, `use-workspace-sync.ts`, `useWorkingNoteCommit.ts`, `useChangeDialog.ts`, `useFileNavigation.ts`, route/filter/sort helpers and graph scope.
- **Behavior:** One editable controller per selected repository, inactive cached views, pending Changes integration, conflict-preserving snapshots, sort-aware saved routes and notebook-scoped queries.
- **Constraints:** No optimistic revision rebasing of another tab's draft; bookmark draft must not evade move guards; no global query leakage.
- **Acceptance:** Hook tests with deferred responses, repository switching, in-flight save/other-tab edit, commit settlement, failed writes, and route/query round trips including graph neighbors and sort after reload/back.
- **Depends on:** tasks 2–3.
- **Workspace:** sequential.

### 5. Implement sidebar organization and all creation/repair entrypoints

- **Files/area:** new `BookmarksSection.tsx`, `BookmarkDialog.tsx`, `app/useBookmarkActions.ts`; `Sidebar.tsx`, `FolderTree.tsx`, `FolderActions.tsx`, `NoteToolbar.tsx`, note/compilation action wiring, `App.tsx`, both i18n files and bounded styles.
- **Behavior:** All six target kinds, custom labels, groups, ordering, duplicates, remove/repair, per-notebook section before folders and a useful empty action.
- **Constraints:** Existing dialogs/menus/theme, keyboard/touch alternatives, true read-only restrictions, no file deletion from bookmark operations.
- **Acceptance:** Component tests enumerate all picker types and actions, grouping/ungrouping/order persistence, duplicate Edit existing, disabled writes, focus return, error/Pending/Saved states and multiple notebook sections.
- **Depends on:** task 4.
- **Workspace:** sequential.

### 6. Complete exact position creation and navigation across editor hosts

- **Files/area:** `MarkdownEditor.tsx`, `LiveMarkdownEditor.tsx`, `NoteEditor.tsx`, `note-editor/types.ts`, `NoteDocumentPanel.tsx`, editor toolbar/document-panel session wiring, `note-editing.tsx`, note/Focus navigation and bookmark actions.
- **Behavior:** Capture from saved source after explicit local-save or remote-commit success, selection/outline/picker actions, mounted-editor exact re-resolution and range reveal, unresolved Open whole note/Re-target.
- **Constraints:** No slug fallback or DOM text heuristic; do not treat remote staged notes as saved; no bypass of dirty/focus guards or duplicate editor ownership.
- **Acceptance:** Tests for failed save/commit/cancel, selected text changing during save, dirty destination, note/repository races, live/raw reveal, repeated text ambiguity and zoom/Focus host reuse.
- **Depends on:** tasks 4–5.
- **Workspace:** sequential.

### 7. Run integrated verification, document usage and hand off

- **Files/area:** core/web/server/MCP tests below; `README.md`, `README.zh-TW.md`, `docs/CONTEXT.md` for concise bookmark usage/terminology during implementation; `verification.md` in this spec folder belongs to the implementing/verifying run.
- **Behavior:** Exercise the full approved reality anchor, review diff and data preservation, record local tests/build/browser/review separately.
- **Constraints:** Disposable multi-repository workspace only; do not mutate user notes; parent owns review, upstream commit/push and only then downstream sync.
- **Acceptance:** Commands and browser matrix below pass, every spec requirement has evidence or an explicit unresolved verification gap; no broad formatting churn, new packages, processes or temporary workspace left behind.
- **Depends on:** tasks 1–6.
- **Workspace:** sequential.

## Verification map

The commands below are the worker's plan, not evidence of execution in this design session.
Run targeted tests after package build when browser/server tests import core's `dist`, then run the complete suite/build/lint with the repository's scripts.
Use active LSP diagnostics for changed TypeScript files; an empty session cache is not a pass.

```bash
pnpm --filter './packages/*' run build
pnpm exec vitest run packages/core/tests/bookmarks.test.ts packages/core/tests/bookmark-anchor.test.ts packages/core/tests/bookmark-query.test.ts
pnpm exec vitest run apps/local-server/tests/bookmarks.test.ts apps/local-server/tests/bookmarks-remote.test.ts apps/local-server/tests/bookmark-relocation.test.ts
pnpm exec vitest run apps/web/src/lib/bookmark-navigation.test.ts apps/web/src/lib/use-bookmarks.test.tsx apps/web/src/components/BookmarksSection.test.tsx apps/web/src/components/BookmarkDialog.test.tsx
pnpm test
pnpm build
pnpm lint
pnpm format:check
```

New test filenames are planned, not existing files.
Extend the actual precedents: `packages/core/src/folder-plan.test.ts`, `packages/core/tests/file-manager.test.ts`, `compilation-moves.test.ts`, `workspace-documents.test.ts`, `commit-notes-concurrency.test.ts`, `sources.test.ts`, `note-shell.test.ts`, `gitlab-source.test.ts`, `apps/local-server/tests/focus-page.test.ts`, `folder-manager.test.ts`, `file-manager.test.ts`, `file-manager-remote.test.ts`, `notebook-repositories*.test.ts`, and `packages/mcp-server/tests`.
Reuse `packages/core/tests/fixtures/github.ts` and `gitlab.ts` for deterministic provider transactions and race barriers.
Add editor tests adjacent to `NoteEditor.*.test.tsx` and `useWorkingNoteCommit.test.tsx`; run existing Focus/Study and note navigation tests after changing shared seams.

| Approved requirement | Required observation |
| --- | --- |
| All targets, groups, labels, order; optional legacy state | Domain round-trip and local/GitHub/GitLab API fixtures; absent metadata remains absent after GET and unrelated moves. |
| Read-only/stale/corrupt/unsupported | HTTP responses and unchanged bytes/tree; corrupt current data cannot be replaced even with a matching revision; future versions never become empty. |
| Snapshot/revision integrity | Controlled request barriers: read A, concurrent B, attempted write from A fails; no new revision attached to old page; provider head changes between preflight/publish fail without bookmark overwrite. |
| Multi-repository isolation | Same note/root/bookmark filename in two repositories; mutation changes exactly the notebook's mapped worktree or provider project, never home/deployment origin. |
| Atomic relocation through all entrypoints | Table above exercised for local, GitHub, GitLab and MCP; saved folder queries move too; fault after first local write restores notes and metadata; stale concurrent writers cannot drop refs. |
| Deletion retains references | Direct note delete, file delete, recursive delete and MCP delete leave metadata unchanged; restore resolves again; group/bookmark deletion leaves all content byte-identical. |
| Deterministic positions | Unique exact, duplicates with unique context, duplicates with identical context, moved paragraph, shifted lines/frontmatter, edited/deleted text, CJK and CRLF; no wrong range is revealed. |
| Saved-query current results and scope | Create another matching note after saving, activate and see it; verify full filters/view/sort; global and foreign folders rejected; graph neighbor expansion remains in owner. |
| URL/path safety | Reject `javascript:`, `data:`, protocol-relative URLs, credentials, control chars, traversal/symlinks and protected metadata; assert zero URL-preview/provider write calls on rejection. |
| Dirty lifecycle | Local note persisted before capture; remote note explicitly committed before capture; failed/canceled save does not add bookmark; stale document drafts remain visible and recoverable. |
| UI and accessibility | Real isolated desktop/mobile browser plus component tests: all entrypoints, keyboard Add/Edit/Escape, move up/down, group selector, label isolation, duplicate offer, unresolved repair, unavailable retry and read-only navigation. |

For real browser verification create a disposable `main` workspace with two mapped repositories, duplicate paths, headings/paragraph fixtures and one compilation.
Use the existing server configuration mechanism without touching real workspace mappings.
Record browser session, server PID/port and screenshots/results for desktop and a narrow touch viewport.
Drive actual UI: add each type, save/commit via normal lifecycle, reload, activate, reorder/group/ungroup, mutate target paths, remove/restore target, repair anchor and exercise dirty cancellation.
Use a second tab/session to provoke a stale document/move conflict.
Network/provider fault tests remain distinct from real browser evidence; do not claim live GitHub/GitLab deployment verification from adapter fixtures.
Stop every monitor and close the owned browser session, then verify no owned listener/process remains.

## Implementation record

The source implementation and executed evidence are recorded in [verification.md](verification.md); earlier planning-only status paragraphs describe the design session, not the delivered source state.

- Added an optional async `WorkspaceDocument.validateReferences(current, next, notebooks, readBody)` beside the planned synchronous change validator. Local reads execute inside the existing mutation queue; remote reads use the same captured snapshot. It rejects newly equivalent position anchors that resolve to the same exact saved range even when their stored context differs. Unchanged targets and trusted relocation retain existing identities.
- Local MCP note-resource protection canonicalizes safe absolute/relative paths and internal symlink aliases before checking the workspace-document registry, including a not-yet-created metadata file below a linked directory.
- Extracted small context/action/position hooks rather than a large App implementation. The App provider wraps an already built content element to avoid unrelated JSX indentation churn.
- Native details retain collapsible lists; compact icon/name/ellipsis rows use the existing Radix folder-menu and native-dialog focus conventions. Accessible ordering stays in the menu and grouping uses a select dialog. This separately verified follow-up addresses the parent's initial density concern.
- Review regressions established three additional boundaries: UI path ownership receives only notebooks from the owner's repository (identical roots in different repositories are not competing owners); local HTTP note/asset lookup rejects symlink resources/ancestors using the existing managed-file policy; raw textarea selection/reveal converts between LF control offsets and original CRLF body offsets. See verification for red/green and real-browser evidence.
- The isolated fixture uses the actual current schema constant and two mapped disposable repositories; it has a browser-neutral smoke mode and cleanup handlers. No dependency was added.

## Implementation friction notes

- Tried: LSP diagnostics immediately after adding core subpath exports and building core.
  Found: the active server retained old package/declaration resolution while fresh core, server and web compilers accepted the new exports; subsequent file checks were retriggered and stale findings identified explicitly.
  Led by: proactive LSP diagnostics rule.
  Classification: tool-cache gap; fresh compiler and runtime tests remain independent evidence.
- Tried: draft race hook tests with a newly allocated mock translation function on each render.
  Found: changing `t` restarted the load effect indefinitely; production's stable translator is part of the hook dependency contract.
  Led by: none.
  Classification: test-fixture gap; the mock now retains a stable translator and all 14 draft/query/commit tests pass.

## Risks and open questions

- No unresolved user-owned decision blocks implementation; storage filename, bounds, helper shapes and ordering mechanics above are engineering choices inside the approved contract.
- The largest correctness risks are remote draft versus committed-note confusion, snapshot/revision mismatches, MCP movement bypassing planners, and query/anchor offsets leaking across notebook/editor switches.
- Repository-root storage intentionally serializes concurrent bookmark edits across notebooks in the same repository; visible conflicts are preferable to another bespoke merge protocol.
- Metadata derived from existing unknown notebook owners must survive untouched; validation must not borrow the lossy Focus ownership filter.
- Exact anchors intentionally become unresolved after text edits or unresolved ambiguity; that is successful adherence to the contract, not a reason to add fuzzy recovery.
- External filesystem/Git operations are outside the in-process local transaction queue; reload/revalidation is promised, cross-process ACID is not.
- Browser-safe exports and current package-build prerequisites must be respected; do not pull server filesystem modules into the web bundle.
- Review should specifically examine the changed shared document hook, low-level commit validation, relocation tests and permission isolation before the parent delivers upstream.

## Design verification and friction notes

Read `decision.md` and `spec.md` completely and mapped every approved behavior to domain/API/UI operations, movement entrypoints and a concrete verification surface.
Read current repository context and root clean-architecture, TypeScript, UI, Markdown and Git rules; no app-root AGENTS/GEMINI/CLAUDE file or project skill/rules tree was present in this checkout.
The only artifact written by this planning task is this design.
Production implementation, tests, build, browser verification and review remain unexecuted.
Artifact checks found seven ordered tasks, 30 valid relative evidence links, no trailing whitespace and one final newline.
`git check-ignore -v` confirms `.gitignore:40` ignores `docs/specs/`, including the supplied approved artifacts and this design.
The files exist on disk, but normal `git status`/`git diff` will not list them; the parent must deliberately include the exact durable artifact paths if its delivery should track them, without deleting the supplied files or broadening this task into a `.gitignore` change.

- Tried: reading `packages/core/src/package.json` for browser exports.
  Found: the package manifest is `packages/core/package.json`; source files are below `src`.
  Led by: none.
  Classification: discovery gap; corrected the evidence path, no new project rule required.
- Tried: a symbol-reference request for `deleteNoteFile` at an incorrect source line.
  Found: the declaration is at `note-service.ts:121`; the empty reference answer was not evidence that there were no callers.
  Led by: LSP navigation guidance.
  Classification: discovery gap; verified HTTP/MCP callers by reading their source, no implementation conclusion relies on that empty result.
