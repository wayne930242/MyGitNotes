# Multi-repository notebooks decision

## Outcome and actors

The workspace owner keeps one deployment-configured repository as the home of the workspace manifest, and may bind any notebook to another repository. Every existing capability — browsing, editing, drafts, commits, Screen, Focus, Study, files, R2, agent system and MCP — works on a notebook the same way regardless of which repository holds it.

The change starts from a refactor that makes "which repository owns this notebook" an explicit server and client concept. Routes, stores and keys stop assuming one repository tree, one revision and one commit per workspace. No per-route special cases for the second repository.

## Evidence

Reconnaissance reports (read-only, 2026-09-28):

- Server seams: source construction, `RemoteSource`, local routes, revision contract, auth, caches — session `2026-09-28T05-33-48-998Z_097b4dfd…`.
- Web client: revision lifecycle, drafts and Changes, note identity, cross-notebook operations — session `2026-09-28T05-33-49-490Z_24aff019…`.
- MCP, manifest schema, scripts, docs — session `2026-09-28T05-33-50-174Z_2ead080c…`.

Key facts:

- One `SourceConfig` per deployment; `createApp` mounts either the local or the remote route set from it ([app.ts](../../../apps/local-server/src/app.ts)). Seven independent routers and the MCP server each hold that one source.
- `RemoteSource` owns one repository/branch snapshot, reads the manifest from its own tree and commits one tree ([remote-source.ts](../../../packages/core/src/remote-source.ts)). Local routes take one `repoRoot` string ([local-app.ts](../../../apps/local-server/src/local-app.ts)).
- The browser holds one `sourceId`, `branch`, `revision`, `canWrite` ([use-workspace-sync.ts](../../../apps/web/src/lib/use-workspace-sync.ts)); drafts, Changes, lookup, Focus tab keys and graph nodes are keyed by repository-relative path.
- Sessions bind one provider realm; MCP grants bind one source identity ([auth.ts](../../../apps/local-server/src/auth.ts), [mcp.ts](../../../apps/local-server/src/mcp.ts)).
- Screen lanes, Focus pages and Study cards each carry a `notebookId`; CONTEXT defines a Focus as belonging to one notebook ([CONTEXT.md](../../CONTEXT.md)).
- Notebook ids are unique across the manifest ([config.ts](../../../packages/core/src/config.ts)).
- The UI has no cross-notebook move today; file/folder planners already refuse moves outside a notebook.

## Scope

In: manifest `notebooks[].source`; server repository resolution for HTTP routes, independent routers and MCP; per-repository revision, write capability, drafts, Changes and commits; notebook-qualified note identity in the browser; placement of Screen/Focus/Study documents; agent-system scope; R2 reference scans and rewrites; migration; docs.

Out: moving notes or folders between repositories (no such move exists today); a new link syntax that addresses another repository.

## Decision tree

| Question | Answer | Basis | Status |
|---|---|---|---|
| Which repository holds the workspace manifest? | The deployment-configured source, called the home repository, through the configuration seam's current adapter. The manifest is never read from a notebook repository. | User request: env source is the default; Q9 | grounded |
| How does a notebook declare its repository? | Optional `source` on the notebook entry in the home manifest. Omitted means the home repository. `root` stays relative to the notebook's own repository. | User request; `NotebookConfig.root` semantics | grounded |
| What is a note's identity inside the app? | Notebook id plus repository-relative path. Notebook ids are unique, and a notebook lives in exactly one repository, so the pair never collides even when two repositories share a path. Markdown still stores plain paths. | config.ts uniqueness; web recon §4 | grounded |
| What does `revision` mean? | A per-repository commit identity. Reads and writes name the repository they target; a cross-notebook query carries one revision per repository involved; a 409 refreshes only that repository. | Server recon §3; web recon §1 | grounded |
| Can one operation write to two repositories atomically? | No. Every write targets one repository and becomes at most one commit there. | Git/provider APIs commit one tree | grounded |
| How is write capability decided? | Per repository: token or worktree access plus the repository's branch rule. The home repository keeps its `main`/`core` guard. | remote-source `canWrite`; local branch guard | grounded |
| How does an R2 move rewrite notes that live in several repositories? | Copy objects, commit rewritten notes one repository at a time, and delete the old keys only after every commit succeeds. A partial failure leaves both keys present, so no reference breaks; the response lists the repositories that committed. | r2-manager move flow | grounded |
| Which AGENTS.md chain applies to a note? | From the note's folder up to the root of the notebook's repository, as CONTEXT already defines. The home repository's root instructions do not apply to other repositories. | CONTEXT.md agent system definition | grounded |
| Does the manifest schema version change? | Yes. Older Core rebuilds notebook entries and would drop `source` on save, so the version advances with a migration and older Core refuses the manifest. | workspace-migration rules; MCP recon §2 | grounded |
| Which repository kinds may a notebook use? | The design resolves credentials per repository so GitHub and GitLab could mix later. Phase one accepts only notebook repositories on the home repository's platform and site, reached with the same account credential. | User answer Q1: c | confirmed |
| Where do Screen, Focus and Study documents live? | In the root of each notebook repository. Each repository's documents hold only entries for notebooks in that repository, so moves, rewrites and Study actions stay one commit in one repository. | User answer Q2: a | confirmed |
| How are lanes from several repositories ordered on Screen? | No cross-repository ordering exists: Screen shows only the current notebook's lanes, and a notebook lives in one repository. | CONTEXT.md Screen Page definition | grounded |
| What happens to document entries for a notebook that now lives elsewhere? | Each repository's documents ignore entries whose notebook is not bound to that repository and preserve them unchanged on save. Rebinding a notebook moves neither its files nor its documents; the owner moves content. | Q2 answer; no silent data loss | grounded |
| How does committing work when changes span repositories? | The Changes dialog groups changes by repository. One Commit action commits each repository in turn; the first failure stops the run, keeps the committed repositories, and keeps the failed and remaining drafts. | User answer Q3: a | confirmed |
| How are links between notebooks in different repositories handled? | Not supported in this phase. Such a link resolves as missing. Links between notebooks in the same repository keep working. A notebook-addressed link syntax is a later, separate decision. | User answer Q4: a (final reply) | confirmed |
| How is a notebook's `source` edited? | In the Settings YAML mode only; the form neither edits nor displays it (see the Settings display row below). | User answer Q5: a; later display revision | confirmed |
| Which branch does a notebook repository use? | Optional `branch`, default `main`. Writes follow the existing rule: only `main` is writable. | remote-source `canWrite`; local branch guard | grounded |
| What happens when a notebook repository is unreachable (no access, missing mapping)? | That notebook is listed as unavailable with the reason; other notebooks keep working. No silent fallback to the home repository. | Fail-fast rule | grounded |
| How does hosted MCP authorize notebook repositories? | The grant stays bound to the home source identity and its account credential; it covers the notebook repositories the home manifest declares, subject to the provider's access check. | Q1 answer; mcp.ts grant model | grounded |
| In local mode, how does a notebook repository map to a directory? | The manifest names only the platform identity (`type`, `repository`, optional `branch`, and `url` for GitLab). A local deployment maps that identity to a worktree path in `mygitnotes.server.yaml`; a hosted deployment reaches it through the provider API. The same manifest works in both modes and never commits a machine path. | User answer Q6: a | confirmed |

| Where are a note's repository and branch shown? | Only on a note info view. The header source label (`Header.tsx`), the editor footer branch (`EditorFooter.tsx`), the sidebar branch (`Sidebar.tsx`) and the Settings source footer (`SettingsModal.tsx`) are removed. | User revision after spec draft | confirmed |
| Does the Changes dialog still name repositories? | Yes. Grouping by repository tells the user which commit each change lands in; it is commit information, not a location label. | Q3 answer | grounded |
| Must configuration be loadable from somewhere other than files and environment? | Yes. A future hosted service may load the home source, notebook bindings and repository mappings from a database, so every configuration read goes through a replaceable seam. | User revision after spec draft | confirmed |
| Where does the note info view live, and what does it show? | An "Info" tab in the note document panel beside "View", available on mobile. It shows the notebook, notebook repository and branch, note path, and write capability with the reason when read-only. | User answer Q7: a | confirmed |
| What replaces the header's read-only label and the Settings core-branch warning? | The header label is removed; read-only controls stay disabled and the Info tab states the reason. The Settings core-branch warning stays because it explains why saving is disabled. | User answer Q8: a | confirmed |
| Does the Settings form still show each notebook's repository? | No. The user removed repository display from Settings; the YAML mode shows `source` as part of the configuration it edits. This supersedes the read-only display in the Q5 row. | User revision after spec draft | grounded |
| How far does the configuration seam go in this change? | A request-scoped `WorkspaceConfigSource` provides the home source, notebook bindings, local repository mappings and manifest saving. The only production adapter is the current one (environment, `mygitnotes.server.yaml`, manifest in the home repository). No database adapter; a second test adapter proves the seam is replaceable. | User answer Q9: a | confirmed |

## Core rules readiness

No open rows.
Previously: Terms confirmed by the user and recorded in [CONTEXT.md](../../CONTEXT.md): **主儲存庫** (home repository) and **筆記本儲存庫** (notebook repository). Code uses `homeRepository` and `notebookRepository`. Existing theme, i18n, workspace-document, remote-source and local-route patterns cover the implementation; the new contracts are the manifest `source` field, per-repository revision and the repository-grouped commit.
