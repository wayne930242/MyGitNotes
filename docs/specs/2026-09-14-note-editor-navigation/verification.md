# Note editor document panel verification

Verified on 2026-09-14 against the Core workspace production build.

## Requirements evidence

- Search, Outline, Frontmatter, notebook Assets, and single-file Git status share one right-side Document Tools panel.
- The panel uses compact icon tabs with accessible names and tooltips. Desktop docks it at the right edge; narrow mobile viewports use a right overlay drawer.
- Opening Outline preserves the Live or Source viewport and focuses the heading for the current visible line. `J/K` and arrow keys then smooth-preview headings; Enter or pointer activation confirms the jump.
- Leader then `F` focuses in-note search. Search selects matching text in Live and Source modes, reports the current/total result count, and supports next/previous traversal.
- The Git tab shows the current note path, branch, and the same clean/pending/saving state as the editor footer. Dirty local notes expose the existing two-click single-file restore; clean, saving, and read-only notes cannot restore.
- Assets use the existing Asset Library inside the panel. Escape closes a full-size asset preview before closing its parent panel.
- Frontmatter editing, status selection, tag completion, autosave, and read-only behavior remain unchanged inside the panel.
- The global command palette and Header navigation remain suspended while a note editor is open.

## Automated evidence

- `corepack pnpm vitest run apps/web/src/lib/note-navigation.test.ts`: passed current-line-to-heading selection and existing full-note search/outline parsing cases.
- `node scripts/qa-keyboard-shortcuts.mjs`: passed editor suspension, leader Find, search traversal, opening Outline without a viewport jump, current-heading focus, outline `J/K`, and Live/Source navigation.
- `node scripts/qa-mobile.mjs`: passed 320, 390, 430, 820, and 1440 pixel geometry, all five panel tabs, Frontmatter, Assets, layered preview Escape, and two-click single-file restore.
- `node scripts/qa-browser.mjs`: passed nested-folder creation with explicit folder autocomplete, Assets integration, layered Escape, and read-only controls.
- `node scripts/qa-note-statuses.mjs`: passed Frontmatter/status behavior through the new panel.
- `node scripts/qa-working-notes.mjs`: passed local/remote draft retention, merge/conflict boundaries, explicit commit, and storage-failure behavior.
- `corepack pnpm test`: passed 43 files and 219 tests, including the repaired pre-mounted Select coverage.
- `corepack pnpm build`: passed the standard five-package production build; only the existing non-blocking Vite chunk-size warning remains.
- `git diff --check`: passed.

## Visual evidence

- Desktop: `artifacts/qa/note-document-panel-desktop.png`
- 320-pixel mobile: `artifacts/qa/mobile-note-outline.png`

## Human check

Objective layout and interaction checks pass. Final subjective approval remains with the user after live use.
