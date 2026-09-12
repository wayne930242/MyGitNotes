---
title: Agent System and MCP
tags: [getting-started, mcp]
status: done
---
# Agent System and MCP

The Agent System provides access to workspace guidelines, skills, and documentation. You can maintain guidelines locally using the same editor as your notes; English is recommended for instruction text and MCP command examples.

## Connecting via MCP

After logging into the web app, navigate to **Settings → Access control** to generate an authorization token for your connector. A read-only grant is recommended for initial search and reading tests; use a write grant when edits are needed.

Copy the complete MCP URL generated on the screen into your connector. The URL contains the authorization credentials, so store it securely in your connector configuration. The grant remains valid until manually revoked under Access control.

## Common Operations

- `ls`, `glob`: Browse paths and filter filenames.
- `read`, `find`: Read note contents and search text.
- `write`, `append`, `edit`: Write, append, or perform targeted edits.
- `mkdir`, `cp`, `mv`, `rm`: Create directories, copy, move, or delete files.

Read operations return a `revision` hash, which must be passed back on write operations. If the revision is stale, the write is rejected and the file must be re-read.

Every successful MCP mutation immediately creates a remote commit with an automated message. This operates independently from the web interface's local draft and manual Commit workflow.
