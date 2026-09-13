# Keyboard shortcuts design

## Approach

Keep one `KeyboardShortcuts` component mounted by `AppContent`. `AppContent` owns only the surface mode so the Header button can open it; the component owns query, selection, focus restoration, outside dismissal, and keyboard interpretation. Application actions remain callbacks supplied by `AppContent`.

## Interfaces and data flow

- Inputs: active tab, write capability, controlled surface mode, mode-change callback, navigation callback, new-note callback, and note-search focus callback.
- Output: calls existing actions rather than constructing routes or creating notes itself.
- Header receives one `onOpenCommands` callback; it does not know command definitions or keyboard rules.
- Editable-context detection is centralized and applies to the help chord. The shell owns `Alt/Option+/` only while no note is open; the editor then owns the same leader locally so background navigation cannot interrupt editing.
- Command definitions are one ordered array used by filtering, quick-key dispatch, arrow selection, and rendered buttons so labels, disabled state, and behavior cannot drift.

## Trade-offs and risks

- A searchable palette provides more depth than the former timed leader without distributing command knowledge into Header or route components.
- A controlled mode is a small interface cost, but it avoids imperative refs and custom DOM events while allowing both keyboard and Header entry points.
- A non-modal panel avoids blocking the workspace; outside-click dismissal, Escape focus restoration, and active-option semantics keep interaction predictable.
- Quick keys only apply before query entry. Uppercase `N` avoids stealing a lowercase search beginning with “n”.

## Verification seam

Use a browser QA script against the production build to exercise both entry points, search filtering, no results, arrows and Enter, empty-query quick keys, help, outside click, Escape and focus restoration, contextual disablement, and all existing actions. Confirm `Alt+/` once in live Chrome because a headless page cannot model every browser-owned shortcut.

The human final check is whether the resulting one-chord, searchable interaction feels materially easier than the retired triple-modifier timed leader.
