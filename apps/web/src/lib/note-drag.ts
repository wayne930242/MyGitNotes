import type { NoteListItem } from '@mygitnotes/core/note-query';

/** Native drag payload MIME type: carries a note's path from the browse region into a Focus pane. */
export const NOTE_DRAG_TYPE = 'application/x-mygitnotes-note';

/** Present on a browse view while a Focus is displayed: rows/cards get a zoom button and can be dragged into a pane. */
export interface NoteBrowseFocusMode {
  onZoomNote: (note: NoteListItem) => void;
  canDrag: (note: NoteListItem) => boolean;
}
