# Note editor search and outline requirements

Status: confirmed by the user on 2026-09-14.

## Outcome

Long notes must remain usable without leaving the note editor: readers and authors can search the complete current note and navigate its Markdown heading structure.

## Required behavior

1. The editor uses the existing `Alt/Option+/` leader so browser-reserved `Ctrl/Cmd+F` remains untouched: leader then `F` opens and focuses in-note search; leader then `/` opens the outline.
2. Search is case-insensitive, reports the current result and total count, and supports next/previous navigation with Enter and Shift+Enter.
3. Search, Outline, Frontmatter, notebook Assets, and single-file Git status share one document-side-panel surface. One pointer-accessible Document Tools button opens it from the editor toolbar; the panel provides direct tabs between all five modes without duplicating those controls in the toolbar.
4. The outline is derived from ATX and setext Markdown headings, ignores headings inside fenced code, reflects unsaved edits, and jumps to the corresponding source line. Opening it selects and focuses the heading that contains the current viewport without moving the document. `J/K` or arrow keys move focus with a smooth preview jump; Enter or pointer activation confirms the selected heading.
5. Search and outline work in both Live and Source editor modes and in read-only notes.
6. Escape closes an open nested editor surface before closing the note.
7. While the note editor is open, the underlying main navigation and application command palette are suspended; the same leader opens only the local note-command surface.
8. Desktop and tablet layouts dock the document panel on the right. On narrow mobile screens the same surface becomes a right-side overlay drawer, retaining the panel tabs and leaving the editor toolbar usable.
9. Asset browsing, upload, move, delete, preview, copy-reference, and insert behavior remain available from the panel; the full-size asset preview may remain modal above it.
10. The Git mode shows the current file path, branch, and save/dirty/read-only state. It owns the existing two-step single-file restore from Git HEAD; clean and read-only files cannot trigger restore.

## Non-goals

- Cross-note or repository-wide content search.
- Search-and-replace.
- Persistent outline expansion state.
