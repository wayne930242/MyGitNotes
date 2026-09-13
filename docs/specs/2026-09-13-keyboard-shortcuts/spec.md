# Keyboard shortcuts specification

Revised design confirmed by the user on 2026-09-14.

## Observable contract

- `Alt+/` on Windows/Linux and `Option+/` on macOS opens a searchable command palette outside the note editor. A visible Header button opens the same surface.
- `Ctrl/Cmd+/` opens keyboard help outside editable controls. `Ctrl/Cmd+K` and `Ctrl+Alt+K` remain untouched.
- The palette contains a focused text field, filters commands by localized label or stable command id, and exposes a no-results state.
- Arrow keys move through enabled filtered commands and `Enter` executes the active command. Pointer selection executes the same command.
- The palette remains open until `Escape`, outside click, or successful execution. `Escape` restores prior focus.
- While the palette query is empty: `1` Notes, `2` Agent System, `3` Assets, `4` Screen, uppercase `N` New note, `/` note search, `,` Settings, and `?` keyboard help. Printable keys otherwise enter the query.
- Navigation uses `setActiveTab`, preserving Agent save/leave checks. Disabled commands do not run and leave the panel open.
- New note is disabled in read-only workspaces. Search is disabled outside Notes. No destructive command is present.
- Clicking an enabled panel item performs the same action as its second key.
- The standard mouse/touch controls remain available; no bare-character global shortcut is introduced.
- While the note editor is open, home navigation is suspended and the same leader opens the editor-local Find/Outline commands described in the note-editor-navigation specification.

## Compatibility and non-goals

- The panel is a non-modal dialog layered above the workspace; it does not add a backdrop or trap focus.
- User remapping, fuzzy ranking, global bare-character shortcuts, and commit/delete commands are out of scope.

## Applied standards and precedents

- WAI keyboard guidance and WCAG 2.1.4: avoid conflicting bare character shortcuts and preserve discoverability.
- WAI-ARIA `aria-keyshortcuts`: do not mislabel a sequential chord as a single shortcut.
- Google Docs Tool Finder: use `Alt/Option+/` for a browser-first searchable action surface.
- GitHub Command Palette: provide a searchable, clickable surface and avoid its documented browser-conflict risk by leaving the K chords unused.
- Gmail, Jira, and Linear: keep shortcut help independently discoverable, while avoiding default global character-only chords.

See source URLs and synthesis in [requirements.md](requirements.md).

## Correctness strategy

- Production-build browser QA covers the clickable entry, filtering, no-results state, arrow/Enter navigation, quick keys, persistent lifetime, dismissal paths, focus restoration, help chord, editor suspension, and contextual disablement. A live Chrome check separately confirms that the physical `Alt+/` chord reaches the application.
- Existing application tests and full build verify route/save behavior and type compatibility.
- Human appropriateness check: confirm that the compact panel's size, location, and command labels feel clear in the live preview.
