# Outline notes — verification ledger

Planning baseline: `/home/weihung/github-notes`, clean HEAD `ac26edfe69120fac9eff904b5cb7f53e76966588`.
Status: implementation in progress; native-kind foundation verified in upstream, remaining editor/UI/import/relocation work and independent browser QA are not complete.
No push, deployment or downstream synchronization was performed by this worker.
The approved model is **Outline note / 大綱筆記**, with general items and optional links, not the earlier specialized bookmark document.
Contract: [spec.md](spec.md); implementation sequence: [design.md](design.md).

## Historical evidence and human verdict

**Prior human UI acceptance: FAIL.**
The user rejected inconsistent fields/buttons/layout, the constant Saved badge, and separate Add bookmark/Add group flows.
Later compact rows, green functional tests and no-overflow measurements did not establish that the workflow was suitable.
The final user clarification also invalidated a text-group/link-leaf distinction: every outline item is general content.

At BASE, the earlier verification document recorded old collection implementation checks, culminating in 247 test files / 1797 tests, builds/types/lint/format and bounded disposable browser checks.
It also recorded fixes for cross-repository equal-root validation, metadata symlink protection and raw-textarea CRLF offsets.
Those are historical reports for the retired collection implementation, not new execution evidence or proof of outline semantics.
The full previous artifact is preserved in Git at `ac26edfe69120fac9eff904b5cb7f53e76966588:docs/specs/2026-10-04-notebook-bookmarks/verification.md`.
Its temporary log/screenshot paths were not revalidated in this planning session.
Retain the security/race/CRLF regressions during replacement rather than treating the UI rejection as permission to remove their protections.

## New requirement evidence

All new requirements start unknown.
A planned test or a source reading is not an executed behavior check.

| Requirement | Evidence | Result |
| --- | --- | --- |
| R1 Native Outline type, multiple documents, portable `.outline.md`, no hidden registry | Stage 1 parser/classifier/local HTTP/GitHub/GitLab tests pass; native creation UI not yet connected. | unknown |
| R2 General text/link items, children and annotations, non-destructive deletion | Standard Markdown representation specified; no new source round-trip or rendered-browser evidence. | unknown |
| R3 Enter sibling, Shift+Enter annotation, Tab hierarchy in live/raw, undo/IME/accessibility | Inspected current keymaps: raw lacks list commands and live lacks Tab binding; approved commands unimplemented. | unknown |
| R3a Same-document live-editor subtree dragging, drop/nesting feedback, cancel/read-only, undo/redo | User-approved addition; pure movement and real-browser drag evidence not yet exercised. | unknown |
| R4 Existing UI consistency, native save state, no old forms/Saved badge | Existing components named as precedents; replacement UI and independent visual comparison not executed. | unknown |
| R5 Internal/external optional links, opener isolation, no preview fetching, repository scope | Native resolver/dispatcher inspected; outline-specific interaction/no-embed checks not executed. | unknown |
| R6 Add current content with filled label/target into selected/new outline | Consumed-once mounted-editor insertion planned; cancel/race/dirty-destination behavior untested. | unknown |
| R7 All note lifecycle/local+remote/kind isolation and compilation unaffected | Stage 1 catalog, local create/save/copy/delete/restore, GitHub/GitLab create/save guards and draft facets pass; full move/UI lifecycle remains unverified. | unknown |
| R8 Atomic rename/move references and non-destructive delete/restore | Existing Markdown planner reuse identified; hosted shell Markdown relocation gap remains for implementation. | unknown |
| R9 Explicit partial/non-lossy import, retained source/drafts, invalid/stale/unknown-owner refusal | Preview/apply/recovery contract specified; no import endpoint or migration test executed. | unknown |
| R10 Disposable independent reality anchor, documentation and delivery gates | Fixture/task/cleanup plan recorded; new integrated QA and parent human acceptance not executed. | unknown |

## Stage 1 execution checkpoint

- Native suffix classification, ordinary Markdown parse/serialize, title fallback, catalog/query/facet isolation, repository-aware draft overlays and local HTTP access are implemented.
- Compilation duplicate-ID invalidation now explicitly applies only to compilations; ordinary/outline frontmatter IDs cannot inherit compilation errors.
- Remote index cache advances to `v3` so cached generic-note rows cannot hide the new kind.
- Red anchor: `/tmp/outline-stage1-red.log`, 8 expected failures before implementation.
- Full automated regression: `/tmp/outline-stage1-full-tests2.log`, **248 files / 1808 tests passed**.
- Build: `/tmp/outline-stage1-full-build.log`, passed with existing Vite chunk warnings.
- Lint and format: `/tmp/outline-stage1-lint.log`, `/tmp/outline-stage1-format.log`, both passed.
- Fresh types: `/tmp/outline-stage1-webtypes2.log`, `/tmp/outline-stage1-servertypes2.log`, both exit 0.
- Active LSP was exercised; its web server retained pre-build core declarations and reported stale outline/facet errors despite fresh package build and fresh compiler success; those exact diagnostics were recorded false-positive rather than silenced with source comments.
- Runtime integration: the local native-note test starts `createApp` on an ephemeral loopback HTTP port and exercises POST/query/facets/read/delete/restore; its own server and temporary root are closed/removed in `afterEach`.
- Provider evidence is deterministic GitHub/GitLab fixture execution, not live-provider access.
- Stage 2 source-command files may be uncommitted while the verified stage 1 is checkpointed; they are not included in stage 1's full-suite claim.
- No persistent fixture server or browser session is running yet; rendered UI/drag/textarea undo evidence and human appropriateness remain unknown.

## Required automated evidence

### Core and classification

- Parse/serialize `.outline.md` with standard frontmatter, no frontmatter, malformed frontmatter handled as existing Markdown, CRLF, CJK and filenames with spaces.
- Verify suffix-only kind, fallback title without `.outline`, kind `all`/`outline`/`note`/`compilation`, separate facets and remote draft overlay counts.
- Exercise local and provider list/query/lookup/create/save/tag/status/rename/copy/delete/restore/Changes; a staged outline must classify before its first server read.
- Confirm default compilation sources and duplicate compilation ID validation stay restricted to their established kinds.
- Verify outline graph/agenda participation uses native Markdown paths without a new task model.

### Actual editor adapters

- Mount real CodeMirror and raw textarea, send actual key events, assert both source and selection, then switch mode/save/reopen.
- Enter at text end and inside text; Enter in annotations; sibling after an item with children; empty item exit; Shift+Enter repeated annotations; nested child beneath an item that already contains links.
- Tab/Shift+Tab on one item, a complete subtree and multiple sibling subtrees; first sibling/root boundary; Escape-then-Tab focus escape; touch toolbar indentation.
- Preserve non-list prose, ordered-list paste, fences, escaped markers, incomplete links, long lines, annotations that contain Markdown and unselected children.
- Check selection replacement, mid-line edits, undo/redo and CRLF offsets; raw browser undo must be exercised beyond React callback assertions.
- IME composition must not create siblings; completion Enter priority and modified Enter behavior must be deterministic.
- Link text in editable CodeMirror must not have Enter stolen by `WorkspaceLinks` capture; explicit open affordance and keyboard-focused link activation still navigate.
- Drag a live-editor item with annotations/children to a sibling position and another nesting level; verify drop indicator, exact source, own-descendant refusal, cancel/read-only, one-step undo and redo in an actual browser.
- Existing ordinary Markdown and compilation editor tests remain green.

### Links and relocation

- Internal note, outline and compilation links; optional mixed text/multiple links; missing target retained; unavailable repository shown as unavailable.
- HTTP(S) new-tab opener isolation and zero automatic URL-preview requests, including YouTube; unsafe schemes/credentials remain non-navigable.
- Same root/path in repositories A/B, including delayed loads, completion choices, Focus/zoom and reopened editor.
- Move link target, move outline itself, rename containing folder, remove folder while keeping content, bulk partial failure and hosted MCP directory-destination `mv`.
- Assert labels, annotations, hierarchy, external URLs, fragments and code literals stay unchanged; incoming references from ordinary notes also follow outline-file moves.
- Local second-write fault restores original source/target/legacy bytes; move-versus-edit stale rejection; GitHub one tree/commit and GitLab one actions commit using paired snapshots.
- Deletion and restore retain referring Markdown; no inferred rename from arbitrary Git edits.

### Legacy import and retirement

- Preview/cancel/missing source: no writes and no spontaneous metadata creation.
- Exact converted/retained report for all old target kinds, groups, empty groups, duplicate labels, Markdown-sensitive titles/URLs and missing note targets.
- Explicit partial acknowledgement for positions/queries/folders; no hidden directive, slug downgrade or generated fake query URL.
- Invalid YAML, unknown schema version, oversize, unknown selected owner/ID, nested notebook ownership, symlink/alias/protected destination, read-only branch, stale source/config/head and destination collision: refuse with unchanged bytes/tree.
- Known-owner import retains every other owner, including unknown ones, byte-for-byte in the original source.
- No representable selection creates no file; duplicate apply never overwrites or auto-selects another filename; timeout/readback distinguishes unknown outcome from safe retry.
- Remote preview reads one snapshot; apply commits only the new outline; provider errors never convert stored data to empty.
- Detect inactive-repository and malformed legacy browser drafts; exact JSON export, discard confirmation/cancel, unchanged base/revision and no auto-merge/autosave/commit through retired endpoints.
- Old bookmark PUT and remote Changes document writes are rejected; old sidebar/forms disappear; metadata registry protection and rename handling continue to pass existing HTTP/MCP tests.

## Independent parent browser reality anchor

Update the existing disposable fixture to seed two repositories with identical `notes/shared` roots and paths, two outline documents per notebook, one ordinary note, one compilation and a legacy collection containing all target kinds.
Include an unknown legacy owner, a malformed-data variant and browser recovery-draft setup without touching real browser storage or user workspaces.
The fixture must use the current schema constant, actual built web/local server and printed readiness/PID/port/root records.
Retain a bounded `--smoke` mode and cleanup of only fixture-created paths.

1. Capture the existing New note, New compilation and note-editor chrome as the same-session desktop/mobile visual baseline.
2. From the native New menu create an Outline note; verify title/folder/status alignment and normal editor opening, then create a second independent outline.
3. Type an unlinked item, Enter a sibling, Tab a child, Shift+Tab promote it and Shift+Enter add an annotation; add children beneath both plain-text and link-containing items.
4. Repeat in raw mode, exercise undo/redo, switch live/raw and confirm one Markdown source rather than a lossy tree conversion.
5. Add internal links to an ordinary note/compilation and external HTTP(S); verify native navigation, editable link text and zero automatic media/preview requests.
6. Save locally, reopen/reload and inspect actual fixture bytes; separately test remote staging/commit through deterministic provider integration, without calling it a live-provider browser run.
7. Use Add to outline from current content with filled label/target; select existing/new destination, cancel once and exercise dirty-source/destination failure paths.
8. In repository B, activate identical-path links and repeat creation/insertion; verify A remains byte-identical.
9. Rename/move target and outline via actual file/folder UI; reopen and activate refs, then delete/restore the target without pruning Markdown.
10. Preview legacy import, inspect the exact retained position/query/folder report, cancel and assert no files; explicitly apply a partial import and verify original bytes and pending drafts remain.
11. Inspect malformed/stale/unknown-owner recovery errors and read-only controls; no rejected Add group or target-type form may reappear as a fallback.
12. Compare screenshots against step 1 at desktop and narrow touch width; evaluate consistent controls, field alignment, editor rhythm, focus return and readable hierarchy, not only overflow.

External opening may be verified by intercepted navigation/new-page intent to a disposable/local destination; no public website fetch is required.
Keep actual browser evidence, API readback, provider fixtures and human judgment distinctly labeled.

## Commands and process ownership

The following are implementation verification instructions, not commands run in this planning session.

```bash
pnpm --filter './packages/*' run build
pnpm test
pnpm build
pnpm lint
pnpm format:check
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
pnpm exec tsc --noEmit -p apps/local-server/tsconfig.json
node --check scripts/qa-bookmarks-fixture.mjs
node scripts/qa-bookmarks-fixture.mjs --smoke
```

If the fixture is renamed, update the last two commands and callers together.
Run targeted new and existing suites after each task before the final broad checks.
Use `MonitorCreate` for builds/long checks and persistent fixture servers; never use `&` or `nohup` for persistent processes.
Record the monitor ID, PID, port, fixture roots and owned browser session.
At completion use `MonitorStop`, close the owned browser session and verify the recorded PID/listener/roots are gone.
This planning session started no persistent process or browser session and needs no process cleanup.

## Claims and remaining gates

| Claim | Status |
| --- | --- |
| Clean specified upstream BASE before planning | Confirmed by Git status/HEAD inspection. |
| Four-document plan researched against actual source | Complete: exactly four allowed modified files; six ordered implementation tasks; 15 relative evidence links resolve; `git diff --check` clean; HEAD unchanged. |
| New outline tests/build/types/lint | Stage 1 passed as recorded above; later stages remain in progress. |
| New browser/UI/real provider evidence | Not run. |
| Human appropriateness of rejected collection | FAIL. |
| Human appropriateness of replacement outline UI | Unknown; parent/user review required after implementation. |
| Commit/push/CI/deployment/downstream | Stage commits are recorded in worker handoffs; no push/CI/deployment/downstream action performed by this worker. |

The retained legacy registry is an intentional compatibility boundary, not an unresolved duplicate outline store.
Partial import preserves data but does not reproduce active old query/exact-position behavior; that limitation must remain visible to the user.
No active-fidelity conversion or legacy archive deletion is authorized by this plan.

## Reflexive

- Discovery gap: presumed local-source/link-hook filenames were absent; actual adapter/component paths were found and recorded in the design seam table.
  Disposition: no implementation or behavior conclusion depends on the failed lookups; no new global rule needed.
- Authority update: parent delivered the user-approved Outline terminology while planning; the intermediate bookmark-document decision was replaced before finalization.
  Disposition: all owning artifacts now use general items and optional links; no full Workflowy scope was inferred.
- Historical feedback: functional tests and compact/no-overflow UI checks did not establish usability.
  Disposition: retain human FAIL and require direct native-UI screenshot/workflow comparison as a separate gate; do not relabel historical green checks as acceptance.
