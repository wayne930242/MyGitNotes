# Keyboard shortcuts and navigation verification

Verified on 2026-09-13 against the Core workspace.

## Requirements evidence

- Plain `Ctrl+K`, `Ctrl+Alt+K`, and `Ctrl/Cmd+F` remain untouched so Chrome keeps ownership of its browser shortcuts.
- `Alt+/` on Windows/Linux and `Option+/` on macOS opens the global searchable command palette only while no note is open. The same leader opens the local Find/Outline surface inside the note editor.
- The production-browser QA exercises search filtering, no-results state, arrow/Enter selection, `1` through `4`, New note, Notes search, Settings, help, Escape focus restoration, outside dismissal, persistent lifetime, and contextual command disablement.
- Live Chrome confirmed that a physical `Alt+/` opens the global palette, that the compact search field and action rows align with the existing workspace controls, and that opening a note suspends home navigation.
- Mobile browser QA covers the centered circular New note action, folder-path completion and creation, left-half swipe opening, and responsive sidebars on Agent, Assets, Settings, and Screen.
- Screen and folder-index browser QA cover Alt-wheel horizontal scrolling in Screen lanes and Kanban while retaining normal vertical scrolling.

## Automated evidence

- `node scripts/qa-keyboard-shortcuts.mjs`: passed.
- `node scripts/qa-mobile.mjs`: passed at 320, 390, 430, 820, and 1440 pixel widths, including interaction and remote-save checks.
- `node scripts/qa-screen.mjs`: passed native scrolling, Alt horizontal scrolling, dynamic lanes, sidebar behavior, and asset retry checks.
- `node scripts/qa-folder-index.mjs`: passed list, card, Kanban, folder, keyboard, mobile, locale, and read-only checks.
- `corepack pnpm test`: 42 test files passed, 216 tests passed.
- `corepack pnpm build`: passed for all five product packages.
- `git diff --check`: passed.

## Known non-blocking output

Vite continues to report its existing post-minification chunk-size warning for the lazy editor and main application bundles. It does not fail the production build and is outside this change's interaction scope.

## Human check

The objective visual and interaction checks pass. The final subjective appropriateness verdict remains with the user after the next live use; no automated check substitutes for that judgment.
