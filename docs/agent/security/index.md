# Security & Guards

MyGitNotes handles local filesystem and Git operations with defense-in-depth boundaries.

## 1. Path Traversal & Symlink Guards

All file paths received by the MCP server or local API bridge are validated through `packages/core/src/path-guard.ts`:
- All relative paths are normalized and resolved against the repository root.
- Paths containing `..` or attempting to escape the repository root are rejected with an explicit error.
- Symlinks pointing outside the repository root are forbidden.

## 2. Branch Guards

- Write operations on user notes (`notes/**`) are only permitted when the active branch is a user workspace branch (typically `main`), preventing accidental mutation of product code on `core`.
- Updates to product source files are guarded against overwriting user notes.

## 3. Secret Safety

- Secrets such as API keys and tokens must never be written to Git-tracked files.
- `.env` files are ignored by Git.
- Local MCP stdio operates within the local user process boundary and does not expose open network ports.
- The local HTTP bridge binds to `127.0.0.1`, validates loopback hosts and origins, and restricts workspace mutations to `main`.
- Hosted `/mcp` uses HTTPS and a service-issued bearer grant scoped to its audience, configured repository and persistent account credential. Write grants additionally require the selected provider's push permission and the `main` workspace branch.
- Provider tokens stay in encrypted server records. Browsers receive opaque HttpOnly session cookies. Hosted records use a durable Redis store; logout deletes the browser session. New agent grants have no TTL and use owner-authorized manual revocation; legacy session-linked grants retain their original lifecycle.
- Remote reads share a content-addressed cache keyed by repository and Git object id. A request only looks up object ids listed in the tree it fetched with its own authorization, so cached content reaches nobody who cannot already read it. Values are verified against their Git object id before they are stored. The per-process HTTP cache stays scoped to one authorization.
- Credential-bearing MCP URLs and Bearer headers resolve the same grant. Grant lists contain record digests and metadata; token values are shown only at creation.
- Public remote reads use anonymous requests. Private reads use the authenticated user's provider authorization. Responses containing workspace data are private/no-store.
- Browser Markdown is sanitized before rendering. Raw assets are restricted to workspace asset paths and served with a restrictive content security policy.
- R2 assets (`r2:<key>` references) are served by `/r2-assets/<key>?note=<path>`: the requester must be able to read that configured note with their own workspace permission, and the note must reference the key; only then does the server redirect to a 5-minute presigned URL. R2 credentials come from deployment environment variables and never reach the browser. `/api/r2*` management routes (list, preview, presigned upload, folder creation, move, delete) require the same write capability as file mutations, accept only valid keys under `<notebookId>/`, and hand the browser only presigned URLs; move rewrites referencing notes as one workspace mutation.
- `.vercelignore` excludes local notes, secrets, session files and local source settings from uploads.

GitLab site URLs are deployment settings. OAuth state, credentials and account keys are bound to the configured site and OAuth application. GitLab API and OAuth calls reject redirects. Refresh-token rotation is serialized across hosted instances through Redis; local development serializes refresh in process. GitLab commits use per-file last_commit_id checks and preserve unrelated concurrent history.
