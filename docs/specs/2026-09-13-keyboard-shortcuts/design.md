# Keyboard shortcuts design

## Approach

Add one `KeyboardShortcuts` component mounted by `AppContent`. It owns only leader-panel state and keyboard interpretation; application actions remain callbacks supplied by `AppContent`.

## Interfaces and data flow

- Inputs: active tab, write capability, navigation callback, new-note callback, and note-search focus callback.
- Output: calls existing actions rather than constructing routes or creating notes itself.
- Editable-context detection is centralized and includes native form controls, ARIA comboboxes, CodeMirror, and contenteditable elements.
- Command definitions are one ordered array used by both keyboard dispatch and rendered buttons so labels, disabled state, and behavior cannot drift.

## Trade-offs and risks

- A 2.5-second pending timeout is long enough to read a small list while short enough not to leave hidden keyboard state behind. The pinned `?` help mode removes the time limit when the user wants to read.
- A non-modal panel avoids blocking the workspace, but focus restoration and Escape handling are required.
- Platform detection affects only whether the opening chord is displayed as `Ctrl+Alt+K` or `Cmd+Option+K`; second keys remain layout-stable numbers and punctuation exposed by `KeyboardEvent.key`.

## Verification seam

Use a browser QA script against the production build. It will prove that plain `Ctrl+K` does not open the application leader, dispatch the Alt/Option chord, inspect the visible panel and active focus, traverse all four routes, open the new-note dialog, focus search, verify Settings, preserve browser/editor `Ctrl+K`, and test Escape/timeout behavior. Confirm the opening chord once in live Chrome because a headless page cannot model every browser-owned shortcut.
