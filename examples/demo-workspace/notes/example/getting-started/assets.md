---
title: Assets and Images
tags: [getting-started, assets]
status: done
---
# Assets and Images

Open Assets from the note editor toolbar or navigate to the Assets page from the main menu. Both provide identical asset management capabilities.

1. Select a directory and upload files directly within the modal.
2. Click an asset to select it, then click View to preview it.
3. Click Insert within the note editor modal to insert the asset reference into your note.
4. Use Move to organize assets into other directories.
5. Delete requires a second click to confirm.

Newly inserted asset URLs are addressed by their Git blob content hash. Moving files within the notebook's asset directory will not break existing hash references. If an asset is deleted, references will fail to load.

Legacy relative-path links remain supported; reinsert hash references before moving legacy files. The maximum single-file upload size is 3 MiB.

For GitHub-backed workspaces, asset uploads, moves, and deletions each create an immediate remote Git commit, whereas note text is saved to browser drafts first and published via the Commit bar.
