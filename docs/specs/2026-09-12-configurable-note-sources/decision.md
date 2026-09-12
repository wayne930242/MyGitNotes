# Configurable note sources and Gemini handover

## Outcome and actors

Resume the GitHub Notes work interrupted in Gemini in Herdr tab `w3:tC`, pane
`w3:pY`. The existing product checkpoint is commit `f34414b`. At handover,
branch `core` was clean and had no Git remotes. Gemini had investigated the next
features and stopped because of its model quota; its proposed deployment was
not implemented.

The workspace owner selects the note repository. Visitors browse public notes.
Authorized GitHub users read private notes and edit according to repository
permissions. Agents operate within the same data and authorization boundaries.

## Confirmed requirements

| Question | Answer | Basis | Status |
|---|---|---|---|
| Which work has priority? | Nested folders with per-directory YAML display names, followed by a usage-focused README and deployment/access support. | User instructions recovered from the same Herdr tab. | grounded |
| What chooses the note repository? | Configuration selects a local repository or a remote repository. | User clarification in the receiving session, 2026-09-12. | confirmed |
| Does the application checkout's Git remote identify the note source? | It is independent of the configured note source. | User clarification; local checkout currently has no remote. | confirmed |
| What is the deployment target? | `https://my-gh-core.vercel.app`. | User instruction recovered from Gemini. | confirmed |
| What is public access? | Anonymous visitors can browse a public repository in read-only mode. | User instruction recovered from Gemini. | grounded |
| What is private access? | GitHub authentication plus repository authorization before serving private content. | User instruction recovered from Gemini. | grounded |
| Are OAuth credentials available? | The user reported obtaining an ID and secret; their app type, location and validity are unverified. | User instruction recovered from Gemini. | grounded |
| Is Vercel access authorized? | The user completed CLI login and explicitly authorized direct use. `vercel whoami` returned `wayne930242`; the current project listing used scope `weiweis`. | User update and receiving-session CLI verification, 2026-09-12. | confirmed |
| Can implementation change real notes? | Product maintenance stays on `core`; verification uses temporary fixtures. | [AGENTS.md](../../../AGENTS.md). | grounded |

Core project rules have been read. Product code, notebooks, and deployment are
separate responsibilities; the lack of a product Git remote does not block
implementation of configurable data sources.

## Source evidence and implications

- [Note scanning](../../../packages/core/src/note-service.ts) already recursively
  visits directories. Folder metadata and front-end selection remain to be added.
- [Application state](../../../apps/web/src/App.tsx) currently assumes one
  repository, with a global Git status and notebook-relative roots. One source
  per workspace follows this precedent.
- [Config loading](../../../packages/core/src/config.ts) and
  [bootstrap](../../../scripts/bootstrap-workspace.ts) use
  `notes/.github-notes.yaml` as the preferred manifest, with repository-root
  compatibility. Existing README/workflow descriptions need correction.
- [Local HTTP server](../../../apps/local-server/src/index.ts) uses disk and
  subprocess Git operations, serves repository-relative asset paths, and has
  no login layer. These routes are not an authenticated cloud backend.
- [Vercel's file guidance](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)
  directs persistent writes to external storage. A persistent local Git working
  tree is therefore not the chosen cloud persistence model.
- [GitHub's app comparison](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)
  distinguishes broad OAuth scopes from repository-selective GitHub App
  permissions. GitHub login is compatible with either, but they have different
  registration requirements.
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
  requires tokens issued for the MCP resource and audience validation. GitHub
  access tokens are upstream credentials, not client credentials for this MCP
  service. Recheck the current protocol revision during remote MCP design.

## Work boundaries

The accompanying specification covers the first deliverable: nested folders,
configurable source selection, existing local operations, anonymous public
GitHub reads, and an accurate usage guide. It establishes the provider boundary
needed by deployment without prescribing the later authentication service.

The following work remains part of the handover and follows that deliverable:

1. Confirm the existing GitHub app type and settle repository access grants.
2. Implement private reads, authorized remote writes, server-held credentials,
   revocable browser sessions, and conflict-aware remote commits.
3. Implement remote MCP authorization using credentials issued for this service.
4. Connect and deploy the application to the user's Vercel project, then verify
   public, private, and write-denied behavior against configured test repositories.

Actual repository names, credentials and Vercel project access are runtime
configuration inputs. They are not required to define the configurable source
contract. Authentication decisions are resolved before the dependent phase.

## Deployment access checkpoint

Vercel login is verified and direct CLI use is authorized. `vercel project
inspect my-gh-core` returned no matching project in either available team,
`weiweis` or `sq1-tw`. The working directory has no `.vercel/project.json`.
Treat `my-gh-core.vercel.app` as the requested deployment hostname, whose
availability and assignment must be verified during deployment. No Vercel
project was created or deployed during handover.

## Full-authorization implementation checkpoint

The user approved the first-deliverable specification and fully authorized
continuation, GitHub CLI and Vercel CLI use. The implementation also completed
the authenticated note-save and scoped remote MCP layers described in the
handover. Both OAuth App and GitHub App client settings are supported. Real
credentials and the selected remote note repository remain user inputs.

`weiweis/my-gh-core` is now created and linked, and the deployment hostname is
assigned. See [verification](verification.md) for observed behavior and remaining
live integration checks. No product Git history or user notes were pushed to
GitHub during this work.
