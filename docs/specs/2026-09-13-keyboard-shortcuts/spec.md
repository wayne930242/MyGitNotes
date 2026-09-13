# Keyboard shortcuts specification

Confirmed by the user on 2026-09-13.

## Observable contract

- Outside editable controls, `Ctrl+K` on Windows/Linux and `Cmd+K` on macOS opens a compact leader panel.
- Inside inputs, textareas, selects, CodeMirror, and contenteditable regions, the primary chord is untouched. `Ctrl+Alt+K` on Windows/Linux and `Cmd+Option+K` on macOS opens the panel instead.
- The panel lists every command, its second key, and whether it is currently unavailable. It receives focus when opened and restores prior focus when dismissed.
- The pending panel dismisses after 2.5 seconds or immediately with `Escape`. Pressing `?` pins the help view until explicitly dismissed.
- While the panel is open: `1` Notes, `2` Agent System, `3` Assets, `4` Screen, `N` New note, `/` note search, `,` Settings, and `?` keyboard help.
- Navigation uses `setActiveTab`, preserving Agent save/leave checks. Disabled commands do not run and leave the panel open.
- New note is disabled in read-only workspaces. Search is disabled outside Notes. No destructive command is present.
- Clicking an enabled panel item performs the same action as its second key.
- The standard mouse/touch controls remain available; no bare-character global shortcut is introduced.

## Compatibility and non-goals

- Sequential chords are shown visibly and are not encoded as one `aria-keyshortcuts` token.
- The panel is a non-modal dialog layered above the workspace; it does not add a backdrop or trap focus.
- User remapping, editor formatting shortcuts, fuzzy command search, and commit/delete commands are out of scope.

## Applied standards and precedents

- WAI keyboard guidance and WCAG 2.1.4: avoid conflicting bare character shortcuts and preserve discoverability.
- WAI-ARIA `aria-keyshortcuts`: do not mislabel a sequential chord as a single shortcut.
- GitHub Command Palette: preserve Markdown `Ctrl/Cmd+K` and use the Alt/Option variant in editing contexts.
- VS Code chords: display pending chord state and apply contextual enablement.

See source URLs and synthesis in [requirements.md](requirements.md).

## Correctness strategy

- Browser QA proves opening, dismissal, timeout, navigation, contextual actions, editor conflict handling, focus transfer, and disabled commands through real keyboard events.
- Existing application tests and full build verify route/save behavior and type compatibility.
- Human appropriateness check: confirm that the compact panel's size, location, and command labels feel clear in the live preview.
