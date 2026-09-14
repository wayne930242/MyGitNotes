# Dynamic Lane Create Note Action — Specification

Status: approved
Approved at: 2026-09-14
Approved from: 適合

## Observable Contract

1. **Header Action Button**:
   - Every dynamic lane in `ScreenPage` displays a `<Button>` with `<Plus size={16} />` in its actions bar (alongside query toggle, view switchers, and study button).
   - The button has an accessible label `t('screen.createNoteInLane')` and title indicating creation within that specific lane.
   - The button is disabled when `disabled` prop is true (e.g. read-only or during active operations).

2. **Empty State Action Button**:
   - When a dynamic lane has no items (`!items.length`), the empty state container displays a `<Button>` with `<Plus size={14} />` and label `t('header.newNote')` or `t('screen.createNoteInLane')`.
   - Clicking it triggers note creation for that lane.

3. **Tag Dynamic Lane Context**:
   - For a tag dynamic lane (`row.source.kind === 'tag'`), triggering the action opens the New Note Modal with:
     - The lane's tag pre-filled (so that upon submission, `initialMetadata.tags` includes `row.source.tag`).
     - The lane's `notebookId` selected if specified; otherwise the current active notebook.
   - Upon creating the note, the new note has that tag and immediately appears in the dynamic lane.

4. **Folder Dynamic Lane Context**:
   - For a folder dynamic lane (`row.source.kind === 'folder'`), triggering the action opens the New Note Modal with:
     - The target notebook switched to `row.source.notebookId`.
     - The folder pre-filled with the relative path inside `notebook.root` corresponding to `row.source.path`.
   - Upon creating the note, the new note is saved into that folder and immediately appears in the dynamic lane.

5. **Modal Experience**:
   - If a tag is pre-filled, the New Note modal reflects this context (e.g. displaying the tag badge or field).
   - Submitting the modal creates the note, adds it to the workspace state, closes the modal, and opens the note in the editor.

## Applied Standards and Precedents

- ScreenPage precedent: [`apps/web/src/components/ScreenPage.tsx`](file:///Users/weihung/projects/github-notes/apps/web/src/components/ScreenPage.tsx#L90) custom lane add button.
- New Note modal precedent: [`apps/web/src/App.tsx`](file:///Users/weihung/projects/github-notes/apps/web/src/App.tsx#L242-L247) `openNewNote` and `handleCreateNewNote`.

## Selected Reality Anchor and Checkpoint

- Automated component/unit tests in `apps/web` verifying that:
  - Dynamic lanes render the create button in the header and empty state.
  - Clicking the button calls `onCreateNote` with the correct context for tag lanes and folder lanes.
  - `openNewNote` properly sets the initial folder, notebook, and tags.
- Full repository validation with `pnpm test` and `pnpm build`.
