# Implementation design

## Domain and interfaces

A source identifies one Git repository and revision context. A workspace is the
notebook manifest in that source. A notebook owns a non-overlapping subtree;
folders organize notes inside it. Paths are repository-relative at the storage
boundary and notebook-relative in folder navigation.

Keep synchronous filesystem functions as the existing local adapter. Add a
GitHub reader and shared folder/configuration definitions in `packages/core`.
HTTP and stdio MCP resolve the same trusted server source configuration. An
HTTP router presents source identity and capabilities to the browser; a local
router retains the current Git working-tree operations. A per-request GitHub
reader pins reads to one commit, preventing mixed revisions and credential
cache leakage. This is smaller than replacing every filesystem helper with a
generic virtual filesystem, while keeping actual domain rules shared.

The runtime selector is `github-notes.server.yaml`; workspace manifests keep
their existing role and schema. Environment variables can supply deployment
source values without committing deployment-specific configuration. Local
paths resolve relative to the runtime selector. Vercel requires a GitHub source.

Folder parsing and filtering are shared. Both providers return a flat folder
list with parent paths for tree rendering. Notes retain their repository path
as identity. The UI creates only in a selected local folder, prevents duplicate
paths, and resolves inserted images relative to the note. Source identity
namespaces persisted browser state.

## Authorization and deployment follow-up

Public remote reads use anonymous GitHub API requests. Remote mutation stays
disabled until the authenticated write phase is implemented and verified.
GitHub authorization is enforced by the backend for every protected request.
The legacy local router is constrained to loopback use and configured workspace
paths; it is not exposed as the Vercel handler.

Cloud credentials are server environment values. `.env.example` documents
their purpose; an explicit CLI import sends named variables to Vercel secret
storage. The `.env` file and local notes stay outside deployment uploads.
Deployment can show a setup state until a source and credentials are supplied.

## Verification

Use temporary Git repositories and deterministic mocked GitHub responses for
provider parity, config errors, path/symlink guards, branch selection, truncated
trees, readonly enforcement and folder navigation. Use browser automation on
temporary fixture repositories to exercise nested creation and rendered images.
Run required tests/build once changes settle. Exercise the deployed public
shell and denied API operations separately; record credential-dependent checks
as incomplete until the user supplies the credentials.

## Implemented authorization extension

The user's full authorization covers continuing the phased handover. The
follow-up implementation supports either an OAuth App or a GitHub App client
configuration, PKCE and browser-bound state, opaque HttpOnly session cookies,
and AES-GCM encrypted upstream credentials. Local development uses restricted
filesystem session records; Vercel uses Redis REST records with expiration.
Production secrets and the Redis instance remain user-supplied configuration.

Remote note saves are explicit commits. A GitHub Git Data API commit references
the previously read parent and advances the branch with `force: false`; a
concurrent update returns a conflict. Successful saves read at the new commit.
Remote asset mutation and generic repository administration remain local-only.

HTTP MCP uses the SDK's stateless Streamable HTTP transport. The signed-in user
can mint an opaque service grant, bound to the configured source, `/mcp`, the
browser session, and an optional write capability. Resolving a grant retrieves
the upstream credential from its live server session. Logout revokes dependent
grants. MCP clients configure this service token explicitly; automatic OAuth
client discovery/registration is a separate future capability.

## Friction Notes

Vercel's additional TypeScript pass emitted Express inheritance diagnostics
although each package's own TypeScript build succeeded. The cloud entry now
imports the validated compiled application through `api/index.js`, avoiding a
second incompatible type-checking context. A temporary root tsconfig did not
resolve the platform pass and was removed. The final deployment log must be
checked for clean compilation independently of the CLI's READY status.

Browser inspection caught source identity appearing in the branch label. The
editor now receives `draftScope` separately from the display branch. Remote
Markdown reuses the existing `prose-custom` style after screenshot inspection.
