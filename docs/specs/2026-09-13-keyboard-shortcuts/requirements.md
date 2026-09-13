# Keyboard shortcuts requirements

Status: revised and confirmed on 2026-09-14.

## Outcome

Provide fast, discoverable keyboard access to common GitHub Notes actions without breaking browser, operating-system, assistive-technology, or Markdown-editor behavior.

## Research synthesis

- WAI-ARIA recommends that shortcuts supplement normal keyboard navigation, avoid platform conflicts, and remain discoverable. `aria-keyshortcuts` exposes implemented shortcuts to assistive technology but does not implement them.
- WCAG 2.1.4 makes unmodified character shortcuts risky because speech input can trigger them accidentally. A modifier or explicit leader state avoids that class of failure.
- GitHub uses sequential navigation chords and a visible shortcut reference. Its command palette documents `Ctrl/Cmd+K` with an Alt/Option variant for Markdown editing, but live Chrome use showed that this product cannot rely on `Ctrl+K` because the browser can reserve it for omnibox search.
- VS Code's chord model is context-sensitive and shows pending chord state; contextual enablement is essential when editors, dialogs, or other controls own the keyboard.

Primary sources:

- https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- https://www.w3.org/TR/wai-aria-1.3/#aria-keyshortcuts
- https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
- https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts
- https://docs.github.com/en/get-started/accessibility/github-command-palette
- https://code.visualstudio.com/docs/configure/keybindings

## Required behavior

1. Shortcut navigation must call the application's existing `setActiveTab` path so Agent document save/leave checks remain authoritative.
2. No application shortcut may intercept typing in `input`, `textarea`, `select`, CodeMirror, or `contenteditable`, except the explicitly confirmed `Alt/Option+/` leader.
3. The command surface must contain a focused search field, remain open without a timer, and dismiss on `Escape`, outside click, or successful execution.
4. Commands unavailable in the current context must be visibly disabled and must not execute.
5. A keyboard help surface must list the current platform's notation and all active commands.
6. Navigation and actions must remain usable without shortcuts.
7. The command surface must have a visible, clickable Header entry so discoverability does not depend on memorizing a shortcut.

## Confirmed first command set

- `1` Notes
- `2` Agent System
- `3` Assets
- `4` Screen
- `N` New note when the workspace is writable
- `/` Focus note search when Notes is active
- `,` Settings
- `?` Keyboard help

All quick keys apply only while the empty command palette is visibly active; once the user types a query, printable keys enter text. There are no global bare-character shortcuts.

## Out of scope for the first iteration

- User-defined remapping
- Editing commands inside CodeMirror
- Destructive actions or direct commits
- Mobile hardware-keyboard-specific layouts

## Confirmed decisions

1. `Alt+/` on Windows/Linux and `Option+/` on macOS opens a searchable command palette outside the note editor. Inside the note editor it opens a local note-command leader instead of home navigation.
2. `Ctrl/Cmd+/` opens keyboard help outside editable contexts; the palette also exposes help as an action.
3. `Ctrl/Cmd+K` and `Ctrl+Alt+K` are removed from the application shortcut surface.
4. The palette has no automatic timeout and supports filtering, arrow navigation, Enter, outside-click dismissal, and `Escape` focus restoration.
5. The first release keeps `1–4`, uppercase `N`, `/`, `,`, and `?` as quick keys only while the palette query is empty.
6. A visible Header button opens the same palette.

## Open questions

None.
