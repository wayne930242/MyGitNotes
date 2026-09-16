---
title: Large Files with Cloudflare R2
tags: [getting-started, assets, r2]
status: done
---
# Large Files with Cloudflare R2

R2 is optional.
Keep ordinary images and attachments in the notebook with the Files page.
Use R2 only when a workspace has large files, such as scanned books, long recordings, or videos, that would bloat the repository or push a hosted repository archive past its size limit.

## Setup

The deployment owner configures a private R2 bucket once; see the README section "Private R2 assets".
When R2 is configured and you have write access, the Files page shows an **R2** section below the notebook folders.
Its objects live under this notebook's id in the bucket, for example `example/books/rules.pdf`.

## Manage objects

1. Open **R2** in the Files tree.
2. Use **Upload file** to send a file straight from the browser to the bucket; large files never pass through the notes server.
3. Use **New folder** to organize objects.
4. Select an object to preview it, download it, or copy its reference.
5. **Move / rename** lists the notes that reference the object and updates those references in the same operation.
6. **Delete** lists the notes that still reference the object; after deletion those links stop working.

## Insert a reference

In the note editor, open **Insert image**, choose **R2**, select an object, and click **Insert reference**.
The editor writes a reference like this:

```markdown
![rules.pdf](<r2:example/books/rules.pdf>)
[recording.zip](<r2:example/audio/recording.zip>)
```

PDFs, images, video, and audio preview inside the note; other files open as links.
Readers who can read the note can open its referenced objects; nobody can list the bucket without write access.
