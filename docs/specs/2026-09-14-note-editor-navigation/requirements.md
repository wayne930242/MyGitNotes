# Note editor search and outline requirements

Status: confirmed by the user on 2026-09-14.

## Outcome

Long notes must remain usable without leaving the note editor: readers and authors can search the complete current note and navigate its Markdown heading structure.

## Required behavior

1. The editor uses the existing `Alt/Option+/` leader so browser-reserved `Ctrl/Cmd+F` remains untouched: leader then `F` opens and focuses in-note search; leader then `/` opens the outline.
2. Search is case-insensitive, reports the current result and total count, and supports next/previous navigation with Enter and Shift+Enter.
3. The editor toolbar exposes pointer-accessible Search and Outline buttons.
4. The outline is derived from ATX and setext Markdown headings, ignores headings inside fenced code, reflects unsaved edits, and jumps to the corresponding source line. `J/K` or arrow keys move focus with a smooth preview jump; Enter confirms the selected heading.
5. Search and outline work in both Live and Source editor modes and in read-only notes.
6. Escape closes an open nested editor surface before closing the note.
7. While the note editor is open, the underlying main navigation and application command palette are suspended; the same leader opens only the local note-command surface.
8. The layout remains usable on narrow mobile screens.

## Non-goals

- Cross-note or repository-wide content search.
- Search-and-replace.
- Persistent outline expansion state.
