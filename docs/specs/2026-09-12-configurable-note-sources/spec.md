Status: approved
Approved at: 2026-09-12
Approved from: User approved the proposed phased scope and granted full authorization to implement and use authenticated GitHub and Vercel CLIs.

# Nested folders and configurable note sources

## Observable contract

### 1. Source selection

The server reads an optional `github-notes.server.yaml` at startup. This trusted
runtime configuration selects one repository for the workspace. Its path can
be supplied explicitly for deployments and local launches.

Local example:

```yaml
source:
  type: local
  path: .
```

GitHub example:

```yaml
source:
  type: github
  repository: owner/repository
  branch: main
```

`local.path` resolves relative to the server configuration file. An absolute
path is also supported. With no server configuration, existing local repository
resolution remains compatible with `REPO_ROOT` and the launch context.

For GitHub, `repository` is an owner/repository pair on github.com and `branch`
is explicit. Repository identity comes from this configuration. The product
checkout's `origin` is independent. Unsupported source types and incomplete
configuration produce actionable startup errors.

The selected repository supplies its own notebook manifest, using the existing
`notes/.github-notes.yaml` preference and root-manifest fallback. Notebook roots
remain relative to the selected repository. Remote data defines notebook
organization; trusted server configuration owns source selection.

Changing the source takes effect on server restart. Repository content and
browser requests do not change the server's selected repository or local path.

### 2. Folder navigation

Notebooks contain any number of nested directories. A directory can have an
optional `_dir.yml` with a display `title`, numeric `order`, and optional
`description`. The directory name is the fallback title. Siblings sort by
`order` followed by title and path for stable ordering.

```yaml
title: Projects
order: 1
description: Active projects
```

The sidebar shows nested folders, including empty directories visible to the
provider. GitHub trees preserve folders containing tracked files such as
`_dir.yml`; empty filesystem-only folders have no remote representation.

Selecting a folder includes notes in its descendants and combines with the
existing search, status and tag filters. An all-folders selection shows the
entire notebook. Switching notebooks clears the selected folder. In local
mode, creating a note in a selected folder writes there. Existing notes with
the same proposed path remain intact and produce a conflict message.

Folder configuration stays separate from note content. Assets, hidden content,
and agent resources retain their existing resource categories. Invalid folder
configuration reports the affected path. Existing notebooks need no `_dir.yml`.

### 3. Provider behavior

The UI and local MCP server use shared domain definitions and server-side source
resolution. The local provider retains local note, asset and Git workflows.
The GitHub provider in this deliverable reads public manifests, folder metadata,
notes and assets from the configured branch through the GitHub API.

Public GitHub browsing works without login. The provider reports read-only
capabilities, the UI presents browsing controls, and the server rejects mutation
requests. Private or inaccessible repositories produce an explicit unavailable
or authentication-required state without serving note content. Authenticated
remote operations follow in the next handover phase.

Source identity scopes client drafts and cached data so different repositories
with matching file paths remain distinct. Source errors, missing branches,
missing manifests, rate limits, and truncated repository listings surface as
errors or fully paginated results rather than apparent empty notebooks.

Markdown asset references resolve relative to each note, including nested
notes. The same fixture content yields equivalent notes and folder metadata
across providers. Frontmatter fields round-trip through local editing.

### 4. Usage guide

Rewrite the README around cloning, creating a personal workspace, launching the
app, configuring sources and notebooks, nested directories, assets, Git commits,
core updates, and local MCP configuration. Match current bootstrap and save
behavior. Document source examples using placeholders.

Describe Vercel deployment at `https://my-gh-core.vercel.app` as follow-up work
until it is exercised. Explain that GitHub credentials live in server-managed
secret storage and that GitHub login and remote MCP grants have separate roles.
Include the remaining authentication/deployment steps from [the handover](decision.md).

## Compatibility and boundaries

- Existing manifests without a runtime source selector keep their local behavior.
- The initial remote provider targets GitHub; additional Git hosts can add a
  provider when required.
- This increment supplies source selection and public remote reads. Private
  reads, remote writes, login, remote MCP grants and live deployment retain their
  explicit follow-up scope from the handover.
- `notes/**` and the user's manifests remain unchanged during product work.
- Existing path, branch, and frontmatter invariants apply to new local behavior.
  Remote paths are constrained to configured workspace resources.
- GitHub API responses and Markdown are external data. Rendered content and
  asset responses must preserve browser security boundaries.

## Applied standards and reality anchor

Follow [AGENTS.md](../../../AGENTS.md),
[the development skill](../../../.agents/skills/github-notes-dev/SKILL.md), and
[security guidance](../../../docs/agent/security/index.md). Domain behavior belongs
in shared packages and providers contain storage-specific behavior.

Use an isolated temporary local repository with two notebooks, two folder
levels, `_dir.yml`, same-named notes, unknown frontmatter, and image assets.
Exercise listing, folder selection, creation, conflicting creation and asset
insertion. Serve equivalent GitHub response fixtures at the adapter boundary
and verify the same read results, explicit missing/rate-limited responses,
branch selection and denied writes. Verify source configuration and cache
isolation through the real public interfaces.

Run `pnpm test` and `pnpm build`, then inspect the rendered folder navigation
and public read-only controls in a browser. Record each requirement against its
direct evidence. Live GitHub, login, MCP authorization and Vercel checks are
reported separately from simulated API tests and local builds.

Checkpoint: approve this first-deliverable contract, implement and verify it,
then resolve the authentication phase against the user's existing GitHub app
and proceed toward the deployment target.
