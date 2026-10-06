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
- Provider tokens stay in encrypted server records. Browsers receive opaque HttpOnly session cookies. Hosted records use a durable Redis store; logout deletes the browser session.
- The lightweight mode (`MYGITNOTES_STORAGE=cookie`, or Vercel without Redis) keeps no server records: the session, provider token and refresh token included, is sealed with `SESSION_SECRET` (AES-256-GCM) into the HttpOnly, `SameSite=Lax` session cookie, and so are the OAuth state and PKCE verifier between redirect and callback. Logout clears the cookies; a stolen cookie stays valid until its token expires, since the server cannot revoke what it does not store. GitHub refresh tokens are single use, so a refresh that fails signs the visitor out. It signs in with GitHub only and offers no agent grants. Where a deployment sets no repository (`MYGITNOTES_SOURCE=github` alone), the visitor's chosen repository and branch are sealed in their own cookie and every read and write goes through their token, so the deployment never reaches a repository the visitor's token cannot. New agent grants have no TTL and use owner-authorized manual revocation; legacy session-linked grants retain their original lifecycle.
- Remote reads share a content-addressed cache keyed by repository and Git object id. A request only looks up object ids listed in the tree it fetched with its own authorization, so cached content reaches nobody who cannot already read it. Values are verified against their Git object id before they are stored. The per-process HTTP cache stays scoped to one authorization.
- Gist publishing (`/api/gists`, GitHub workspaces only) creates and deletes secret Gists on the signed-in account with its own OAuth token. It sends only the note body the browser submits; the Gist id lives in the note's `gist` frontmatter. `/api/notes/commit` and `/api/notes` push each committed note that names a Gist to it after the commit succeeds; a failed push is reported per note and never undoes the commit. A secret Gist is unlisted, not private: anyone with its URL can read it.
- Credential-bearing MCP URLs and Bearer headers resolve the same grant. Grant lists contain record digests and metadata; token values are shown only at creation.
- Public remote reads use anonymous requests. Private reads use the authenticated user's provider authorization. Responses containing workspace data are private/no-store.
- Browser Markdown is sanitized before rendering. Raw assets are restricted to workspace asset paths and served with a restrictive content security policy.
- R2 assets (`r2:<key>` references) are served by `/r2-assets/<key>?note=<path>`: the requester must be able to read that configured note with their own workspace permission, and the note must reference the key; only then does the server redirect to a 5-minute presigned URL. R2 credentials come from deployment environment variables and never reach the browser. `/api/r2*` management routes (list, preview, presigned upload, folder creation, move, delete) require the same write capability as file mutations, accept any valid key in the configured bucket (notes may reference any key, so management is not confined to a notebook prefix), and hand the browser only presigned URLs; move rewrites referencing notes as one workspace mutation.
- `.vercelignore` excludes local notes, secrets, session files and local source settings from uploads.
- The agent panel (`/api/pi/*`, local mode only) bridges the browser to a `pi --mode rpc` process that runs as the local user and can execute any command. Every route and the `/api/pi/ws` socket require a loopback Host and, when present, a loopback `http:` Origin; the socket always requires one. Through `pnpm dev:remote`, which reaches the app over Tailscale Serve, the bridge also admits the tailnet login that owns this machine (`MYGITNOTES_REMOTE_OWNER`) from the dev:remote origin: Serve sets `Tailscale-User-Login` on each proxied request, replacing any client value, so other tailnet users and tagged devices are refused even though they can open the notes. The socket forwards only the commands the panel uses (prompt, steer, follow-up, abort, queue clearing, new session, state, messages and extension dialog answers). Pi starts only in a folder the request names by notebook (a folder inside the notebook's root, or with `repository` the root of the notebook's repository, the default), which must be an existing directory inside the user's home directory. A start may name a session file to resume; the bridge passes it to Pi's `--session` only when it is an existing `.jsonl` file inside the home directory whose session header records that same folder, and otherwise Pi starts a new conversation. The bridge never passes `--approve`: Pi makes the project-trust decision itself (an extension's `project_trust` handler, then `~/.pi/agent/trust.json`, then `defaultProjectTrust`, which skips project resources in RPC mode when it is `ask`), and a bundled command-line extension (`pi-trust-extension.mjs`) reports that decision so the panel can show it. The process starts in the background when a local workspace loads, outlives sockets and page reloads, and ends only when the user ends it, switches folders, or the server stops. The panel and its tab are hidden when the server cannot find Pi (`MYGITNOTES_PI_COMMAND`, or `pi` on PATH).

GitLab site URLs are deployment settings. OAuth state, credentials and account keys are bound to the configured site and OAuth application. GitLab API and OAuth calls reject redirects. Refresh-token rotation is serialized across hosted instances through Redis; local development serializes refresh in process. GitLab commits use per-file last_commit_id checks and preserve unrelated concurrent history.
