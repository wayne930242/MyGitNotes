# Keyboard shortcuts requirements

Status: confirmed on 2026-09-13.

## Outcome

Provide fast, discoverable keyboard access to common GitHub Notes actions without breaking browser, operating-system, assistive-technology, or Markdown-editor behavior.

## Research synthesis

- WAI-ARIA recommends that shortcuts supplement normal keyboard navigation, avoid platform conflicts, and remain discoverable. `aria-keyshortcuts` exposes implemented shortcuts to assistive technology but does not implement them.
- WCAG 2.1.4 makes unmodified character shortcuts risky because speech input can trigger them accidentally. A modifier or explicit leader state avoids that class of failure.
- GitHub uses sequential navigation chords and a visible shortcut reference. Its command palette uses `Ctrl/Cmd+K` outside Markdown editing, but changes to `Ctrl+Alt+K` or `Cmd+Option+K` while editing because `Ctrl/Cmd+K` inserts a Markdown link.
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
2. No application shortcut may intercept typing in `input`, `textarea`, `select`, CodeMirror, or `contenteditable`, except an explicitly confirmed editor-safe palette chord.
3. A pending leader must be visible, dismiss on `Escape`, and expire after a short timeout.
4. Commands unavailable in the current context must be visibly disabled and must not execute.
5. A keyboard help surface must list the current platform's `Ctrl` or `Cmd` notation and all active commands.
6. Navigation and actions must remain usable without shortcuts.
7. Sequential chords must not be misrepresented as a single `aria-keyshortcuts` token.

## Confirmed first command set

- `1` Notes
- `2` Agent System
- `3` Assets
- `4` Screen
- `N` New note when the workspace is writable
- `/` Focus note search when Notes is active
- `,` Settings
- `?` Keyboard help

All second keys apply only while the leader/palette is visibly active; there are no global bare-character shortcuts.

## Out of scope for the first iteration

- User-defined remapping
- Editing commands inside CodeMirror
- Destructive actions or direct commits
- Mobile hardware-keyboard-specific layouts

## Confirmed decisions

1. `Ctrl/Cmd+K` opens a compact visible leader panel; it is not searchable in the first iteration.
2. Editing contexts retain their normal `Ctrl/Cmd+K` behavior and use `Ctrl+Alt+K` / `Cmd+Option+K` for the leader panel.
3. The first release includes `1–4`, New note, search, Settings, and keyboard help.

## Open questions

None.
