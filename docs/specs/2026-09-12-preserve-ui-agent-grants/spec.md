Status: approved
Approved at: 2026-09-12
Approved from: User's continuing full authorization, UI preservation feedback, and explicit selection of grants valid until manual revocation.

# Contract

- Local and GitHub sources use the original navigation, note views, editor and
  Settings theme palettes. Source permissions govern mutation controls.
- Markdown edits use the requested Live Preview and optional Source mode inside
  the original modal/theme and frontmatter UI. GitHub saves use explicit commits
  with revision feedback; local autosave stays intact.
- Settings contains named read-only or write MCP grants, one-time token display,
  a grant list and individual revocation. Creating/revoking needs browser login.
- New grants have no application TTL and survive browser logout, session expiry
  and deployment. GitHub authorization continues to govern upstream access.
- Browser sessions last 30 days on new login, bounded by upstream token expiry.
  Existing sessions and old eight-hour grants retain their original expiry.
- Runtime grant changes require updating only the MCP client, never deployment.
- Tokens remain encrypted server-side; list responses omit credentials. Owners
  can manage only their own grants; source/audience/write checks stay enforced.

Reality anchor: original UI browser checks across local/public/authenticated
fixtures; HTTP tests and deployed MCP checks for persistent and revoked grants.
Human visual acceptance and real authenticated MCP UAT remain separate gates.

## Accepted follow-up requirements

- Access Control returns a complete credential-bearing MCP URL suitable for a
  connector configured with No Authentication. The URL is shown once and can be
  revoked through the authenticated management page. Legacy Bearer access stays
  compatible.
- Hosted MCP supplies ls, glob, read, find, write, append, edit, mkdir, cp, mv and
  rm. Every successful mutation is one atomic remote commit with a deterministic
  program-generated message and receipt. Directory operations use explicit
  recursive/overwrite flags and preserve protected workspace paths.
- Each hosted tool declares input/output schemas and truthful read-only,
  destructive, idempotent and open-world annotations, with structured output.
- Restore actual browser routes for all pages, notebooks/folders and individual
  notes, preserving reload, direct links and back/forward behavior.
- While a remote note is open, check for remote changes. Attempt three-way merge
  against the original read version. Merge conflicts lock editing and save until
  the user refreshes the remote version; retain the user's draft. Backend
  revision checks remain authoritative for races during save.

Approved from: User's explicit requests for connector URLs, shell-shaped MCP
operations including rm/mv/ls, full dynamic routing, and remote-change merge and
refresh gating in the same working session.

- Asset management supports directory organization, upload inside the note asset
  dialog, single selection, separate View/Delete controls and explicit Insert.
  New embeds use content-hash URLs that resolve after asset moves. Preserve the
  original note/editor theme. Apply the workflow to local and remote sources,
  with writes governed by their existing branch and authorization boundaries.
- The Assets page and note asset dialog share selection and action controls.
  Delete requires a second click, with confirmation reset on selection changes
  and a four-second timeout.
- Markdown notes default to a single Live Preview editor: rendered formatting
  outside the active line, Markdown syntax at the caret, inline images/tables,
  task checkboxes, undo/redo and an optional Source mode. Keep raw Markdown as
  storage, preserve frontmatter, and apply remote conflict locks to this editor.

## Shared editor follow-up

Approved from: User explicitly requested aligning Agent System with note editing
and extracting a shared component after accepting writable local development.

- Notes and Agent System share Live Preview, Source, editing typography,
  readonly behavior and insertion mechanics.
- Note metadata/assets/remote conflict handling stay with the note caller.
  Agent System retains local autosave and reclick restore.
- Loading an agent file disables editing until the matching file arrives.
  Rapid file switches cannot associate old content with the new path. Pending
  edits are saved before a successful file switch; errors retain the editor.
- Real workspace documents remain untouched by implementation verification;
  browser write checks use disposable main fixtures.
- Settings always includes MCP Access Control for local and GitHub sources.
  Both sources use the same section and grant form; source/session capabilities
  determine available actions. Local workspace access explains OS permissions
  and the GitHub-source requirement for hosted connection URLs.
- Card and List views share the status selector. Selecting a card status saves
  through the existing note status workflow without opening the note. Readonly
  sources disable the same control in both views.

## Access entry follow-up

Approved at: 2026-09-12
Approved from: User explicitly requested removing the Agent access shortcut and
keeping access management in Settings.

Remove the header Agent access button for local and GitHub sources. Preserve
GitHub account/login/logout controls and Settings MCP Access Control. Verify the
rendered local Settings page and authenticated GitHub fixture. Explain the
existing local NO_REMOTE result from the actual Git configuration.

## Mobile editing follow-up

Approved at: 2026-09-12
Approved from: User requests responsive quality with mobile as a primary editing
scenario during local acceptance.

At 320–430 px portrait widths, users can navigate Notes, Agent System, Assets and
Settings, open notebook/folder/status filters, choose note views, create a note,
and select a status. Notes use the available viewport with reachable close,
mode, metadata, asset and save controls. Content and forms fit the screen;
intentional code/table/Kanban scrolling stays inside its own container. The
shared editor remains usable when the visible viewport shrinks. Agent documents
use a compact selector above the editor on mobile. Touch controls have at least
44 px hit areas and text entry uses at least 16 px fonts. Preserve desktop layout,
themes, authorization, remote conflict locks and save behavior.

Reality anchor: disposable main browser fixtures at 320/390/430 px, tablet and
desktop, including touch navigation, note editing, asset upload/insert, status,
Agent editing, Settings and reduced-height editing. Native OS keyboard/IME and
physical-device comfort are reserved for human acceptance.

Mobile navigation refinement, explicitly approved in the latest user feedback:
use a bottom navigation with all four destinations (Notes, Agent System, Assets,
Settings). Each destination has a full-size icon above a single-line label and a
consistent touch target. Reserve content space above the navigation and place
the commit control above it. Full-screen note editing covers the navigation.

## Mobile editor toolbars

Approved at: 2026-09-12
Approved from: User requests fixing mobile toolbars in both Note and Agent System
before resuming acceptance.

At 320–430 px, Note action controls occupy one row beneath the title, with Save
and Close in the title row. Agent action controls occupy one row beneath the
file selector. Both use the same mobile Live/Source selector. Icons retain their
size inside 44 px targets; Restore exposes visible second-click confirmation.
Preserve desktop labels, modes, permissions and save/restore behavior. Verify
row geometry and actual actions in disposable local and hosted fixtures at
normal and reduced viewport heights, including the dirty/confirming state.

Additional explicit requests: support dragging inward from the left edge to open
notebook navigation and dragging left to close it; vertical scrolling and
non-edge horizontal gestures retain their existing behavior. Select options use
explicit palette foreground/background colors so dark theme choices remain
readable. List/Card currently render all filtered notes; pagination is not part
of this correction.

Select/notice correction approved by the user's subsequent feedback: replace
application select controls with a shared headless Radix Select. Long option
labels wrap inside the popup; the trigger truncates inside its allocated width.
Popups fit the viewport in light/dark themes, support keyboard/touch interaction,
and close with Escape before an enclosing editor. Recovery and editor alerts
separate message/actions on mobile, keep Restore Draft/Discard on one line, and
scroll within a bounded notice area while leaving editing controls available.

Sidebar width: use 75% of the mobile viewport, as explicitly requested. Keep the
remaining right-side area available for backdrop dismissal.

Dark insertion caret: the user's latest feedback requires a clearly visible
caret in inputs, Source and Live editing. Use palette foreground color for the
native caret and a two-pixel foreground cursor in dark Live editing.

Mobile List density: user requests a compact view distinct from Card. Display
one row with title, status and delete; hide path, tags and modified time on mobile.
Preserve detailed desktop List and Card information.

## Notebook status configuration

Approved at: 2026-09-12
Approved from: User's explicit request for per-notebook status definitions with a
default fallback, following acceptance of inbox / working / done / archived.

- Each notebook accepts an ordered optional `statuses` string array. Missing or
  empty definitions use inbox, working, done, archived. New notes start with the
  first effective status; a Kanban add action selects its column.
- Effective options append statuses observed in that notebook. Unknown and legacy
  values stay visible in List, Card, metadata editing, filtering and Kanban.
  Filtering does not remove columns or choices. Values are exact, case-sensitive
  strings; labels preserve spelling. Existing metadata and manifests are unchanged.
- No-status notes remain unassigned until explicitly changed. Archived remains
  editable and hidden by default under the visibility contract below. Removing a definition retains notes that
  use that status. Different notebooks do not leak choices into each other.
- Manifest validation accepts only distinct, nonblank strings without surrounding
  whitespace; empty lists use defaults. Local and GitHub parsers retain the field.
- Configuration uses the existing Settings manifest editor and repository file.
  No new configuration write permissions or deployment are introduced.

Reality anchor: shared resolver/parser tests and a disposable main repository
browser run covering two notebooks, unknown statuses, filtering, Kanban, creation,
metadata saves, reload, and mobile selectors. Local test/build remain required.

### Note visibility follow-up

Approved from: User explicitly requests archived hidden by default, persisted as
`hiden` boolean in note YAML, and a Sidebar option to view hidden notes.

An explicit hiden boolean controls visibility; absent values fall back to hidden
for archived and visible otherwise. UI archive actions write hiden: true, and
leaving archived writes hiden: false. Other status changes retain manual hiding.
The note metadata editor offers Hide note. The Sidebar Show hidden notes checkbox
includes hidden notes in the selected view, counts and search; its URL query
survives reload/back. Default List/Card/Kanban omit hidden notes. Direct note links
continue opening hidden notes. Status choices still include values from hidden
notes. Existing notes receive no bulk migration. This is display filtering, not
an access restriction; repository/API/MCP reads retain access to hidden content.

Mobile Notes acceptance correction: pending-change Commit controls reserve their own
layout space above bottom navigation so lower card status controls remain
reachable by touch. Desktop floating placement remains unchanged.

## Explicit website commits (supersedes remote Save to GitHub)

Approved from: User explicitly requests local save during editing and separate
commit through the existing floating footer, alongside the welcome.md read fix.

Remote website note edits, metadata/status changes and new notes persist as
browser working changes scoped to repository and branch. Closing, switching
notes and reloading restore them automatically; storage failures remain visible.
These actions create no remote commits. The floating footer counts pending files;
its shared Commit dialog previews changes, selects files and submits one atomic
commit with an editable generated message. Successful selected files become
clean, unselected drafts remain, and failed requests retain all drafts. Existing
local disk saves and MCP commit semantics remain unchanged. Asset operations
retain their existing explicit upload/move/delete behavior.

Each draft retains its remote baseline. Opening a draft and committing check
remote changes; clean merges update the draft for review, conflicting changes
lock editing and commit until Refresh. Deleted notes and create collisions retain
local content. Direct links resolve configured full note paths in production.

Reality anchor: production welcome.md read (currently 403), stateful GitHub HTTP
fixtures exercising one-commit selected saves and stale revisions, and browser
checks asserting zero mutation requests during editing, reload, status changes
and note creation before explicit Commit. Exercise local and mobile regressions.

### Repository publication acceptance

- Public `core` contains the product source and excludes local workspace content and credentials.
- Public `main` includes Core and retains its existing workspace manifest and notes unchanged.
- Existing remote history is preserved through a non-force merge and push.
- The local development checkout tracks public Core; its old history and local data worktree remain available privately.
- Production deployments identify a public Core commit. Verify Git integration separately from deployment success.
