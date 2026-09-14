# Note editor document panel specification

Revised and confirmed by the user on 2026-09-14.

## Observable contract

- Search, Outline, Frontmatter, notebook Assets, and single-file Git status render as mutually exclusive modes of one right-side document panel.
- One Document Tools toolbar control opens or closes the panel; its tabs switch modes. The editor-local leader still maps `F` to Search and `/` to Outline.
- Opening Outline preserves the document viewport. The active and focused outline row is the last heading at or before the editor's current visible line, or the first heading when the viewport precedes all headings.
- `J/K` and arrow keys change the active row and smoothly preview that heading in the document. Enter and pointer activation jump to the heading and close the panel.
- Search selection and result traversal continue to work in Live and Source modes from the side panel.
- Frontmatter editing, tag completion, locking, and autosave behavior remain unchanged inside the side panel.
- Asset browsing and mutation continue to use the existing Asset Library inside the panel; the full-size preview remains above it.
- The Git mode displays path, branch, and the same status used by the editor footer. Its restore action uses the existing two-click confirmation and `onRestoreFile(note.path)` boundary, and is disabled for clean, saving, or read-only files.
- Desktop and tablet dock the panel at the editor's right edge. Narrow mobile screens overlay it from the right, keep all five panel tabs visible, avoid horizontal overflow, and use touch-safe controls.
- Escape closes nested listboxes first, then the document panel, then the note.

## Applied precedent

- Craft treats Table of Contents, document search, attachments/tasks, and page information as modes of one document-specific sidebar rather than inserting separate surfaces into the document.
- Craft's iPhone flow opens this document panel from the top-right menu and switches its modes from controls at the top.
- Craft's 3.4.3 release added a visible-section indicator to its Table of Contents and tightened sidebar row spacing.

Sources: https://support.craft.do/en/introduction/navigation, https://support.craft.do/en/organize-and-find/search/in-document, https://www.craft.do/blog/craft-update-3-4-3

## Correctness strategy

- A pure unit test proves current-line-to-heading selection boundaries.
- Production-browser QA proves opening Outline does not change scroll position, focuses the current heading, and moves only after keyboard navigation.
- Existing browser QA proves Search, Frontmatter, Escape, Live/Source, and mobile behavior remain intact.
- Mobile geometry QA proves the overlay panel, tabs, inputs, and close controls remain inside a 320-pixel viewport.

The remaining human appropriateness question is whether the docked/overlay panel feels consistent with the existing editor after live use.
