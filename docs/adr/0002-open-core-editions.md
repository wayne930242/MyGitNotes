# Open-core editions

MyGitNotes ships as two editions that share one product core.
The **community edition** is this repository, licensed AGPL-3.0, and holds every single-user feature: notes, editors, sources, Git, MCP, the agent panel, the lightweight (no-Redis) deployment, GitHub App sign-in and importing any repository.
The **Pro edition** is the private repository `wayne930242/MyGitNotes-Pro`, which adds only what a hosted, multi-user service needs: tenants with per-user repository lists, a Postgres (Neon) record store, a hosted Pi sandbox with user-supplied provider keys, and billing.

Pro never edits community code.
It includes this repository as a Git submodule inside its own pnpm workspace, pinned by commit, and composes the community packages through extension points: the server's composition root (`createApp` services and route hooks) and the web app's build-time feature registry (`createWebApp({ features })`).
When Pro needs a seam that does not exist, the seam is added here first, behind behavior that is unchanged for the community edition, and Pro moves its submodule to that commit.

Each deployment runs in exactly one storage mode, chosen by configuration: a database (`DATABASE_URL`), Redis (`REDIS_URL` or Redis REST), a local encrypted directory (self-hosted outside Vercel), or the lightweight mode that keeps the provider token sealed in an HttpOnly cookie and stores nothing on the server.
Users do not choose a mode per account.

## Considered Options

- A private fork that periodically merges the community edition was rejected: Pro changes to shared files would conflict on every merge, which is the drift this decision exists to prevent.
- One private monorepo that exports the community directories with a sync tool was rejected for now: it needs export tooling and a path for accepting community pull requests that the project does not have.
- Publishing the community packages to a registry was rejected for now: every seam change would need a release before Pro could use it; the submodule pins the same source with no publishing step.
- Runtime-loaded web plugins were rejected: build-time composition keeps the editions type-checked together and tree-shaken.
- MIT or Apache-2.0 was rejected because anyone could run a closed hosted service from the community edition; a source-available license was rejected because it is not open source.

## Consequences

- Outside contributions need a signed CLA so they can also ship in Pro; contributors sign once through CLA Assistant.
- The community edition must keep its extension points stable and covered by tests, including contract tests that a Pro implementation can run against itself (for example the record store contract).
- Redis stays a supported store until existing deployments migrate; it is then a candidate for removal.
- Claude subscription OAuth is not offered in the hosted sandbox because Anthropic's terms restrict those tokens to Claude Code and Claude.ai; providers are reached with user-supplied API keys, and ChatGPT device sign-in is at most an experimental option.
- Work proceeds in four phases, each specified and reviewed before implementation: community extension points with unchanged behavior; community lightweight mode, GitHub App and repository import; the Pro repository with Postgres and tenants; the hosted Pi sandbox.
- The extension points are described in the [architecture notes](../agent/architecture/index.md#editions-and-extension-points).
