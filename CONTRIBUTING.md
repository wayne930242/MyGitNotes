# Contributing

MyGitNotes is the community edition of an open-core product: this repository is licensed [AGPL-3.0](LICENSE), and the commercial MyGitNotes Pro edition builds on it (see [ADR 0002](docs/adr/0002-open-core-editions.md)).

## Contributor License Agreement

Every pull request needs a signed [Contributor License Agreement](CLA.md).
On your first pull request, CLA Assistant comments with a link; sign once and it covers your later contributions.
You keep the copyright in your work; the agreement lets the project ship it in both editions.

## Before you open a pull request

- Read the [architecture notes](docs/agent/architecture/index.md) for the repository layout and the product rules.
- Run `pnpm format`, `pnpm lint` and `pnpm test`, and the type checks of the apps you changed.
- Keep one change per pull request, and describe the behavior it changes.
