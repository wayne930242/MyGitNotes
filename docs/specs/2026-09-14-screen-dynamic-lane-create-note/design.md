# Dynamic Lane Create Note Action — Design

## Chosen Approach

1. **Context Derivation in `ScreenPage.tsx`**:
   - `ScreenPage` and `ScreenLane` accept `onCreateNote?: (context?: { notebookId?: string; folder?: string; tag?: string }) => void`.
   - When a dynamic lane's create button is triggered:
     - If `row.source.kind === 'tag'`: emit `{ tag: row.source.tag, notebookId: row.source.notebookId }`.
     - If `row.source.kind === 'folder'`: resolve the relative folder path by trimming `notebook.root` from `row.source.path`, and emit `{ notebookId: row.source.notebookId, folder: relativeFolder }`.

2. **Action Presentation in `ScreenLane`**:
   - In the lane header actions bar, dynamic lanes render a `<Button>` with `<Plus size={16} />`, labeled `screen.createNoteInLane` with matching tooltip.
   - In empty lanes (`!items.length`), render `<Button onClick={handleCreateInLane}><Plus size={14} />{t('screen.createNoteInLane')}</Button>`.

3. **Pre-population & Persistence in `App.tsx`**:
   - `openNewNote` accepts an options object `{ status?: string; folder?: string; tag?: string; tags?: string[]; notebookId?: string }`.
   - Tracks `newNoteTags` state. If `opts.tag` or `opts.tags` is provided, sets `newNoteTags`.
   - If `opts.notebookId` is provided, switches `selectedNotebookId`.
   - In `handleCreateNewNote`, passes `tags: newNoteTags` into `withNoteStatus` and initial metadata.
   - The New Note Modal displays pre-populated tags as badges.
   - On close or successful creation, resets `newNoteTags`.

4. **Localization**:
   - `screen.createNoteInLane`: "Create note in lane" / "在此河道新增筆記".

## Reality Anchor Checkpoint

- Automated unit tests in `apps/web/src/components/ScreenPage.test.tsx` verifying:
  - Header create button appears for dynamic lanes and triggers `onCreateNote` with correct context for both tag and folder sources.
  - Empty state button triggers `onCreateNote`.
- Unit tests in `apps/web/src/lib/note-navigation.test.ts` or similar verifying context extraction.
- Repository test suite (`pnpm test`) and build verification (`pnpm build`).
