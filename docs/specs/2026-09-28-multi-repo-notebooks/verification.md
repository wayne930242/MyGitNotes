# Stage 1 verification

Spec: [spec.md](spec.md). Design: [design.md](design.md).

Stage 1 refactors the workspace to one repository per notebook without changing behavior. Every workspace still has one repository, the home repository.

| Requirement | Evidence | Result |
| --- | --- | --- |
| Request-scoped configuration source, replaceable later by a database | `config-source.test.ts`: one app serves two workspaces by request header; `workspace-config-source.test.ts` | pass |
| Repository resolver behind every HTTP route | `WorkspaceRepositories` (`forNotebook`, `forPath`, `byId`, `all`); route tests and `http.test.ts` notebook-named reads. MCP servers are deferred to stage 2 | pass |
| Per-repository revision | `RevisionSet` in queries and `/api/workspace`; `StaleRevisionError` names repositories; `note-catalog.test.ts`, `use-note-queries.test.tsx`, `gitlab-http.test.ts` | pass |
| Repository-scoped writes | Commit, batch read and tag routes take `repository`; notebook-scoped routes resolve their repository; `useWorkingNoteCommit.test.tsx`, `tag-changes.test.ts`, `tags-apply.test.ts` | pass |
| Notebook-qualified note identity outside the graph | `NoteRef`/`noteRefKey` in lookups, path queries, drafts, selection, editor registry, zoom and list keys; same-path tests in core and web. Graph nodes are deferred to stage 2 | pass |
| No behavior change | Full suite, lint, build, 12 browser QA scripts and the browser anchor at 390 and 1440 px; four QA scripts fail exactly as they did before the change | pass |

## Commits

| Revision | Step |
| --- | --- |
| `a9c7962` | Replaceable configuration source, per-request workspace, manifest stores |
| `069819a` | Unused argument in the Core updater factory |
| `2bd5e80` | Note queries answer one revision per repository (`RevisionSet`, `staleRepositories`) |
| `c451d15` | `/api/workspace` lists repositories; revisions, write access and drafts per repository; grouped commits |
| `97c62d0` | `WorkspaceRepositories.forPath` and `sharesCredential` |
| `e40d9c5` | Notebook-scoped routes resolve their notebook's repository; per-worktree local write guard |
| `17f7ffd` | Lookups, path queries and drafts identify notes by notebook and path |
| `3bc1cea` | Selection, editor registry, zoom, deletion and list keys by notebook and path |
| `1b1f9ea` | Graph node identity moved to stage 2 |

`1aeb597` resolves pi-lens diagnostics outside the refactor.

## Automated checks

| Command | Outcome |
| --- | --- |
| `pnpm test` | 202 files, 1436 tests, all green |
| `pnpm lint` | Clean |
| `pnpm build` | Built |
| `pnpm format:check` | No new findings; the 10 files unformatted on the base remain |

Tests added for the new seams: two workspaces served by one app through the configuration source; deployment settings and manifest stores; repositories by path and shared credentials; workspace catalog revisions, stale repositories, cursors and same-path notes in two repositories; query scope revisions and stale-query resets; tag changes and draft commits one repository at a time with stop-on-failure; draft, lookup and selection keys for equal paths in two notebooks; notebook-named reads and the folder manager's `notebookId`.

## Browser QA scripts

Passed against the built app: `qa-mobile`, `qa-working-notes`, `qa-note-statuses`, `qa-browser`, `qa-inline-note-transition`, `qa-live-editor`, `qa-note-navigation`, `qa-file-manager`, `qa-shared-editors`, `qa-graph-layout`, `qa-screen`, `qa-editor-links`.

Failing before this change, unchanged by it:

- `qa-note-focus` and the last section of `qa-graph-editing` click `.focus-switcher-menu` and `.focus-switcher-main`, which `b297307` (2026-09-21) removed when the Focus split button became one control. Every earlier section of `qa-graph-editing` passes, including collapsing a card, which flushes its editor.
- `qa-folder-index` looks for the mobile `Note view` select at a desktop step; it fails the same way at `2ff0b0f`, before the refactor.
- `qa-keyboard-shortcuts` looks for the `Commands` palette, since renamed `Quick Open`.

## Browser anchor

A copy of `examples/demo-workspace` served as a local workspace, driven with agent-browser:

- 1440 px: browsing lists 15 notes with facets; a note opened in zoom, typed into and autosaved (`git status` shows the file modified); the Changes panel committed it (`git log` shows the new commit and a clean tree); Settings saved a new workspace title (`chore(workspace): update configuration`, header updated); Screen shows the graph lane with two expanded note cards, both saved; Files created a folder in the notebook's worktree.
- 390 px: the card view opens a note in the mobile editor with the document panel tabs; a note link inside it opens the linked note.

## Not verified

- A hosted GitHub or GitLab deployment. Remote behavior is covered by route tests with fake providers and by the QA scripts that mock the remote API; nothing was deployed.
- Any workspace with a second repository: the manifest `source` field arrives in stage 2.

## Deferred to stage 2

- Graph node identity with repository-scoped link resolution.
- Per-notebook resolution in both MCP servers, after deciding how MCP tools carry revisions across repositories.
- Git status, agent resources, Screen, Focus, Study and R2 per repository, together with the stage 2 behavior for those areas.
