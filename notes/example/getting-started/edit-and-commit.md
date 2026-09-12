---
title: Editing, Local Saving, and Commits
tags: [getting-started, editing]
status: done
---
# Editing, Local Saving, and Commits

## Save Locally, Commit Explicitly

Opening a note launches Live Preview: markdown syntax is visible where your cursor is placed, while the rest of the document renders formatted output. Switch to Source view whenever you need raw text editing. Notes and the Agent System share the exact same editor.

- Local repositories: Edits automatically save to the on-disk working directory.
- GitHub sources: Edits save automatically to local browser drafts and persist across refreshes.
- Bottom Commit bar: Select notes to stage, inspect diffs and generated commit messages, then click Commit.

Selecting multiple notes creates a single atomic Git commit. Unselected changes remain intact in draft. Browser drafts exist only in that browser until committed; commit before switching devices to continue from remote.

## Handling Concurrent Remote Edits

The application checks remote revisions and attempts to merge non-conflicting changes automatically. Merged remote changes should be reviewed before committing. When conflicting changes occur on the same line, editing and committing are paused.

Click **Refresh remote version** to load the latest remote changes and proceed. Conflicted drafts are backed up locally and can be downloaded to recover text.

Press Esc to close the active note; when modals or menus are open, Esc closes the topmost overlay first.
