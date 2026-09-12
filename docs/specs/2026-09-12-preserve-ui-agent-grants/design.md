# Design

Access entry follow-up: remove AuthControls' onManage prop and header button,
and retain AgentAccessSettings in the Settings caller. Git remote inspection
explains Core update availability; this follow-up changes no update behavior.

Reuse App's established component tree; remove the remote rendering fork.
Add capability props with local-compatible defaults. Remote saves include note
revision; editor drafts remain source-scoped and explicit save errors retain text.
Settings reuses palettes and manifest display; local-only operations are identified.
Auth controls and grant management use the existing theme styles.

SessionStore adds persistent encrypted records and an owner-indexed grant list.
New grants reference persistent account credentials instead of browser sessions.
A subsequent GitHub login refreshes the account credential without replacing agent
grants. Upstream expiration/revocation can require reauthorization. Existing
session-bound grants remain compatible until their original expiration.

Redis owner sets contain record digests, not bearer tokens. List/revoke routes
check owner identity. Local storage enumerates encrypted records using the same
owner filter. OAuth state keeps its ten-minute expiry. Grant revocation removes
both the record and its owner index entry.

Evidence includes time advancement and a recreated app instance to verify grant
persistence, cross-account revocation denial, legacy grant behavior, anonymous
mutation controls, original tables/cards/columns, requested Live Preview editor and theme retention.

BrowserRouter owns page/notebook/folder/note selection. Dynamic note paths encode
individual path segments; query parameters retain view and filters. The existing
component tree renders each route. Unknown notebook, folder and note links show
explicit missing-page feedback. Editor instances are keyed by source and path.

The remote editor keeps the read baseline separately from its live draft.
Polling, focus and pre-save reads compare against that baseline. node-diff3
merges body lines, preserving line endings; recursive three-way object merging
reconciles frontmatter, with arrays treated atomically. Conflicts preserve a
source-scoped local backup and lock editing/save. Explicit refresh installs the
remote baseline while keeping the backup downloadable. HTTP 409 races re-read
and merge, then require another Save. Git ref updates stay non-forced.

Shell operations validate note boundaries and construct all blob/tree changes
before a single commit/ref update. Tools expose JSON schemas and structured
receipts. SDK client integration exercises discovery and output validation over
credential-bearing HTTP URLs. Read-only discovery omits every mutation.

Human review refinements: readonly Asset opens the asset browser; insertion and
upload require write capability. Escape closes the asset overlay first and then
the note, using the same unsaved-draft confirmation as the close button.

Review checkpoint: the user requested local dev against the local repository
before deployment. The local development processes stay running on port 5173
(web) and 4321 (API), with source selected through process environment. Production
deployment awaits the user's visual acceptance.

AssetLibrary is shared by the Assets page and editor dialog. It owns selection,
folder navigation, preview and reclick deletion state; App owns source-specific
mutations and list refresh. Upload selects its result and Insert is explicit.
Asset identities use Git blob content hashes, computed identically for local
files and GitHub blobs. New references use /raw-assets/by-hash/:hash. Resolution
searches only configured asset directories; moving files preserves their hash.
Original path URLs remain readable at their original locations. Local scans are
recursive and skip hidden files and symlinks. Uploads support 3 MiB. Remote
binary upload/move/delete use the same single-tree, single-commit machinery with
an asset-specific boundary and required revision.

LiveMarkdownEditor uses CodeMirror 6 with the Markdown parser and decorations.
It keeps the source text authoritative, rendering inactive syntax as formatting
and widgets while revealing syntax on active lines. Source mode remains for
precise edits. The imperative insert handle applies asset references at the
current selection and preserves undo history. Read-only changes use a compartment
so conflict locking retains the document and selection. Local autosave leaves
editing enabled during disk writes.

The shared MarkdownEditor owns lazy Live Preview loading, Source rendering and
selection insertion through one imperative handle. MarkdownEditorModeSwitch is
the shared controlled toolbar. Callers supply content, path, mode, readOnly and
onChange; their outer header, save policy and document-specific actions remain
local. This follows the existing controlled React editor pattern and avoids
coupling note frontmatter or HTTP persistence to the editing surface. Both
callers use the same components, rather than duplicating editor markup.

Agent System reads are cancellation-aware and track the loaded path. Its save
queue serializes captured path/content snapshots; selecting another file flushes
the current snapshot first. Restore waits for earlier writes. Verification uses
the actual two screens, disk contents in a disposable workspace and delayed API
responses to exercise rapid edits/switches.

Access Control stays mounted for every source; AgentAccessSettings receives the
local capability and renders the common form with explicit availability. The
header's Agent access entry also navigates to Settings for local workspaces.
NoteStatusSelect centralizes status colors/options and event propagation for
List and Card, using the existing App save callback.

## Responsive editing

Keep component-owned responsive classes and a small mobile CSS layer. Header
retains one navigation/action data flow across breakpoints. App owns mobile
notebook panel visibility and closes it on navigation; Sidebar content stays
shared. Agent System uses the existing document selection handler with a mobile
select. Note overlay and app shell use dynamic viewport height; a shared viewport
hook observes VisualViewport resize/scroll at normal zoom to keep overlays above
the software keyboard. Preserve pinch zoom. Metadata scrolls independently so
it cannot consume the editing area. Touch targets and input typography apply
across sibling dialogs. Existing shared editor handles and API contracts stay
unchanged. Verify geometry and actual saved fixture content, with desktop
regressions run against the same components.

Mobile navigation uses the same four Header buttons in a fixed bottom grid.
The app shell reserves its height plus the device safe area; note overlays
cover it while editing. Commit controls sit above the bottom navigation.

Mobile toolbar correction: extend MarkdownEditorModeSwitch with a shared Radix mobile
selector sharing the existing controlled mode. Common editor-action styles
retain icon geometry and hide desktop labels; confirming actions show a compact
confirmation label. Position note Save next to Close in the title row. Keep the
Agent status compact and order its mode, status and restore controls in one row.
Caller-owned save, restore, metadata and asset actions remain unchanged.

Sidebar gestures attach to the Notes workspace container. Recognize a horizontal
single-finger drag from its first 24 px when closed, or a leftward drag when open;
move the panel with the finger and settle after a 64 px drag. Preserve vertical
scrolling, interactive text inputs, non-edge gestures, and touch cancellation.
Native device/browser system edge gestures remain subject to physical acceptance.
Select option colors use the current palette independently of the badge color.

Shared Select wraps Radix Root/Trigger/Portal/Content in popper positioning with
collision padding. Public options are value/label pairs; internally prefix values
to support the existing empty status option. Trigger width stays within its
container; content uses Radix available-height and trigger-width variables,
palette colors and a viewport max width. Shared EditorNotice owns message/action
layout; an editor notice group bounds stacked warning/error/recovery height.

Radix API reference: https://www.radix-ui.com/primitives/docs/components/select
(checked for popper positioning, collision padding, available-height variables,
keyboard navigation and Escape handling).

## Notebook status seam

Add a browser-safe core `note-status` subpath containing defaults and the resolver.
App resolves definitions plus observed values before applying view filters and
passes the result to existing view/editor components. Types re-export the core
manifest types. This keeps filesystem modules outside the browser bundle and
removes component-owned status catalogs. Config validation retains the optional
field; both source adapters already use that parser. The existing manifest editor
is the configuration surface. Exact string identity preserves arbitrary imported
metadata; no-status has an explicit empty value separate from inbox.

The selected notebook determines creation defaults. Editor options use the edited
note's notebook and include its current draft status. Kanban consumes the same
ordered options; unknown values append in stable lexical order. Sidebar counts
use exact status keys and can display empty configured categories.

Visibility uses core isNoteHidden and withNoteStatus helpers shared by App and the
metadata editor. The exact persisted field is hiden as requested. Route query
showHidden owns the Sidebar checkbox; App filters visibility before view filters
and sidebar counts while resolving statuses from all notebook notes. Direct note
resolution uses the complete collection. Metadata actions update hiden together
with status through existing save/revision workflows. No file migration occurs.

Acceptance found that the mobile floating Commit bar intercepts taps on a lower
Card status selector. Render that bar in the Notes app flex flow on mobile so its
actual height reserves space above bottom navigation. Other pages and desktop keep floating
placement. The browser anchor checks the actual hit target before opening the
lower card's status menu with pending changes.

Website drafts use a dedicated browser working-tree store with each note's base
and current versions. App overlays those entries on fetched notes and derives
pending Git status; the shared Commit modal receives a local preview and a remote
commit callback. Editor remote checks reuse three-way merge, and local draft saves
retain the baseline rather than treating uncommitted content as remote truth.
A new guarded note-batch commit endpoint uses the existing GitHub tree/ref seam;
MCP keeps its generated-message path. Rename Vercel wildcard captures so routing
parameters and note path query parameters have separate names.

### Publication topology

Create the initial public `core` from the verified current product tree, excluding root `notes/**`, the workspace manifest, local configuration, build artifacts and secrets. Keep the original local Core history on a local backup branch. Merge the public Core into remote `main` without rewriting its history; resolve the demo README in favor of the product README while retaining the workspace configuration and notes byte-for-byte. Track public `core` from the development checkout and configure its default push to publish Core. The separate local `main` data worktree keeps its existing private history.

Configure Vercel Git integration and production branch tracking, then verify the production deployment's commit identity and a real full-path note read. This supersedes the earlier CLI-only release checkpoint.

Publication friction: GitHub CLI login had not configured Git's HTTPS credential helper; `gh auth setup-git` resolved the push. Vercel required the remote Core branch to exist before accepting production branch tracking. Publication now has explicit branch/tree and deployment identity checkpoints. A concurrent local README rewrite was observed after snapshot publication and remains a separate uncommitted user change.

### Starter template seam

Replace inline bootstrap note/config strings with the existing `examples/demo-workspace` directory. Keep bootstrap's CLI and Git lifecycle; copy missing template files exclusively, using the shared path guard and existing config parser. The public demo synchronization is an explicit release operation in a disposable checkout, while ordinary bootstrap preserves user edits. Validate the CLI on disposable Git repositories, including root-config precedence, custom notebooks, reruns and symlink escapes.

### Release automation seam

A standalone Node script owns the Git synchronization transaction so temporary repository tests exercise the same logic as Actions. Preserve existing merges via `git rebase --rebase-merges`; copy the Core template into the demo workspace; use the fetched main SHA as the force-with-lease condition. GitHub Actions runs the existing pnpm checks and invokes this script with the tested Core SHA. A second small script polls GitHub commit statuses for Vercel success/failure. Vercel integration remains the deployment executor, avoiding duplicated application credentials or short-lived CLI OAuth tokens in CI.
