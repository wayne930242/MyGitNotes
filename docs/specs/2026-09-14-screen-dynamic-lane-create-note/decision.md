# Dynamic Lane Create Note Action — Decision

Outcome: Enable dynamic lanes on Screen Page to support a direct "Create note" action in the lane header and empty state, pre-populating the lane's specific tag or target folder so that new notes immediately match and appear in the dynamic lane.

Actors: Note writers and workspace organizers utilizing Screen Page lanes.

## Scope

- **In scope**:
  - Adding a "Create note" button in dynamic lane headers (`ScreenPage.tsx`) using the `Plus` icon, styled consistently with custom lane action buttons.
  - Adding a "Create note" button in empty dynamic lane placeholders (`.screen-lane-empty`).
  - Pre-populating the dynamic lane's tag (`row.source.tag`) or target folder (`row.source.path`) and notebook (`row.source.notebookId`) into the New Note creation flow in `App.tsx`.
  - Ensuring the created note is persisted with the pre-populated tag or folder and immediately displays in the dynamic lane.
  - Localization strings in `en.ts` and `zh-TW.ts`.
- **Out of scope**:
  - Changing how custom lane `+` ("Add item" to pin existing notes/folders/assets/youtube) behaves.
  - Changing dynamic lane query resolution or sorting logic.

## Decision Matrix

| Question | Answer | Basis | Status |
|---|---|---|---|
| Where should the create button be placed? | In the lane header action bar (matching custom lane's `+` position) and in the empty lane placeholder. | Consistent UX and direct accessibility. User approved proposal. | confirmed |
| How should tag dynamic lanes handle note creation? | Pre-populate the lane's tag into the note's initial metadata tags list. If the lane specifies a notebook, select that notebook. | Matches lane filter criteria so note appears in lane. | confirmed |
| How should folder dynamic lanes handle note creation? | Pre-populate the relative folder path and switch to the lane's notebook. | Matches lane folder criteria so note appears in lane. | confirmed |
| Should clicking the button open the New Note Modal or immediately create an untitled note? | Open the New Note Modal with pre-filled folder/tag so the user can name the note before creation. | Consistent with existing application UX in Header and views. | confirmed |
