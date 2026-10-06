# Contributing

MyGitNotes is the community edition of an open-core product: this repository is licensed [AGPL-3.0](LICENSE), and the commercial MyGitNotes Pro edition builds on it (see [ADR 0002](docs/adr/0002-open-core-editions.md)).

## Contributor License Agreement

Every pull request needs a signed [Contributor License Agreement](CLA.md).
On your first pull request, the CLA check comments with the agreement; reply with this exact comment to sign:

```text
I have read the CLA Document and I hereby sign the CLA
```

One signature covers your later contributions. Comment `recheck` if the check does not update.
You keep the copyright in your work; the agreement lets the project ship it in both editions.

## Before you open a pull request

- Read the [architecture notes](docs/agent/architecture/index.md) for the repository layout and the product rules.
- Run `pnpm format`, `pnpm lint` and `pnpm test`, and the type checks of the apps you changed.
- Keep one change per pull request, and describe the behavior it changes.
