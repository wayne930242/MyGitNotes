Status: approved
Approved at: 2026-09-28
Approved from: "可以，要"

# Multi-repository notebooks specification

Decisions and evidence: [decision.md](decision.md).
Terms: **home repository** (主儲存庫) and **notebook repository** (筆記本儲存庫), defined in [CONTEXT.md](../../CONTEXT.md).

## Observable behavior

### Manifest and configuration

- A notebook entry in the home manifest may declare `source`:

  ```yaml
  notebooks:
    - id: trpg
      title: TRPG
      root: notes
      source:
        type: github
        repository: owner/trpg-notes
        branch: main
  ```

  `type` is `github` or `gitlab`; `repository` is `owner/repo` or `group/project`; `branch` is optional and defaults to `main`; `url` names the GitLab site and is required for `gitlab`.
  A notebook without `source` lives in the home repository, exactly as today.
- `root` and `assets` stay relative to the notebook's own repository.
  Roots must not overlap only among notebooks in the same repository.
- A `source` that names the home repository is treated as the home repository.
- Phase one rejects a hosted notebook repository whose platform or site differs from the home repository's, with an error naming the notebook.
- A local deployment maps notebook repositories to worktree paths in `mygitnotes.server.yaml`:

  ```yaml
  repositories:
    - type: github
      repository: owner/trpg-notes
      path: ../trpg-notes
  ```

  A relative `path` resolves against the server configuration file.
- The manifest `schema_version` advances to 2.
  `pnpm migrate-workspace` and `pnpm update-core` migrate version 1 manifests; the migration changes only the version.
  Older Core refuses a version 2 manifest with its existing "update Core" message.

### Configuration source

- Every configuration read — the home source, notebook bindings and local repository mappings — and every manifest save goes through one request-scoped configuration source.
  Routes, independent routers and MCP ask it per request; none reads the environment, `mygitnotes.server.yaml` or the manifest file directly.
- The only production adapter reads the environment and `mygitnotes.server.yaml`, and loads and saves the manifest in the home repository, so deployments behave exactly as today.
- A second adapter used only in tests serves a different workspace per request, proving a database-backed adapter can replace the current one without changing callers.

### Availability

- A notebook whose repository cannot be reached (no mapping in local mode, no access for the signed-in account, missing branch) appears in the notebook switcher as unavailable with the reason.
  Opening it shows the reason; the other notebooks work normally.
  No request silently falls back to the home repository.
- A misconfigured home manifest still fails startup as it does today.

### Reading, writing and revisions

- Every read and write targets the repository of the notebook it names.
- Write capability is decided per repository.
  A notebook in a repository the account cannot push to, or on a branch other than `main`, is read-only with the existing read-only affordances; other notebooks stay writable.
- `revision` identifies one repository's commit.
  A 409 on one repository refreshes that repository's data only; open editors in other repositories keep their state.
- A query across notebooks ("顯示全部筆記本", facets, agenda, graph, lookup) covers every available repository; its result carries one revision per repository involved, and a stale page refreshes only the stale repository.
- Two notes with the same repository-relative path in two repositories stay distinct everywhere: lists, search, open editors, drafts, the Changes dialog, Focus, Screen, Study and graph.

### Where location is shown

- The header source label, the editor footer branch, the sidebar branch and the Settings source footer are removed.
- The note document panel gains an "Info" tab beside "View", on desktop and mobile.
  It shows the notebook, the notebook repository and its branch, the note path, and whether the note is writable; when it is not, it states the reason (no push access, branch other than `main`, `core` branch, repository unavailable).
- Read-only notes keep their disabled controls.
  The Settings `core` branch warning stays, because it explains why saving is disabled.

### Drafts, Changes and commits

- Remote drafts are kept per notebook repository.
  Drafts saved by the current version in the browser carry over to the home repository after the update.
- The Changes dialog groups changes under one heading per repository, showing its repository and branch.
  Selection, diff, restore and the change count work per file as today.
- One Commit action with one message commits the selected changes of each repository in turn, one commit per repository.
  The first failure stops the run: repositories already committed stay committed and their drafts clear; the failed repository and the remaining ones keep their drafts; the dialog reports which repositories committed and which failed, with the reason.
- Local mode shows each worktree's Git status in its own group; sync (pull/push) runs per worktree and reports per repository.
- A workspace-wide tag rename, merge or delete writes each affected repository in turn with the same stop-on-first-failure report.

### Workspace documents

- `.github-notes-screen.yaml`, `.github-notes-focus.yaml` and `.github-notes-study.yaml` live in the root of each notebook repository and hold entries only for notebooks in that repository.
  The home repository's documents hold entries for notebooks without `source`.
- Screen shows the current notebook's lanes from its repository's document; Focus and Study behave the same way.
- A Study action that updates a note and the Study record commits both in one commit in the notebook's repository.
- Entries in a repository's documents for notebooks bound elsewhere are ignored and preserved unchanged on save.
  Rebinding a notebook moves neither its files nor its document entries.

### Files, links and assets

- Moves and renames of notes, folders and assets stay inside one notebook, as today, and rewrite links and document entries within that notebook's repository in the same commit.
- A link resolves within its note's repository.
  Links between notebooks in the same repository keep working; a link whose target lies in another repository resolves as missing, the same way a link to a nonexistent note does.
- R2 reference scans cover notes in every available repository.
  An R2 move copies the objects, commits the rewritten notes one repository at a time, and deletes the old keys only after every commit succeeds; after a partial failure both keys remain and the response lists the repositories that committed.
  An R2 delete is refused while any available repository references the key.

### Agent system

- A note's system instructions and skills come from its folder up to the root of its notebook repository.
- The Agents page groups workspace agent files by repository: the home repository and each notebook repository in use.

### MCP

- Notebook-scoped MCP tools act on the notebook's repository.
  Tools that take only a path resolve it through the notebook whose root contains it; a path that matches no notebook is rejected.
- Workspace-wide Git tools report status per repository; commit tools take a notebook id and commit that notebook's repository.
- A hosted MCP grant stays bound to the home repository identity and its account credential, and reaches every notebook repository the manifest declares, subject to the provider's access check.

### Settings

- The YAML mode edits `source`; the form neither edits nor displays it.
- Saving the manifest goes through the configuration source; with the current adapter it commits to the home repository only.

## Compatibility and edge cases

- A workspace without any `source` behaves exactly as today after the one-time schema migration: same routes, URLs, documents, drafts, commits and MCP tools.
- Note routes `/notebooks/{id}/notes/{path}` keep their form.
- Shared cache entries stay content-addressed (blob SHA verified on read, notebook tree SHA for indexes), so two repositories — including the same repository name on two GitLab sites — can share an entry only when the content is identical.
- Local writes serialize per worktree; two worktrees write independently.
- Scripts: `bootstrap-workspace` and `convert-workspace` act on the home repository only; `backfill-note-timestamps` processes each notebook in its own repository.
- Removing a notebook's `source` points it back at the home repository; content is not moved.

## Non-goals

- Moving notes or folders between repositories.
- Link syntax that addresses another repository.
- Notebook repositories on a different platform or site than the home repository (the credential lookup is shaped to allow it later).
- Editing `source` in the Settings form.
- A database configuration adapter or any hosted multi-tenant service.
- Atomic commits spanning repositories.
- Moving content or document entries when a notebook is rebound.

## Applied standards

- Clean architecture: one repository resolver owns "which repository serves this notebook"; routes, MCP tools and the browser call it instead of branching on the deployment source.
  Configuration enters at the edge through the configuration source, per request.
- Fail fast: unreachable repositories surface as explicit unavailability, never as a silent fallback.
- Existing theme tokens, i18n (English and Traditional Chinese) and read-only affordances for every new visible string and state.
- Workspace schema migration rules in `workspace-migration.ts`.

## Delivery stages

1. **Refactor, no behavior change.** Introduce the request-scoped configuration source, the repository resolver, per-repository revision, repository-scoped writes and notebook-qualified note identity while every workspace still has one repository. The full test suite and existing QA scripts pass unchanged except where they assert internal shapes.
2. **Multi-repository behavior.** Manifest `source`, local repository mapping, availability, the Info tab and removal of location labels, grouped Changes and commits, per-repository documents, R2, agent system, MCP and Settings.

Checkpoint: after stage 1 is committed and verified, report to the user before stage 2 starts.

## Reality anchor

- **Local, browser:** a disposable copy of `examples/demo-workspace` as the home repository plus a second disposable Git repository mapped in `mygitnotes.server.yaml`, served on dedicated ports.
  At 390 px and 1440 px: browse and edit a notebook in each repository; create the same relative path in both and confirm they stay distinct; commit changes spanning both and confirm with `git log` one new commit in each worktree; save a Screen lane in the second notebook and confirm it lands in the second repository's `.github-notes-screen.yaml`; confirm a cross-repository link shows as missing; remove the mapping and confirm the notebook shows as unavailable while the others work; open the Info tab in each notebook and confirm it names the right repository and branch, and that the header, footer, sidebar and Settings no longer show them.
- **Remote, automated:** HTTP route tests with two `FakeSource` repositories (the `commit-notes-concurrency.test.ts` pattern) covering per-repository revision and 409, grouped commits with a mid-run failure, document placement, read-only repository, and unavailability; a test configuration adapter that serves two different workspaces to two requests on one app instance.
- **Production:** after deployment, binding a notebook in the user's knowledge base to a second GitHub repository needs the user's go-ahead; it is proposed, not assumed.
