# Notebook bookmarks — implementation verification

Date: 2026-10-04. Owner: upstream single writer, `/home/weihung/github-notes`.
Baseline: `298eb474ec40b0ee5828b078cff18bb95a994dcc` on `core`.
Status: complete feature implementation; automated checks and bounded browser checks below executed. Parent's independent full UI and code review remain separate gates, not claimed complete here. No push, downstream write, deployment, live-provider write, credential change or user-workspace mutation was performed.

## Delivered surfaces

- Browser-safe strict domain schemas and immutable operations for all six target kinds, headings and paragraphs, labels, groups and ordering; exact source anchors with CRLF mapping; canonical scoped queries and safe HTTP(S) URLs.
- Optional repository-root `.mygitnotes-bookmarks.yaml` registered as a workspace document. Local and provider adapters preserve paired snapshots/revisions, unknown-owner collections, corrupt-file refusal, permissions and visible conflicts.
- Bounded read-only resolver: no URL fetching, no deletion inference on transient failures, actual saved source and exact mounted-editor re-resolution.
- Local file/folder planners and hosted MCP moves relocate references atomically; deletions retain references. Metadata participates in move revisions and local rollback, and is protected from ordinary note/file/MCP editing, including normalized paths and internal symlink aliases.
- Shared drafts/Changes integration, inactive-repository views, race-preserving settlement, query/sort/graph scope, sidebar groups/drag/accessible alternatives, creation/repair entrypoints and local-save versus remote-commit capture boundary.
- English/Traditional Chinese UI and usage documentation. Startup troubleshooting remains the last top-level section in both READMEs.

## Executed automated verification

The final full run used the commands below, after all production changes including normalized-path MCP protection. All completed with exit 0.

```bash
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
pnpm exec tsc --noEmit -p apps/local-server/tsconfig.json
node --check scripts/qa-bookmarks-fixture.mjs
node scripts/qa-bookmarks-fixture.mjs --smoke
git diff --cached --check
```

Logs are local handoff evidence, not repository fixtures:

- `/tmp/bookmarks-build.log`
- `/tmp/bookmarks-full-tests.log`
- `/tmp/bookmarks-lint.log`
- `/tmp/bookmarks-format.log`
- `/tmp/bookmarks-types.log`
- `/tmp/bookmarks-targeted.log` (earlier bounded server/multi-repository/rollback run)

Final results: **246 test files, 1779 tests passed**, duration 63.24s. Production build passed (existing large-bundle warnings only); lint reported no diagnostics across 730 source files/128 rules, with no hard-coded colours in 477 web files; format check and both fresh TypeScript checks passed. Final fixture smoke also passed (PID 369077, port 33437) and removed both temporary roots before exit.

### Behavior evidence map

| Requirement | Evidence | Result |
| --- | --- | --- |
| All target kinds, strict serialization, groups/order/identity, non-destructive removal | `packages/core/tests/bookmarks.test.ts`; `apps/web/src/components/BookmarksSection.test.tsx`; `BookmarkDialog.test.tsx`. | pass |
| Empty read, local permission, two writers, corrupt data, safe paths/URLs, saved-source resolution | `apps/local-server/tests/bookmarks.test.ts`; temporary actual HTTP servers and worktrees. | pass |
| GitHub/GitLab persistence, stale revisions, paired Changes base, document-only scope, permission | `packages/core/tests/bookmarks-remote.test.ts`; deterministic provider fixtures, not live network. | pass |
| Repository identity and same-root isolation | `apps/local-server/tests/notebook-repositories.test.ts`, plus two mapped `main` repositories in the real browser fixture. | pass |
| File move, old bookmark token, bookmark edit invalidating old move token, deletion, direct note restore | Bookmark-specific HTTP regressions in `apps/local-server/tests/bookmarks.test.ts`. | pass |
| Folder move/removal, recursive delete, absent metadata, corrupt metadata, alias protection | `packages/core/tests/bookmark-relocation.test.ts`, shared planner cases. | pass |
| Atomic rollback after a second local write fails | `apps/local-server/tests/bookmark-rollback.test.ts`: original note/bookmark bytes restored and destination absent. | pass |
| Hosted MCP directory destination rule and atomic provider metadata change | `packages/core/tests/bookmark-relocation.test.ts`: GitHub single tree includes bookmark file; GitLab single move actions commit includes note paths and bookmark file; subsequent recursive deletion retains exact metadata bytes. | pass |
| Local MCP artifact protection | `packages/mcp-server/tests/bookmark-protection.test.ts`: dot/backslash/absolute paths, existing file symlink and directory symlink before artifact creation; ordinary note remains allowed. | pass |
| Draft/save/commit races, inactive scope and note save failures | `apps/web/src/lib/use-bookmarks.test.tsx`; `apps/web/src/app/useBookmarkActions.test.tsx`; existing `useWorkingNoteCommit.test.tsx` and shared document suite executed in full run. | pass |
| Exact moved/repeated/ambiguous/edited/CJK/CRLF positions, code exclusions | `packages/core/tests/bookmarks.test.ts`; no hint-based or fuzzy fallback. | pass |
| Mounted editor content, readiness and note/request races | `apps/web/src/lib/use-bookmark-position.test.tsx`: 4 cases, including shifted dirty content and ambiguous duplicates without reveal. | pass |
| Scoped route/query restoration, canonical identity, explicit sort | `apps/web/src/lib/bookmark-navigation.test.ts`; core query tests; existing graph/filter/sort tests run unchanged. | pass |
| Existing lifecycle and movement entrypoints | Complete suite includes file/folder/bulk/shell, local/remote adapters, Focus/Study and editor tests; new bookmarks flow through the shared planner/document seams. | pass |
| Build/type/lint/format regression checks | Final logs: 246 files/1779 tests, build/lint/format/types exit 0 | pass |
| Full desktop/mobile acceptance and independent code review | F001/F002/F003 fixed with red/green evidence below; independent re-review remains pending | unknown |

The movement entrypoint audit is the detailed table in `design.md`. Tests exercise shared planners, HTTP note/file mutations, provider commits, shell movement/deletion and rollback; this is not a claim that every provider × UI entrypoint Cartesian product was independently driven in a real browser. Parent review should verify the shared-seam coverage against that audit.

## Executed disposable real-browser checks

Build: final feature build before the final MCP-only alias hardening; no UI source changed afterward.
Browser: owned headless `agent-browser --session bookmarks-api`; no login or user session.
Fixture: `scripts/qa-bookmarks-fixture.mjs`, actual built web/local server, two disposable `main` repositories with current manifest schema constant, same notebook roots, Markdown headings/paragraphs and compilation.

Observed:

1. Desktop rendered all seeded target kinds and Saved status; no page errors were reported.
2. Created a saved-query bookmark through the actual Notes toolbar/dialog; autosave completed and reload retained it.
3. Created an HTTP(S) bookmark through Add bookmark; verified its rendered link has `target="_blank"` and `rel="noopener noreferrer"`. Did not navigate to or fetch the external website.
4. Activated a heading bookmark: routed to `notebooks/a/notes/guide.md`, one CodeMirror host mounted, actual browser selection was exactly `# Bookmark fixture`, no alert appeared.
5. At 390×844, opened notebook sidebar; document scroll width stayed 390 and bookmark section fit its container.
6. Used the mobile-accessible group selector to move the heading bookmark into Reading; API readback confirmed stable ID `fixture-3`, label `4. position`, group `reading` after Saved.
7. Fixture preflight resolved seven seeded entries (all kinds, both position kinds), verified both repositories writable on `main`, and loaded the built UI over HTTP. `--smoke` exited and removed both roots.

Screenshots and supporting snapshot:

- `/tmp/bookmarks-desktop.png`
- `/tmp/bookmarks-position-desktop.png`
- `/tmp/bookmarks-mobile.png`
- `/tmp/bookmarks-mobile-grouped.png`
- `/tmp/bookmarks-desktop-snapshot.txt`

Own fixture process: PID `330757`, port `46115`, monitor `9`.
Own roots: `/tmp/mygitnotes-bookmarks-home-xPPZpx`, `/tmp/mygitnotes-bookmarks-other-QsWDzU`.
Cleanup executed: browser session closed; MonitorStop called; `ps`, `ss` and existence checks confirmed PID, listener and both roots gone. Parent's independently started fixture is not ours and was not stopped.

## Independent parent fixture instructions

```bash
pnpm build
node scripts/qa-bookmarks-fixture.mjs --smoke
# For interactive browser QA, launch this command ONLY with MonitorCreate:
node scripts/qa-bookmarks-fixture.mjs
```

The fixture prints one JSON ready record with PID, port, home root, other root, route and schema; no browser dependency is needed to bootstrap it. Open the printed route in the parent's own browser session. Stop its monitor afterward and verify the printed PID/port and both roots are gone. Signal handlers remove only the fixture-created roots. It accepts no user-workspace root or credential input.

## Compact UI follow-up

Baseline for this UI-only follow-up: `0a2b5ea83d6b8b36542aab83fcfc89c849758cf8`. Replaced repeated disclosure rows with type icon/name/ellipsis, using the existing Radix folder-menu styles and native-dialog focus convention. Group actions use an ellipsis menu; Move up/down remain in the menu and Group opens a select dialog. Drag paths still call the same operations. No API/data source changed.

- Full rerun: **246 files, 1781 tests passed**; build/lint/format/web types exit 0. Logs: `/tmp/bookmarks-compact-{build,tests,lint,format,types}.log`.
- Component regressions cover read-only navigation, menu grouping/removal, up/down, drag, group rename, Escape focus return and menu-to-editor sequencing. A test initially sent Enter without focusing the target; focusing the real keyboard target fixed the invalid simulation.
- Actual 1440×1000 browser: all seven seeded rows measured **32px**, Add appeared at y544 and the folder tree at y602. Actual menu→Group saved successfully; Edit→Escape returned focus to the exact ellipsis trigger.
- Mobile emulation: viewport/document width 393px with no horizontal overflow, all rows measured **44px**; group menu→Rename persisted successfully. Screenshots: `/tmp/bookmarks-compact-desktop.png`, `/tmp/bookmarks-compact-mobile.png`. No browser errors reported.
- Owned session `bookmarks-compact` closed; monitor12 stopped; PID390520/port38123 and roots `/tmp/mygitnotes-bookmarks-home-A6VklZ`, `/tmp/mygitnotes-bookmarks-other-tgHfRN` verified gone.

Parent independently verified initial note/position creation, unresolved/retarget behavior, atomic folder moves, repository-isolated URL creation, group/ungroup persistence and content retention. Independent static review of the immutable initial commit nevertheless found three blockers: F001 cross-repository same-root UI path validation, F002 HTTP note symlink alias protection, and F003 raw textarea CRLF offsets. They were **not resolved by that UI-only follow-up**. The subsequent review-fix work below addresses all three before re-review; no publication occurred.

## Review blockers — sequential fixes (2026-10-05)

Baseline for these fixes: compact-UI commit `72df3828ef347b5f9fafd93ed9fd8087e12d5430`. All three findings were reproduced with failing regressions before their corresponding production edit.

| Requirement | Evidence | Result |
| --- | --- | --- |
| F001 same-root notebooks in distinct repositories | Action tests initially failed four cases; scope now filters `config.notebooks` by `repositoryFor(id).id` before both path validations. Seven action tests pass, including B note/compilation/position activation and position capture. | pass |
| F002 HTTP note aliases must not bypass document revision protection | Four read/write/delete/restore tests initially returned 200 for a metadata symlink. `noteRepository` now applies the existing managed-file no-symlink policy for local handles, including ancestors and portable separators. Fifteen bookmark HTTP cases pass, including directory aliases with present/absent metadata and slash/backslash paths; original bytes remain unchanged. | pass |
| F003 raw textarea CRLF position mapping | Real textarea integration initially failed three cases, including revealing `ragraph`. Raw selection now maps LF textarea offsets to the original body; raw reveal maps original offsets back to LF. Four MD/text and CRLF/LF textarea cases pass without content mutation. | pass |

Red/green logs: `/tmp/bookmarks-F001-{red,green}.log`, `/tmp/bookmarks-F002-{red,green}.log`, `/tmp/bookmarks-F003-{red,green}.log`.
Final full run: **247 test files, 1797 tests passed** (63.20s); build, lint, format, web/server types all exit 0. Lint: 732 files/128 rules, no diagnostics; theme audit: 479 web files. Logs: `/tmp/bookmarks-review-{build,tests,lint,format,types}.log`.
Active LSP recheck covered all six changed TypeScript files: four clean, two inconclusive; known cached-import findings remain explicitly dispositioned. Fresh compilers are the independent complete type evidence.

Actual same-root B browser fixture verification:

- Seeded B note/compilation bookmarks only in the disposable secondary repository; activated each via sidebar. Routes were `/notebooks/b/notes/guide.md` and `/notebooks/b/notes/reading.compilation.yml`; Other guide and QA compilation rendered without alerts.
- Created B position through the editor picker and Save first; after closing zoom and activating the sidebar bookmark, actual selection was exactly `## Second heading`. Screenshot: `/tmp/bookmarks-F001-B-position.png`.
- Created another disposable B note whose saved body retained CRLF. Switched to Source, selected Paragraph in the actual LF textarea, captured/saved the position, then activated it. Actual selection was exactly `Paragraph`; default reopened host was live, so **raw reveal** evidence remains the explicit textarea integration tests, not a claim about that browser host. Screenshot: `/tmp/bookmarks-F003-crlf-capture-activation.png`.
- Initial attempts to click sidebar controls behind zoom, and to select fixed offsets without accounting for serializer-added leading blank lines, were not successful actions. Closing zoom and selecting the actual source substring exercised the intended UI; invalid cross-block selection was rejected rather than stored.
- No page errors reported. Owned session `bookmarks-review` closed; monitor14 stopped; PID421673/port37185 and roots `/tmp/mygitnotes-bookmarks-home-Ibw7MC`, `/tmp/mygitnotes-bookmarks-other-f7ZmtS` verified gone.

Independent re-review is required before calling the feature approved. Initial passing tests did not cover these three cases; their old successful counts are not evidence that the initial commit was safe.

## Human appropriateness

Parent's independent desktop/mobile acceptance and code review are pending, distinct from the bounded worker checks. Initial presentation feedback and its impact are recorded below; no final human-appropriateness verdict is claimed.

## Reflexive

- Gap: LSP cached package exports, while fresh compilers and runtime verified the new exports. Evidence was preserved and findings dispositioned; no import-boundary workaround or inline type suppression. Solid-loop action: parent may inspect diagnostic refresh behavior separately; no project rule change needed.
- Gap: monitor shell was POSIX sh, not bash; removed an unnecessary pipefail setting and reran the entire chain. Solid-loop action: use portable monitor commands for this handoff.
- Gap: headless CLI click did not scroll offscreen controls; explicit scroll-then-click verified the actual UI. Solid-loop action: include this observation in parent fixture instructions, without changing browser security or product behavior.
- Gap: bookmark sidebar disclosure density needs independent UI judgment. Solid-loop action: retain parent feedback as a focused follow-up rather than changing UI under active QA.

## Remaining review gates and limitations

- Parent owns independent code review and the complete desktop/mobile acceptance journey, including every creation entry, drag/group/remove/repair, read-only navigation, unavailable/retry, second-tab conflicts and dirty-editor cancellation across Focus/zoom hosts. The bounded browser checks above do not claim those entire journeys passed.
- Parent's initial sidebar-density concern was addressed by the separately committed compact UI and measured desktop/mobile checks above. Independent final visual approval remains the parent's gate.
- Provider tests use deterministic GitHub/GitLab fixtures. No live provider/deployment verification occurred. GitLab's existing changed-file preconditions are not a whole-branch compare-and-swap after its final branch check.
- Local mutation queue is process-local, not an OS transaction against independent external editors/Git processes.
- Active LSP probes were run on changed boundaries. The server retained old core package exports/declarations; findings were explicitly dispositioned as false positives after fresh compiler/build/runtime evidence. Some push-only probes were inconclusive. This document does not report an LSP-clean verdict; fresh `tsc` results are the type-check evidence.
- First final-monitor attempt used `set -o pipefail`, but MonitorCreate's `/bin/sh` rejected it before executing commands. The corrected portable command completed; no failed output was counted as a successful run.
- Agent-browser did not automatically scroll offscreen sidebar/dialog controls into view. Explicit `scrollintoview` followed by real clicks succeeded; the initial click attempts/timeouts are not counted as completed actions.
