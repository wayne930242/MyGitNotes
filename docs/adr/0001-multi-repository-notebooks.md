# Multi-repository notebooks

A workspace may bind each notebook to its own repository, and three rules keep that safe.
The workspace manifest comes from a request-scoped configuration source, currently the home repository, never from a notebook repository, so a future hosted service can load it from a database without touching callers.
Screen, Focus and Study documents live in the root of the notebook repository they describe, because every lane, Focus and Study card already belongs to one notebook, and keeping them beside their notes lets moves, link rewrites and Study actions stay one commit.
No write spans repositories: provider APIs and Git commit one tree, so cross-repository work (grouped commits, tag edits, R2 moves) runs one repository at a time and reports partial results instead of pretending to be atomic.

## Considered Options

- Keeping all workspace documents in the home repository was rejected: every Study action and every move would become two commits in two repositories that can disagree after a failure.
- Loading configuration once at startup was rejected: it ties the app to one workspace per process and would need the same call sites rewritten again for a hosted service.

## Consequences

- Rebinding a notebook moves neither its files nor its document entries; the old repository keeps them unchanged.
- Links between notebooks in different repositories resolve as missing until a notebook-addressed link syntax is decided.
- See [docs/specs/2026-09-28-multi-repo-notebooks](../specs/2026-09-28-multi-repo-notebooks/spec.md).
