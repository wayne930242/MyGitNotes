# Product versions and releases

The root `package.json` owns the product version. Workspace package versions and `schema_version` are independent metadata. Settings and the remote MCP server use the root version, frozen during `pnpm build`.

Settings includes the seven-character build commit. Untagged builds display `unreleased` (or its Traditional Chinese translation); missing commit metadata displays `unknown`. Local source execution reads the current root version. `MYGITNOTES_BUILD_SHA`, `VERCEL_GIT_COMMIT_SHA`, and `GITHUB_SHA` supply build provenance, in that order, before local Git. Sparse Vercel deployment explicitly passes its triggering SHA. Both configured Vercel projects had `autoExposeSystemEnvs: true` when inspected on 2026-09-20.

## Release procedure

Use Node 22.14+ or 24.10+ for semantic-release. Install with `pnpm install --frozen-lockfile`.

`pnpm release --dry-run` computes the next version without preparing a version commit or creating a release tag. For an unpushed local work branch, override `--branches <branch> --repository-url file://<absolute-checkout>`; this checks the same local history but does not validate remote write permissions or remote release-note links.

The **Product release** GitHub workflow is manually dispatched on `core`. It verifies the input revision, runs semantic-release, commits the root version through `@semantic-release/git`, creates `v<version>`, and rebuilds the resulting revision. npm publishing is disabled. The initial release remains an explicit operator action; ordinary core pushes do not invoke semantic-release.

The workflow also runs on pushed `v*` tags. `pnpm build` rejects tags whose version differs from root `package.json`. The manual workflow verifies its own new tagged HEAD because GitHub token-created events do not trigger additional workflows. Deployments remain owned by the existing deployment workflows; a release run is not deployment evidence. Repository branch protection must allow the workflow token to commit the version bump for an actual release.

## Verification

Run `pnpm build`, `pnpm lint`, `pnpm format:check`, and `pnpm test`. Check Settings from the built app. `GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v9.9.9 pnpm build` must fail unless the root version is exactly `9.9.9`.
