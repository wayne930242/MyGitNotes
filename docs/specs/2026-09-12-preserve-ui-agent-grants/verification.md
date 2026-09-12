# Verification

Checkpoint: local development review on 2026-09-12. Production remains at the
previous deployment; the user requested local acceptance before deployment.

| Contract | Evidence | Result |
| --- | --- | --- |
| Original navigation/views/themes and public readonly controls | `node scripts/qa-browser.mjs` exercises List/Card/Kanban, Settings and theme persistence | Pass |
| Pages and dynamic notes survive reload/back | URL unit tests and browser reload/back checks; static asset directory redirect disabled | Pass |
| Remote edits merge or lock until refresh | Three-way body/frontmatter tests; browser independent remote edit, focus-triggered overlap, disabled Source/Live Preview and explicit Refresh with draft backup | Pass |
| Persistent grants and manual revoke | HTTP OAuth flow, 31-day time advance, recreated server, browser logout, foreign-owner denial, owner revoke and legacy expiry | Pass |
| Complete MCP URL and schemas | MCP SDK client discovery/calls over credential URL; structured output schema validation and all readonly mutation exclusions | Pass |
| Shell note operations commit remotely once | Git data emulator exercises ls/glob/read/find/write/append/edit/mkdir/cp/mv/rm; one tree/commit/non-force ref update, stale writes rejected | Pass |
| Shared asset workflow | Browser dialog upload selects without insertion, View, explicit Insert, directory move, stable hash URL, first delete retains file and second deletes | Pass |
| Asset API boundaries | HTTP upload/move/delete with hash resolution; note deletion and traversal denied; remote binary asset mutations commit once and reject stale revisions | Pass |
| Live Markdown editing | `node scripts/qa-live-editor.mjs`: formatted inactive syntax, active source, image/table rendering, checkbox edits, Traditional Chinese text, undo and asset insertion | Pass |
| Escape behavior | Actual local dev and browser fixture: Escape closes preview, then asset overlay, then note | Pass |
| Product checks | `pnpm test`: 76 tests, 15 files. `pnpm build`: all packages succeed. `git diff --check`: clean | Pass |

Build note: the Live Preview editor is loaded separately when a note opens. Its
543 kB minified chunk triggers Vite's advisory 500 kB chunk warning; the initial
application chunk is 435 kB. These are uncompressed sizes.

Review boundaries:
- The local dev server uses `/home/weihung/github-notes` on `core` and exposes
  readonly notes according to the branch contract. Write scenarios run against
  disposable `main` fixtures. Real user notes and `.env` were not edited.
- Browser MCP tests use fixture credentials. Real ChatGPT connector UAT and
  production verification follow visual acceptance and deployment.
- New asset references use hash URLs; existing path-based references retain
  their original format. Convert those references before moving their assets.
- Browser tests verify Unicode input; native operating-system IME composition
  remains part of human acceptance.
- Existing concurrent Sidebar footer edits are preserved and excluded from this
  task's commit.

Repeat browser verification after `pnpm build`. Set
`PUPPETEER_EXECUTABLE_PATH` when Chrome is outside the default local cache path.
Screenshots are generated under ignored `artifacts/qa/`.

## Shared editing and status checkpoint

Checkpoint: 2026-09-12 local acceptance follow-up. The running development server
uses product source from `/home/weihung/github-notes` and local data from the
`main` worktree at `/home/weihung/github-notes-workspace`. The API reports write
capability, and a read-only browser inspection confirmed the actual development
Agent editor is editable and Settings exposes MCP Access Control.

| Contract | Evidence | Result |
| --- | --- | --- |
| Shared Note/Agent Live Preview and Source | `node scripts/qa-shared-editors.mjs`: Agent editing, mode changes, saved file contents and two-click restore; `node scripts/qa-live-editor.mjs`: note formatting, active syntax, images, tables, tasks, Unicode, undo and asset insertion | Pass |
| Agent document changes preserve pending edits | Delayed saves followed by typing and file switching; delayed stale reads; injected save failure retains the draft and selection until successful retry | Pass |
| Access Control appears for local workspaces | Shared Settings section and grant form visible locally; hosted grant actions disabled with an explanation of local operating-system access | Pass |
| Card status matches List | Browser selects a Card status, verifies the file on disk and matching List status, and asserts the note editor stays closed | Pass |
| Existing workflows remain functional | `node scripts/qa-browser.mjs`: asset interactions, routes, themes, remote merge/conflict, readonly controls and grant URL/revoke | Pass |
| Product checks | `pnpm test`: 76 tests in 15 files; `pnpm build`: all packages succeed; browser scripts report no runtime errors | Pass |

Visual review: `artifacts/qa/shared-agent-editor.png` shows the shared mode switch
and Live Preview inside the existing Agent layout. Browser mutations used
disposable `main` fixtures, leaving the user's workspace notes unchanged.

The shared editor remains lazily loaded. Vite reports an advisory for its
approximately 580 kB minified chunk; the initial application chunk is approximately
399 kB. Production deployment and real ChatGPT connector UAT still follow local
acceptance. Concurrent Sidebar footer edits remain outside this change.

## Mobile navigation and editing checkpoint

Checkpoint: 2026-09-12, local acceptance. The latest user direction selects four
bottom destinations with icons above single-line labels. Earlier horizontal
mobile navigation was rejected and replaced by this design.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Explain Core update failure | Actual main worktree has no remotes; direct discoverCoreRemote call returns NO_REMOTE before any fetch/merge | pass |
| Settings owns access management | Mobile and desktop fixture checks: header shortcut absent, Settings present, authenticated grant form enabled, account/logout retained | pass |
| Four mobile destinations remain legible and tappable | Browser geometry at 320/390/430 px: four 20 px icons, single-line labels, 56 px targets; actual local dev at 390 px confirms all four and Settings navigation | pass |
| Responsive note and Agent editing | Geometry at 320/390/430/820/1440 px; mobile document selector; live/source editing and actual fixture file saves | pass |
| Local mobile workflow | Touch notebook/folder navigation, Card status save, note creation, metadata input sizing, asset upload/view/insert and Agent save | pass |
| Reduced viewport editing | 390×420 local and 320×420 hosted fixtures: close, assets and editor stay inside viewport; source edits and revision-aware remote save succeed | pass |
| Existing desktop behavior | qa-browser, qa-shared-editors and qa-live-editor: routes, themes, readonly controls, conflict handling, access grants, editor modes, undo, insertion and serialized Agent saves | pass |
| Product checks | pnpm test: 76 tests in 15 files; pnpm build: all packages succeed; git diff --check clean | pass |
| Native phone keyboard and IME | Requires physical-device acceptance; viewport emulation does not exercise the OS keyboard | unknown |

Screenshots: `artifacts/qa/mobile-notes-320.png`, `mobile-note-390.png`,
`mobile-agent.png`, `mobile-assets.png`, and `local-mobile-bottom-nav.png`.
The development server remains available at http://localhost:5173 using the local
main worktree. No deployment or real ChatGPT connector UAT was performed.
Concurrent Sidebar footer edits remain outside this commit.

Reflexive: transient verification setup mistakes (overlapping build/preview,
duplicate upload fixture, URL assertion including query parameters) were fixed
in execution or the browser script. Solid-loop's friction gate found no recurring
agent-system defect; instructions were left unchanged. Browser verification runs
after the completed build and uses disposable workspace data.

## Mobile controls acceptance correction

Checkpoint: 2026-09-12, following the user's toolbar, swipe, select, recovery,
caret and List density feedback. The initial new toolbar assertion reproduced
`Note toolbar wraps on mobile`; the final implementation passes it.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Single-row Note/Agent controls | qa-mobile at 320/390/430 px: Note controls ≤48 px, Agent toolbar ≤64 px, including visible restore confirmation and reduced viewport editing | pass |
| Bounded headless selects | Shared Radix Select; open popup geometry with a long notebook label at 320 px; selection by touch, actual state/file changes and Escape closes the popup before the note | pass |
| Dark select and caret visibility | Open List/Card popup foreground/background contrast ≥4.5; input caret contrast ≥4.5; Source uses the same foreground; dark Live cursor uses that color at 2 px | pass |
| Recovery/alert layout | 320×420 recovery fixture: Restore Draft/Discard stay single-line with 44 px targets; editor retains ≥100 px; actual draft restore and file restore succeed | pass |
| Sidebar gestures and width | CDP touch events open from the edge and close leftward; vertical/non-edge/short/cancelled gestures leave it closed, no note opens accidentally; measured width is 75% | pass |
| Compact mobile List | One row ≤72 px with title/status/delete; path, tags and modified time hidden; Card and desktop retain existing detail | pass |
| Regression and build | 76 tests in 15 files; full pnpm build; qa-browser, qa-shared-editors, qa-live-editor and qa-mobile pass | pass |
| Physical phone behavior | Native keyboard, IME, and browser/OS edge gesture arbitration remain part of human acceptance | unknown |

The final mobile browser run also exercises create/edit/upload/insert/Agent save,
all four destinations, and hosted revision-aware saving with fixture credentials.
List/Card still render all filtered notes; pagination was not added.

Screenshots include `artifacts/qa/mobile-notes-320.png` and
`artifacts/qa/mobile-recovery.png`. Production remains unchanged pending local
acceptance. Browser write scenarios use disposable repositories.

Reflexive: caught and corrected a swipe compatibility-click guard that also
blocked the next intentional touch; a new touch now clears that guard. Shared
select test helpers operate visible popups instead of native select internals.
No agent-instruction changes were needed.

## Notebook statuses and visibility release

Environment: core product source, disposable main repositories for browser writes.
User authorized production deployment after this acceptance round on 2026-09-12.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Optional notebook statuses and default fallback | Core tests verify missing/empty defaults, custom order, parser roundtrip and malformed definitions | pass |
| Local/GitHub manifest parity | Source adapter test compares resolved notebook configurations; Settings browser save produces one commit retaining statuses | pass |
| Unknown and legacy values extend only their notebook | Browser observes doing alongside defaults, Review/review in a custom notebook, and retained removed definitions | pass |
| Consistent List/Card/editor/creation/Kanban/filter options | Browser exercises both notebooks, saves status changes, creates using first status and Kanban column, and retains columns under filtering | pass |
| Existing metadata and manifests preserved | Browser checks custom fields on disk, exact values, no-status clear/reload and unchanged manifest after note edits | pass |
| Archived defaults and explicit hiden booleans | Core tests and browser cover legacy archived, true/false overrides, all three views, and search with Show hidden notes | pass |
| Archive/unarchive and manual visibility persistence | Local file assertions and hosted revision-aware save fixture confirm hiden writes; metadata Hide note checkbox persists | pass |
| Sidebar visibility and direct hidden-note links | Browser opens a hidden note directly and verifies Sidebar include-hidden query, reload and mobile toggle | pass |
| Mobile status controls remain reachable | Browser hit-tests and taps a lower Card status with pending changes; Notes Commit bar reserves layout space | pass |
| Shared mobile editing remains usable | qa-mobile passes 320/390/430/820/1440 widths, reduced-height Note/Agent editing, controls, recovery, swipes and hosted saves | pass |

Validation: pnpm test (90 tests / 16 files), pnpm build, git diff --check,
qa-note-statuses, qa-mobile, qa-browser and qa-shared-editors pass. Browser
writes use temporary repositories; real notes and workspace manifests remain
unchanged. Build retains the existing lazy Live editor chunk-size advisory.

QA found and fixed a mobile Commit overlay intercepting lower Card status taps.
The fix is scoped to Notes so reduced-height Agent editing keeps its accepted
layout. Harness corrections wait for completed view/drawer transitions and use
touch activation in mobile emulation.

Reflexive: hit-target inspection distinguished overlay interception from a Select
failure. Existing skill guidance required no changes; solid-loop found transient
harness friction rather than an instruction defect.

Production and real ChatGPT MCP acceptance are recorded separately below. The
local .env currently has no MCP_UAT_READ_TOKEN or MCP_UAT_WRITE_TOKEN. The
[acceptance sequence](../../agent/mcp/uat.md) is ready for a new client grant.

### Production release checkpoint

- Product commit: `134ca44`. CLI deployment includes the user's existing Sidebar
  footer change, preserved outside this commit.
- Deployment: `dpl_GcQM9ap8UaFSKsNYsDFgqNP6QFJz`, READY, production alias
  https://my-gh-core.vercel.app. Previous deployment remains
  `dpl_AJ6uhYRe5Zs8SXD3v73NBL4YNnjZ`.
- Platform build passes. Actual production browser reads the configured GitHub
  main branch with four notes; workspace, folders, notes, assets and session
  endpoints return 200. Kanban contains working/archived; Sidebar exposes hidden
  notes. At 320 px Settings fits the viewport and all four navigation entries are
  present. No browser runtime errors occur.
- OAuth initiation returns 302 to GitHub with the production callback. The
  credential-bearing MCP path rejects an invalid grant with 401 and the Bearer
  challenge, exercising deployed routing and session-store lookup. This is not
  evidence of an authenticated MCP tool call.
- The running local dev instance remains writable against its separate main
  workspace. A read-only browser check confirms new defaults, Sidebar, Settings
  and mobile navigation; real local data remains unchanged.
- Logs: `/tmp/github-notes-production-deploy.log`,
  `/tmp/github-notes-production-smoke.log`, and
  `/tmp/github-notes-local-release-smoke.log`. Screenshots:
  `artifacts/qa/production-status-settings.png` and
  `artifacts/qa/local-status-settings.png`.

Pending human checkpoint: create a new read-and-write grant in production
Settings, connect its full URL to ChatGPT, and execute the hosted acceptance
sequence. Live authenticated tool execution, remote UAT commits, and ChatGPT's
connector warning behavior remain unverified until that client is connected.

## Browser working changes and source publication — 2026-09-12

| Requirement | Evidence | Result |
|---|---|---|
| Local draft persistence and explicit selected Commit | `qa-working-notes.mjs`: edit/reload made zero writes; partial commit retained the unselected draft; rejected commit retained drafts for retry | pass |
| Atomic remote batch | Stateful GitHub fixture: two notes produced one commit/ref update; stale revision, invalid batch and path collisions made zero additional writes | pass |
| Remote merge and conflict handling | Browser preflight merged nonoverlapping text for review; overlapping text blocked Commit and editing until explicit refresh | pass |
| Existing status, access and asset UI | `qa-note-statuses.mjs` and `qa-browser.mjs` passed against disposable workspaces and hosted fixtures | pass |
| Publication and deployed full-path note read | Pending the GitHub publication and production checkpoint below | unknown |

Earlier production smoke covered note listing but omitted actual note reads. The release checkpoint now includes the full configured note path through the deployed rewrite and editor route.
