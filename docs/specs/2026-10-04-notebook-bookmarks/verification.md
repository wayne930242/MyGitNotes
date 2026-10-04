# Outline notes — verification ledger

Planning baseline: `/home/weihung/github-notes`, clean HEAD `ac26edfe69120fac9eff904b5cb7f53e76966588`.
Status: implementation in progress; stages 1–4 (native kind, bounded editing, creation/list/insertion and atomic relocation) verified in upstream; tasks 5–6 and independent parent browser QA are not complete.
Parent review of immutable stages 1–3 found an outline-only R2 reference-guard gap and adjacent drag duplication; both are repaired and independently anchored in the post-stage-4 checkpoint below.
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
| R1 Native Outline type, multiple documents, portable `.outline.md`, no hidden registry | Stage 1 parser/classifier/local HTTP/GitHub/GitLab tests and stage 3 native multi-document creation/browser checks pass; final integrated parent matrix remains. | unknown |
| R2 General text/link items, children and annotations, non-destructive deletion | Stage 2 source tests and actual browser subtree edits retain annotations/children; final mixed-link/delete lifecycle matrix remains. | unknown |
| R3 Enter sibling, Shift+Enter annotation, Tab hierarchy in live/raw, undo/IME/accessibility | Stage 2 shared-source and mounted CM/textarea tests plus real raw-browser undo/redo pass for covered scenarios; final integrated matrix and independent parent journey remain. | unknown |
| R3a Same-document live-editor subtree dragging, drop/nesting feedback, cancel/read-only, undo/redo | Stage 2 real mouse reorder/nesting, full annotation+child preservation, cancel, own-descendant refusal and one-step undo/redo observed; independent parent and real-browser read-only checks remain. | unknown |
| R4 Existing UI consistency, native save state, no old forms/Saved badge | Stage 3 reuses native New note fields and WorkspaceDialog/Select/Button, with desktop/mobile captures; legacy UI intentionally awaits task 5 retirement and independent visual comparison remains. | unknown |
| R5 Internal/external optional links, opener isolation, no preview fetching, repository scope | Mounted explicit-link/editable-text isolation and no-YouTube-preview checks pass; stage 3 scoped completion and real A/B equal-path insertion isolation pass; full integrated link matrix remains. | unknown |
| R6 Add current content with filled label/target into selected/new outline | Stage 3 mounted dirty/recovered-body insertion, source-save failure, cancel, read-only, route/repository/root races and failed-navigation tests pass; real existing/new destination and compilation-source browser checks pass; independent parent matrix remains. | unknown |
| R7 All note lifecycle/local+remote/kind isolation and compilation unaffected | Stage 1 catalog, local create/save/copy/delete/restore, GitHub/GitLab create/save guards and draft facets pass; full move/UI lifecycle remains unverified. | unknown |
| R8 Atomic rename/move references and non-destructive delete/restore | Stage 4 shared source-preservation, local HTTP stale/rollback, GitHub tree/GitLab actions and single-snapshot shell movement pass; deletion/copy retain references/bytes. Independent final file/folder browser journey remains. | unknown |
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
- At that checkpoint no persistent fixture/browser had been started; the later stage 2 evidence below supersedes its then-unverified drag/textarea checks, not the unknown human verdict.

## Stage 2 execution checkpoint

Implemented source seams: `lib/outline-editing.ts`, `lib/outline-raw-history.ts`, native `MarkdownEditor`/`LiveMarkdownEditor`, `live-markdown/outline-commands.ts` and `outline-drag.ts`.
The transient Lezer ranges and inline handle decorations derive entirely from the current Markdown document; there is no separately editable tree.
The raw adapter has a bounded outline-only history so programmatic source transactions participate in undo/redo alongside subsequent typed edits.
Annotations, children and unselected siblings remain attached correctly when splitting, indenting, promoting or dragging a subtree.
Ordinary-note keyboard bindings are unchanged.
Live/raw EN/zh-TW hints and native toolbar indentation actions are present.
Outline URL-only YouTube links remain links in both rendering paths; editable link text is not stolen by the workspace navigation capture handler.

### Automated evidence

- Final full regression after the scope review: `/tmp/outline-stage2-full-tests-final.log`, **250 files / 1831 tests passed**.
- Final production build: `/tmp/outline-stage2-build-final.log`, exit 0; pre-existing Vite chunk/dynamic-import warnings remain informational.
- Final lint/format: `/tmp/outline-stage2-lint-final.log`, `/tmp/outline-stage2-format-final.log`, both exit 0.
- Final fresh web/server compilers: `/tmp/outline-stage2-webtypes-final.log`, `/tmp/outline-stage2-servertypes-final.log`, both exit 0.
- Active LSP checked 12 changed files; its existing language-server instance still reported four stale `@mygitnotes/core/outline` resolution diagnostics and eight silent/inconclusive paths. This is not a clean-LSP claim; current package builds and fresh compiler processes independently passed.
- Earlier expected/red iterations remain in `/tmp/outline-stage2-mounted*.log`; `/tmp/outline-stage2-mounted6.log` records the green bounded suite. The earlier `/tmp/outline-stage2-full-tests.log` had two completion/no-preview assertion failures; these were investigated and corrected before the green final run.
- `git diff --check` passed. Final full command monitor exited with `tests=0 build=0 lint=0 format=0 web=0 server=0`.

### Real browser evidence (worker, not human acceptance)

- Served the existing built `scripts/qa-bookmarks-fixture.mjs` under Monitor 17: PID `629885`, port `32887`, roots `/tmp/mygitnotes-bookmarks-home-hXuAHm` and `/tmp/mygitnotes-bookmarks-other-c7sNng`.
- Created `notes/shared/editor.outline.md` in both fixture notebooks using native POST `/api/notes`, explicit `createOnly: true`, `noCommit: true`; no user-workspace data or credentials were used.
- Owned headless browser session: `outline-stage2`; route `/notebooks/a/notes/editor.outline.md`.
- Used real `agent-browser mouse move/down/up`, not synthetic `dispatchEvent`, to move `First` with its `Annotation **one**` and `Child` after `Second`.
- Observed visible `data-outline-drop=after`, indent 0, then one Control+Z restored the complete original source order and one Control+Y restored the move.
- Raw mode readback after redo: `Second`, `First` + annotation + child, `Last`, retaining source formatting.
- In the real textarea, Shift+Enter inserted `Raw annotation`; Enter added `Raw item`; Tab nested it and Shift+Tab promoted it; Control+Z/Control+Y each undid/redid the whole promotion.
- Escape then Tab moved actual browser focus from the textarea to the native Restore button.
- Real pointer child-drop showed `data-outline-drop=child`, indent 2; Escape canceled without a change, then a new drop moved the complete `First` subtree beneath `Last`.
- Control+Z/Control+Y undid/redid that nesting in one step, and raw mode confirmed two-space nesting and exact `**one**` annotation source.
- Dragging `First` into its own `Child` showed no valid drop marker and changed no source.
- Native local autosave HTTP readback showed the edited outline in repository A and byte-identical original outline content in repository B: `/tmp/outline-stage2-readback.json`.
- Added a bare YouTube URL through real raw-editor typing and returned to live mode: zero media-preview/image-source nodes and zero captured YouTube requests.
- Screenshots: `/tmp/outline-stage2-drag-preview.png`, `/tmp/outline-stage2-nest-preview.png`, `/tmp/outline-stage2-nested.png`, `/tmp/outline-stage2-raw-keys.png`, `/tmp/outline-stage2-mobile-final.png`, `/tmp/outline-stage2-desktop-final.png`.
- Final built-widget check also moved the complete `Last` subtree before `Second` with a visible `before`, indent 0 marker and restored it with one Control+Z.
- Exact final HTTP assertions/evidence: `/tmp/outline-stage2-browser-evidence.json`; repository A source matched the expected nested/annotated Markdown and B matched the untouched original.
- Cleanup: named browser closed (PID `634652`, CDP port `41013`), Monitor 17 stopped; both fixture roots, both PIDs and listeners `32887`/`41013` were confirmed absent. Evidence: `/tmp/outline-stage2-cleanup.log`.
- A first gutter attempt placed handles far from the centered card; inline zero-width widgets now attach handles to the actual item marker. A narrow-layout check also exposed global icon-button minimum sizing; the scoped marker sizes were corrected, retaining native toolbar alternatives for touch.

This is **not** the final parent fixture-ready production freeze.
At the stage 2 checkpoint, tasks 3–6 remained; stage 3 execution is recorded below.
Tasks 4–6 still remain: full relocation/hosted shell gap; explicit import/recovery followed by old UI/write retirement; final two-repo fixture/docs/independent browser matrix.
The rejected bookmark UI is intentionally still mounted until recovery exists; it is not accepted or considered the new outline UI.
Human appropriateness remains unknown.

## Stage 3 execution checkpoint

Native creation/listing now exposes New outline and Outlines beside existing note/compilation controls.
The same creation dialog retains folder, status/tags, collision, permission and local-worktree/remote-staging behavior; outlines bypass normal-note templates and use `.outline.md`.
`useOutlineActions`, `AddToOutlineDialog` and `useOutlineInsertion` coordinate one repository-qualified request; only the initialized, mounted editor appends the ordinary Markdown link to its current body.
No append API or second document model exists.
Requests remain unarmed until guarded navigation succeeds and are canceled on route/repository/root changes, permission loss, cancellation or unmount.
A pending recovery draft is restored/discarded explicitly before insertion and can cancel the insertion independently.
The normal editor lifecycle owns subsequent persistence, including remote staging without a forced source commit.
Completion is scoped to the outline's notebook with `kind: all`; ordinary-note completion scope is unchanged.

### Final automated evidence

- `/tmp/outline-stage3-full-tests-final.log`: **256 files / 1870 tests passed**.
- `/tmp/outline-stage3-build-final.log`: production build passed; existing Vite chunk/dynamic-import warnings remain informational.
- `/tmp/outline-stage3-lint-final.log`, `/tmp/outline-stage3-format-final.log`: both passed.
- `/tmp/outline-stage3-webtypes-final.log`, `/tmp/outline-stage3-servertypes-final.log`: fresh compiler processes both passed.
- Final monitor 10 exited `tests=0 build=0 lint=0 format=0 web=0 server=0`; no product-source edit followed this run.
- Active LSP probes covered 17 changed production paths, reporting zero error diagnostics but 17 silent/inconclusive outcomes, not confirmed clean coverage.
- `/tmp/outline-stage3-mounted-final.log`: actual mounted CodeMirror/raw insertion, recovery/cancel, CRLF caret/undo/redo and dialog focus tests passed (8 tests).
- Earlier logs retain the discovered HTML-comment EOF failure (`outline-stage3-target1.log`) and absent JSDOM native-dialog methods (`outline-stage3-target-final.log`); those were corrected before the final green suite.
- Runtime-discovered fixes: the shared serializer preserves outline body whitespace so an empty `- ` remains editable; ordinary-note trimming stays unchanged.
  `WorkspaceDialog` no longer steals the succeeding creation input's autofocus; ordinary dismissal still restores its trigger.
  Live imperative insertion uses CodeMirror Text length for CRLF-safe selection and an isolated outline history transaction.

### Actual worker browser evidence

- Initial built fixture: Monitor 7, PID `786186`, port `46277`, roots `/tmp/mygitnotes-bookmarks-home-Fxvh0Y` and `/tmp/mygitnotes-bookmarks-other-FcWAN6`; named browser `outline-stage3`, PID `786394`, CDP port `38247`.
- Created `Native plan` and `Second plan` through the native New menu; Outlines counted/listed both while ordinary-note results remained separate.
- Actual raw keys produced `- First`, same-item `Annotation`, and nested `Second`; native close/save/reopen retained them.
- From `Home guide`, Add to outline selected Second plan and inserted its ordinary relative link through the mounted live editor.
- In B, created the identical `notes/shared/second-plan.outline.md` via native creation; the chooser listed only B's outline.
  Cancel wrote no link; the subsequent insertion used `Other guide`, and A's source remained byte-identical.
  Readback: `/tmp/outline-stage3-readback.json`, prior A snapshot `/tmp/outline-stage3-a-before.json`.
- From B's compilation, Add to outline → New outline reused native creation and stored `- [QA compilation](reading.compilation.yml)`.
- Desktop/native baseline and narrow captures: `/tmp/outline-stage3-new-note-desktop.png`, `/tmp/outline-stage3-new-outline-desktop.png`, `/tmp/outline-stage3-editor-desktop.png`, `/tmp/outline-stage3-chooser-desktop.png`, `/tmp/outline-stage3-chooser-mobile.png`, `/tmp/outline-stage3-new-outline-mobile.png`.
- Red browser evidence exposed a new empty outline readback of `\n-\n` (lost space) and the prior chooser's Add to outline button stealing new-dialog focus.
- Final rebuilt fixture after all production changes: Monitor 11, PID `855175`, port `39771`, roots `/tmp/mygitnotes-bookmarks-home-3Bhzue` and `/tmp/mygitnotes-bookmarks-other-qtkO21`; browser `outline-stage3-final`, PID `855322`, CDP port `33515`.
- Real Add to outline → New outline left `document.activeElement` on the native title INPUT; `/tmp/outline-stage3-focus-final.png`.
- Native creation returned exact empty body `\n- \n`; `/tmp/outline-stage3-blank-final.json`.
  With the caret on that marker, actual live typing/Shift+Enter/Enter/Tab produced the annotation and nested child.
- Final guarded Add to outline inserted one Home guide link; exact saved body readback passed in `/tmp/outline-stage3-final-readback.json`, with `/tmp/outline-stage3-insertion-final.png`.
- Both named browsers were closed, both fixture monitors stopped, and every recorded PID, listener and temporary root was asserted absent: `/tmp/outline-stage3-cleanup1.log`, `/tmp/outline-stage3-cleanup-final.log`.

This is a stage 3 checkpoint, not the final fixture-ready production freeze.
Tasks 4–6 remain untouched; their required work is unchanged.
Old bookmark position/sidebar/forms and write APIs intentionally remain until explicit import/recovery exists.
Human appropriateness remains **unknown**, and the historical bookmark UI **FAIL** remains in force.
No push, live-provider mutation, downstream edit, deployment, user-notebook edit or shutdown occurred.

## Stage 4 execution checkpoint

Hosted shell `mv` now snapshot-reads Markdown sources and incoming refs, rebases them through the shared `relocateLinks`, and merges edits by final destination with the existing SHA moves/deletions and legacy relocation before one `folders` receipt.
Overwritten destinations cannot replace the moved source with their old bodies.
Copy semantics, deletion non-pruning, reserved metadata protections, 200-change/5-MiB commit bounds and snapshot-pinned provider writes remain intact; reference scanning uses the existing 32-MiB workspace-snapshot bound.
Shared rewriting now handles escaped closing brackets and protects closed/unfinished fences, nested indented code, inline code, CRLF and frontmatter without reserializing source.
The existing Marked lexer supplies only transient block-line protection ranges, not an outline registry or separate document model.

- Red evidence: `/tmp/outline-stage4-red.log`, `/tmp/outline-stage4-nested-red.log`, `/tmp/outline-stage4-fence-red.log` exposed omitted shell refs, escaped labels, unfinished/nested code, and a longer fence swallowing subsequent prose.
- Provider-fixture fidelity correction: GitHub now models non-fast-forward ref rejection; GitLab seed files initialize their original last-commit versions.
  A concurrent GitHub move may create an unreachable commit object, but the branch/tree stays at the concurrent edit; the test does not claim no commit object was created.
- Final regression: `/tmp/outline-stage4-full-tests-final2.log`, **257 files / 1902 tests passed**.
- Final build, lint, format and fresh web/server compilers passed: `/tmp/outline-stage4-{build,lint,format,webtypes,servertypes}-final.log`.
  Monitor 8 exited `tests=0 build=0 lint=0 format=0 web=0 server=0`; existing Vite informational warnings remain.
- New-test lint separately passed in `/tmp/outline-stage4-newtest-lint.log`; active LSP checked eight paths with zero diagnostics but eight inconclusive push-only outcomes, not clean coverage.
- Actual local HTTP test starts `createApp` on an ephemeral loopback server, moves the target, outline and containing folder, checks exact CRLF bytes/incoming links, refuses a stale move, retains refs after deletion and leaves another notebook untouched.
- Local fault injection restores moved note, outline and legacy bookmark bytes after the second write fails.
- GitHub/GitLab tests assert directory-destination, source/target, folder and same-repository cross-notebook moves; overwrite precedence; pinned reads; branch races; count limits; copy/deletion behavior; and one successful commit per move.
- Existing compilation, file/folder and legacy bookmark relocation suites pass in the full run.
- All runtime servers belong to test fixtures and close/remove their roots in teardown.
  No persistent browser/server, live-provider write, user-note change, push or downstream operation was started for stage 4.

| Stage 4 contract | Evidence | Result |
| --- | --- | --- |
| Hosted mv merges source, incoming and legacy updates in one paired snapshot commit | `outline-relocation.test.ts` GitHub/GitLab cases and `bookmark-relocation.test.ts` | pass |
| Native file/folder source/target moves and deletion/copy semantics | Shared planner cases plus actual local/remote HTTP adapter tests | pass |
| Code, escaped labels, reference definitions, annotations, hierarchy and CRLF survive relocation | Executed source-preserving cases, including unfinished/nested code and longer closing fences | pass |
| Stale/racing moves and local late failure preserve recoverable bytes | Provider branch-race cases, local HTTP stale case, bookmark/outline rollback test | pass |
| Final independent browser lifecycle and human appropriateness | Parent journey still pending; no new human verdict | unknown |

Tasks 5–6 remain untouched.
The parent-reported R2 outline-reference safety and adjacent drag duplication findings are not covered by stage 4 completion and must be repaired before final delivery.

## Post-stage-4 parent-review corrections

- `OUTLINE-R1-F001`: reference safety now uses dedicated `scanNotebookMarkdownNotes` / `RemoteSource.markdownNotes` enumeration including outlines; ordinary `scanNotebookNotes` / `notes` browsing stays ordinary-only.
  Actual local scanning and actual hosted GitLab fixture scanning each reject no-force deletion of an outline-only R2 reference.
  The loopback bucket observes zero DELETE requests and retains the object; no live R2 operation occurred.
- `OUTLINE-R1-F002`: `moveOutlineItem` coalesces a same-offset removal/insertion into one replacement.
  Adjacent after/before no-op drops leave exact source unchanged, while legitimate adjacent child placement changes indentation once without duplicating the item, its annotation or descendants.
  LF/CRLF, EOF with/without final newline, trailing prose, actual mounted pointer finish and one-step undo/redo pass.
- Red anchor `/tmp/outline-review-fixes-red.log` reproduced six failures before production fixes.
  Targeted `/tmp/outline-review-fixes-target1.log`: 39 tests passed, including mounted CodeMirror pointer gestures and provider-not-called deletion assertions.
- Full regression `/tmp/outline-review-tests.log`: **257 files / 1909 tests passed**.
  Build, lint, format, fresh web/server/MCP compilers passed in `/tmp/outline-review-{build,lint,format,webtypes,servertypes,mcptypes}.log`.
  Monitor 12 exited `tests=0 build=0 lint=0 format=0 web=0 server=0 mcp=0`.
- Active LSP checked eight changed paths; six were silent/inconclusive and three diagnostics on two MCP paths retained obsolete core declarations despite the successful package build and fresh MCP compiler.
  These were recorded as stale false positives, not suppressed in source or claimed as clean LSP coverage.

### Actual adjacent-pointer browser check

- Fresh built disposable fixture: monitor 13, PID `945116`, port `43921`, roots `/tmp/mygitnotes-bookmarks-home-gOo0wF` and `/tmp/mygitnotes-bookmarks-other-YoR06j`.
  Owned headless browser session `outline-review-fixes`, Chromium PID `956748`, CDP port `34427`.
- Seeded only fixture A/B `notes/shared/adjacent.outline.md` through native create-only/no-commit HTTP with Parent → Existing child, adjacent Other + `annotation **keep**` + Nested, then trailing Prose.
- Real `agent-browser mouse move/down/up` dragged Other after Parent.
  Visible `after`, indent 0 feedback appeared and the exact CodeMirror source stayed unchanged.
- A second real gesture dropped Other as Parent's child.
  Visible `child`, indent 2 feedback appeared; the complete subtree nested once and trailing prose remained outside it.
  One actual Control+Z restored the original source; one Control+Y restored nesting without duplication.
- Native Close note flushed the editor; `/tmp/outline-review-browser-readback.json` exact-content assertions confirmed A's nested subtree and B's unchanged original.
- Screenshots: `/tmp/outline-review-adjacent-noop-preview.png`, `/tmp/outline-review-adjacent-child-preview.png`, `/tmp/outline-review-adjacent-final.png`.
  The final pixels were inspected; this functional correction is not human acceptance of the replacement UI.
- Browser closed and monitor stopped; both PIDs/listeners/temporary roots were asserted absent in `/tmp/outline-review-cleanup.log`.

| Review correction | Evidence | Result |
| --- | --- | --- |
| Outline-only local/hosted R2 refs block no-force deletion, without broadening ordinary browse | Actual scanners + loopback bucket zero-DELETE assertions in `r2-assets.test.ts` | pass |
| Adjacent no-op and legitimate child drops retain one exact subtree | Source matrix, mounted pointer tests and actual browser gesture/readback | pass |
| Whole child move remains one undoable/redoable transaction | Mounted keys and actual Control+Z/Control+Y source assertions | pass |

Tasks 5–6 and the final independent parent browser journey remain incomplete.

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
| New outline tests/build/types/lint | Stages 1–4 and both parent-review fixes passed as recorded above; tasks 5–6 remain. |
| New browser/UI/real provider evidence | Worker disposable local-browser stages 2–3 recorded above; independent parent, human appropriateness and live-provider evidence not claimed. |
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
