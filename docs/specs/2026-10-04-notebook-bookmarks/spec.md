Status: approved
Approved at: 2026-10-04
Approved from: User selected「定案，接著實作」after reviewing the full behavior and acceptance proposal.

# Notebook bookmarks

## Purpose

Provide a notebook's shared, ordered shortcuts without duplicating its notes or replacing compilations.
Implementation is authorized by the approval above; this artifact itself is not an implementation or release claim.
Confirmed decisions are recorded in [decision.md](decision.md).

## Observable behavior

### Sidebar and organization

Each notebook has a collapsible Bookmarks section before its folder tree.
Show ungrouped bookmarks and single-level named groups; do not introduce nested bookmark folders.
Users can add, rename, re-target, reorder, move between groups, and remove bookmarks.
Support drag reordering, with accessible move-up/down and group-selection alternatives that also work on touch devices.
Removing a bookmark never deletes a note, folder, compilation, website, or document text.
Removing a group moves its bookmarks to the ungrouped list while preserving their relative order.
Changing an explicit bookmark label never renames its target.
A blank collection presents a clear Add bookmark action rather than a permanently empty tree.

### Targets and creation

| Target | Creation entry | Activation |
| --- | --- | --- |
| Note | Note actions or the Add bookmark picker | Open the note using existing note navigation. |
| Folder | Folder dropdown or picker | Open Notes filtered to that folder, not the file-manager dialog. |
| Compilation | Compilation actions or picker | Open that compilation. |
| Heading or paragraph | Note outline/selection actions or position picker | Open the note and reveal the uniquely resolved text location. |
| External website | Add bookmark URL form | Open an HTTP(S) URL in a new tab without granting opener access. |
| Search/view | Save current view in the notebook's Notes view | Restore validated query, filters, display mode, and supported sort; execute against current content. |

Every internal target belongs to the owning notebook.
Saved searches cannot enable allNotebooks or reference another notebook's folders.
Saved views store a query, not a frozen list of results, transient panel geometry, open dialogs, pagination, or the current deployment origin.
Adding an already-bookmarked equivalent target offers the existing entry for editing rather than silently duplicating it.
Different heading/paragraph locations or different query definitions are distinct targets.

### Document positions

Creating a position bookmark never injects IDs, comments, frontmatter, or other markers into Markdown.
Store the selected heading/paragraph text and bounded surrounding context in bookmark data.
Use a deterministic match: accept a unique exact target match or a uniquely disambiguated exact target/context match.
Line numbers and offsets may be hints but cannot alone establish that a changed document location is correct.
Do not use approximate similarity to silently jump to another paragraph.
When the text is removed, rewritten, or remains ambiguous, retain the bookmark and explain that the location cannot be resolved.
If the note exists, offer Open whole note and Re-target actions rather than claiming the position was found.
Moving a uniquely identifiable paragraph within a document should not depend on its old line number.

### Persistence, permissions, and compatibility

Persist the collection as optional, versioned data owned by the notebook's repository; synchronize via existing Git workflows.
A notebook without bookmark data remains valid and starts with an empty collection; reading it does not create files.
Bookmark changes require that notebook's existing write permission and the expected revision.
Read-only users can navigate bookmarks but cannot change the shared collection.
Use the existing local and GitHub/GitLab write boundaries; local changes remain available to the normal Git workflow and remote writes use its atomic commit mechanism.
Concurrent edits must fail visibly instead of silently overwriting another user's changes.
Reject malformed/unsupported bookmark data visibly without replacing it with an empty file.
Internal targets are notebook-relative typed references, not environment-specific URLs or absolute filesystem paths.
External targets allow HTTP(S) only, reject embedded credentials and unsafe schemes, and are not automatically fetched for previews or health checks.
Do not assume external websites are reachable or mark them broken merely because no check has run.

### Changes and unresolved targets

GitNotes-managed moves/renames update affected bookmark paths and saved folder filters in the same operation as the target mutation.
Cover all existing mutation entry points, including note moves, folder operations, and file-manager operations; no one-off fix limited to the new UI.
Removing a target retains its bookmark as unresolved; removing a bookmark never removes the target.
Out-of-band edits are revalidated on load/activation, not silently guessed as renames.
A network error or unavailable repository shows Unavailable/retry, not a persisted claim of deletion.
Re-targeting preserves bookmark identity, custom label, group, and order unless explicitly edited.
Unsaved note contents cannot create a supposedly synchronized position bookmark that points only to an unsaved local draft: save successfully first or cancel creation with an explanation.

## Non-goals

- Personal accounts or a second private favorites collection.
- Cross-notebook internal targets or global searches.
- Nested bookmark groups, browser-bookmark import/export, automatic website metadata fetching, or URL availability crawling.
- Stable markers inserted into Markdown or fuzzy paragraph matching.
- Frozen search results, copied note content collections, or replacement of compilations.
- Public deployment beyond the established upstream push and downstream synchronization lifecycle.

## Applied standards

Reuse existing menu/dialog primitives, navigation, i18n, focus/dirty-editor guards, and theme tokens.
Provide English and Traditional Chinese labels, keyboard controls, and mobile-usable targets.
Preserve backend path protection, notebook boundaries, optimistic revision checks, and atomic writes/rollback.
Keep snapshot contents and expected revision paired; never attach a newer revision to old bookmark data.
Respect upstream-first delivery when implementation is separately authorized.

## Reality anchor and acceptance checkpoint

Implementation will use testing plus isolated browser verification before review and upstream push.
No verification below is claimed as already executed for this planned feature.

1. Round-trip all target types, groups, labels, ordering and empty/legacy notebooks through local and remote adapters.
2. Test create/edit/re-target/remove, read-only rejection, stale revisions, corrupt data, and concurrent moves/bookmark edits.
3. Verify target relocation across every relevant note/folder/file mutation; unrelated notebooks remain untouched.
4. Verify missing targets persist and removing groups/bookmarks never removes content.
5. Verify headings/paragraphs with duplicate text, shifted lines, moved blocks, edits, deletion and ambiguous context never silently misnavigate.
6. Verify saved queries return new matching content after activation and cannot escape notebook scope.
7. Reject unsafe URLs and paths without requests or mutations.
8. Exercise real desktop/mobile UI on a disposable workspace: add each type, reorder/group, activate, repair, cancel and navigate with dirty editors.
9. Obtain code review with special attention to snapshot/revision integrity and cross-repository boundaries.
