# Note editor search and outline verification

Verified on 2026-09-14 against the Core workspace production build.

## Requirements evidence

- A live Chrome session confirmed that `Alt+/` opens the local two-action note surface while an editor is open; the global command palette and Header navigation remain suspended.
- Leader then `F` focuses in-note search. Search selects matching text in both Live and Source modes, reports the current/total result count, and supports next/previous traversal.
- Leader then `/` opens the Markdown outline. `J/K` and arrow keys move the active heading and preview it with smooth scrolling; Enter confirms the jump.
- The outline recognizes ATX and setext headings, ignores fenced-code headings, follows unsaved content, and exposes an empty state.
- Escape dismisses editor-local surfaces before the note itself and preserves existing select/listbox Escape behavior.
- Desktop inspection confirmed that Find and Outline use the original compact toolbar-control language rather than a second oversized control system.
- Mobile inspection at 320 pixels confirmed a two-row editor toolbar, an in-bounds search bar, and an outline drawer no wider than 300 pixels without horizontal overflow.

## Automated evidence

- `corepack pnpm vitest run apps/web/src/lib/note-navigation.test.ts`: passed.
- `node scripts/qa-keyboard-shortcuts.mjs`: passed editor suspension, leader Find, search traversal, outline `J/K`, smooth Live navigation, and Source navigation.
- `node scripts/qa-mobile.mjs`: passed at 320, 390, 430, 820, and 1440 pixel widths, including the in-bounds search bar and 300-pixel-bounded mobile outline.
- Full test, build, and diff checks are recorded in the parent keyboard-shortcuts verification ledger.

## Human check

The implementation has passed objective layout and interaction inspection. Final subjective approval remains with the user after live use.
