# Multi-repository notebooks design

Spec: [spec.md](spec.md). Decisions: [decision.md](decision.md). ADR: [0001](../../adr/0001-multi-repository-notebooks.md).

## Chosen approach

Three seams replace the "one deployment source" assumption.

1. **Configuration source** (`WorkspaceConfigSource`, core): resolves, per request, the home repository, local repository mappings and a manifest store. The deployment adapter reads the environment and `mygitnotes.server.yaml` and stores the manifest in the home repository. A database adapter can replace it later without touching callers.
2. **Repository resolver** (`WorkspaceRepositories`, core): given the manifest and a factory for repository handles, answers which repository serves a notebook, lists repositories with their notebooks, and reports unavailability. Routes, routers and MCP tools get handles only from it.
3. **Per-repository revision and identity**: every revision names its repository (`RevisionSet`), every write names its notebook or repository, and the browser keys notes by notebook and path.

Local and remote route sets stay separate. A deployment is either local (every repository is a worktree) or hosted (every repository is reached through a provider API), because phase one keeps notebook repositories on the home repository's kind (Q1). Unifying the two route sets behind one repository interface is a separate refactor this change does not need.

## Interfaces

### Core

```ts
// repository.ts
type RepositoryId = string;                     // sourceIdentity(source), e.g. github:owner/repo@main
interface RepositoryRef { id: RepositoryId; source: SourceConfig; }
type RevisionSet = Record<RepositoryId, string>;

// workspace-config-source.ts
interface WorkspaceConfigSource {
  readonly mode: 'local' | 'remote';            // deployment-level; selects the route set at startup
  settings(request: WorkspaceRequest): Promise<WorkspaceSettings>;
}
interface WorkspaceSettings {
  home: RepositoryRef;
  /** Local mode only: worktree path for a declared notebook repository. */
  localPath(ref: RepositoryRef): string | undefined;
  manifest<H>(home: H, adapter: ManifestAdapter<H>): ManifestStore;
}
interface ManifestStore {
  load(): Promise<{ config: WorkspaceConfig; revision: string; }>;
  save(yaml: string, revision: string): Promise<{ config: WorkspaceConfig; revision: string; }>;
}

// workspace-repositories.ts
interface RepositoryEntry<H> {
  ref: RepositoryRef;
  notebooks: NotebookConfig[];
  handle?: H;                                   // absent when unavailable
  unavailable?: { reason: 'unmapped' | 'no-access' | 'missing-branch' | 'unsupported-platform'; message: string; };
}
interface WorkspaceRepositories<H> {
  config(): Promise<WorkspaceConfig>;
  configRevision(): Promise<string>;
  all(): Promise<RepositoryEntry<H>[]>;
  forNotebook(notebookId: string): Promise<RepositoryEntry<H> & { handle: H; }>;   // throws SourceError 404/503
  byId(id: RepositoryId): Promise<RepositoryEntry<H> & { handle: H; }>;
}
```

`WorkspaceRepositories` takes the manifest store, the home handle, and a `(ref) => Promise<H>` factory. Phase one's manifest has no `source`, so every notebook maps to the home entry; stage 2 adds the manifest field and the factory's other branches without changing callers.

`RemoteSource` stops reading its own manifest. Its constructor receives `scope: () => Promise<WorkspaceConfig>`, the manifest restricted to this repository's notebooks; `config()` returns that scope and every path check, index and commit validation uses it. The manifest location and the `notes/` root prefixing move from `RemoteSource.manifestRecord` into the remote manifest adapter, which saves through a new `RemoteSource.commitManifest(file, content, expected)`. The local manifest adapter wraps `loadWorkspaceConfig` and the existing local save.

`NoteCatalog.revision(): Promise<string>` becomes `revisions(): Promise<RevisionSet>`. A composite catalog delegates `index`, `contents` and `memo` to the catalog of each notebook's repository and merges revisions; query cursors hash the `RevisionSet`. `lookupNotes` takes `{ notebookId, path }[]`.

### Server

- `request-workspace.ts` middleware builds `res.locals.workspace` once per request from the configuration source, the session credential and the shared cache. Remote handles are `RemoteSource`s; local handles are `{ id, root }`.
- Credentials: `RepositoryCredentials.tokenFor(ref)` returns the session (or MCP grant) token when `ref` shares the home platform and site, otherwise marks the repository `unsupported-platform`. `providerFor` takes the home `SourceConfig` from the configuration source instead of calling `loadSourceConfig`.
- Every independent router (`file-manager`, `folder-manager`, `study`, `workspace-document`, `r2-manager`, `remote-core-update`) and every local router reads `res.locals.workspace` instead of a source or root captured at mount time. Local write guards (branch `main`, path validation, `serializeWorkspaceMutation`) run against the root of the target repository.
- Hosted MCP builds the same workspace from the grant credential; the stdio MCP server builds it from the deployment configuration source, and `ToolContext.repoRoot` becomes `ToolContext.workspace`.

### HTTP contract

| Area | Contract |
|---|---|
| `GET /api/workspace` | `{ config, configRevision, local, home, repositories: [{ id, type, repository?, branch, revision, write, notebooks, unavailable?, gitStatus? }], repoRoot? }`. Top-level `revision`, `branch`, `source` and `capabilities.write` are removed. |
| `PUT /api/workspace/config` | Takes `configRevision`; returns the new `config` and `configRevision`. |
| Note queries, facets, agenda, graph, lookup | Take `revisions` (JSON `RevisionSet`, only for repositories the caller holds) and return `revisions` for the repositories involved. |
| Notebook-scoped reads and writes | Take `notebookId`; the path must lie in that notebook. Notes, assets, templates, folders, files, folder manager, Screen, Focus, Study and R2 references follow this rule. |
| `POST /api/notes/commit`, `POST /api/tags/apply`, agent resources | Take `repository` and that repository's `revision`. |
| 409 | Body adds `staleRepositories: RepositoryId[]`. |

Cross-repository orchestration of drafts and tag edits runs in the browser, one request per repository, because drafts already live there and each request keeps one revision and one commit. R2 moves stay server-side because the server owns the bucket and reference scan.

### Browser

- `useWorkspaceSync` holds `repositories` (by id) and the notebook-to-repository map instead of `sourceId`, `revision`, `branch` and `canWrite`. It exposes `repositoryFor(notebookId)` and `setRepositoryRevision(id, revision)`; write capability is per notebook.
- Note query scope becomes `{ revisions: RevisionSet }`; query keys include only the revisions of the repositories a query touches, and a 409 invalidates queries of the stale repositories.
- Drafts: `workingNotes` becomes `Record<RepositoryId, WorkingNotes>` stored under `gh_notes_working:${repository.id}:${repository.branch}`, which for the home repository equals today's key, so existing drafts carry over.
- The commit hook groups selected files by repository and commits each group in turn, stopping at the first failure. Stage 1 renders the Changes dialog exactly as today; stage 2 adds the repository headings.
- Note identity: `NoteRef = { notebookId, path }` with `noteRefKey`. Lookup, note selection, editor identity, list keys and the all-notebooks graph use it. Persisted Screen, Focus and Study entries keep plain paths, because each belongs to one notebook and a notebook lives in one repository.

## Delivery steps

Each step ends with `pnpm test`, `pnpm lint` and `pnpm build` passing, then a commit.

1. **Core seams and server wiring.** Configuration source with the deployment adapter and a two-workspace test adapter; manifest stores; `RemoteSource` scope injection; `WorkspaceRepositories`; request workspace middleware; every router, local route and both MCP servers take their repository and manifest scope from the request workspace. HTTP contract unchanged. Routes, remote tools and stdio MCP tool internals still act on the home handle (`workspace.home`); resolving them per notebook belongs to step 2, where the contract gains `notebookId` and `repository`.
2. **Per-repository contract.** Composite catalog and `RevisionSet`; the HTTP contract above; per-notebook resolution in HTTP routes, remote tools and stdio MCP tools (`ToolContext.repoRoot` becomes `ToolContext.workspace`); the credentials seam `RepositoryCredentials.tokenFor`; browser repositories state, query scope, per-repository drafts and grouped commit orchestration.
3. **Notebook-qualified identity.** `NoteRef` through lookup, graph, selection, editor and list keys.
4. **Stage 1 verification** (below), then report to the user.

Stage 2 gets its own step list in this file after the checkpoint.

## Precedent

- `NoteCatalog` already separates the query read model from local and remote sources; the composite catalog follows it.
- `res.locals.reader` is the existing per-request remote handle; `res.locals.workspace` replaces it.
- `commit-notes-concurrency.test.ts` subclasses `RemoteSource` with a fake provider; route tests use the same pattern with two fake repositories.
- Draft storage key compatibility follows the existing `gh_notes_working:` scope format.

## Alternatives considered

- **One repository interface over local and remote.** Deeper, but duplicates no current need: modes never mix in phase one. Rejected for this change.
- **Opaque workspace revision token.** Smaller wire change, but the browser could not tell which repository went stale, so every 409 would refresh everything. Rejected for `RevisionSet`.
- **Server-side batch commit across repositories.** Would move draft merging from the browser to the server and still be non-atomic. Rejected for browser orchestration with one request per repository.
- **Resolving the source at startup** (today's shape). Rejected by Q9.

## Risks

- Stage 1 touches nearly every route and 33 browser modules that use `revision`; the steps keep each commit green and behavior unchanged.
- Cache keys stay content-addressed; `RemoteSource` still verifies blob hashes, so injecting scope does not change cache safety.
- Legacy manifests under `notes/` keep their root prefixing inside the remote manifest adapter; the round-trip test for prefixed roots moves with it.

## Verification method

- Unit: configuration source adapters (including two workspaces served by one app), manifest stores (prefixed roots), resolver availability, composite catalog revisions and cursors, per-repository drafts key compatibility, grouped commit stop-on-failure.
- Route: remote HTTP tests with fake repositories for revision, 409 `staleRepositories`, notebook-scoped writes and read-only repositories.
- Regression: full test suite, lint, build, and the existing QA scripts `qa-mobile`, `qa-live-editor`, `qa-note-focus`, `qa-file-manager`, `qa-note-navigation` against the demo workspace.
- Browser anchor for stage 1: local demo workspace at 390 px and 1440 px — browse, edit, draft, commit, Screen, Focus, Study, file moves and Settings save behave as before.

## Implementation notes

- The deployment adapter reads the environment on every `settings()` call, matching the previous per-call `loadSourceConfig` in authentication; the mode chosen at startup stays fixed, and a later switch between local and remote fails with a restart message.
- Independent routers (file manager, folder manager, R2, Study, Screen, Focus) now read through the request's shared cache like the other remote routes. The R2 rate-limit test adds an uncached note so it still exercises a platform read.
- A local worktree without a manifest still answers `GET /api/workspace` with `config: null` and accepts its first manifest; path validation loads the manifest only when a request names a path.

## Friction Notes

- Tried: Trust pi-lens LSP diagnostics after rebuilding `@mygitnotes/core`.
  Found: The LSP kept the pre-build type declarations and reported missing exports that `tsc` and Vitest resolved; `tsc --noEmit` is the reliable check after a core rebuild.
  Led by: pi-lens automated check
- Tried: Compare format-check output against a `git stash` baseline, then run a browser QA script.
  Found: Stash and pop refresh source modification times, so the QA freshness guard rejects the existing build until `pnpm build` runs again.
  Led by: AAAAV Verify evidence-first loop
