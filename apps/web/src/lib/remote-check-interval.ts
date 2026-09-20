/** How long `useNoteEditorSession` waits after a remote check before checking again. */
export const REMOTE_CHECK_INTERVAL_MS = 60_000;
/** The read-only variant polls far less often since it never has a local edit to protect. */
export const REMOTE_CHECK_INTERVAL_READONLY_MS = 300_000;
