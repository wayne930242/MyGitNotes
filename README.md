# MyGitNotes

A local-first workspace for Markdown notes, flashcards, reading screens, and knowledge graphs. Your content stays in Git; run the interface locally or deploy with Docker, Docker Compose, or Vercel.

[English](README.md) · [繁體中文](README.zh-TW.md)

[Live Demo](https://my-gh-core.vercel.app) · [Flashcard Demo](https://my-gh-core.vercel.app/screen/lanes/explore) · [Example Workspace](https://github.com/wayne930242/MyGitNotes/tree/main)

![MyGitNotes architecture](docs/assets/mygitnotes-architecture-en.png)

## Why combine both sides

Local-first tools keep files on your device; cloud-document tools give you a browser and multi-device experience. MyGitNotes points both ways of working at the same Markdown and Git workspace. There is no second cloud copy to export, import, or reconcile.

## How it works

Markdown is the content source, Git records and publishes changes, and the repository owner controls credentials and access. A local checkout, Docker container, or Vercel deployment provides the interface and MCP endpoint; remote mode reads and writes the selected GitHub or GitLab repository.

One repository uses two branches in separate worktrees:

- **core** contains product source, packages, tests, scripts, and documentation.
- **main** contains workspace configuration, notebooks, assets, and workspace Agent settings.

## Quick start

Requires Node.js 22+, pnpm 9+, and Git 2.42+. Local mode needs no OAuth account.

~~~bash
git clone --branch core --single-branch https://github.com/wayne930242/MyGitNotes.git mygitnotes
cd mygitnotes
pnpm install
pnpm build                 # builds the packages the bootstrap script needs
pnpm bootstrap-workspace   # creates the main worktree in ./workspace (ignored by Git), writes MYGITNOTES_LOCAL_PATH to .env, and sets up the upstream remote
pnpm dev
~~~

Bootstrap renames the MyGitNotes remote from `origin` to `upstream` (or adds `upstream` when `origin` is already your repository), so `origin` can be your own repository while `pnpm update-core` keeps fetching Core from `upstream`. To keep your notes in your repository, create an empty one and push both branches:

~~~bash
git remote add origin <your-repository-url>
git push -u origin core main
~~~

Open http://localhost:5173; the new workspace appears in the Notes view. To use an existing workspace, set `MYGITNOTES_LOCAL_PATH` in .env to its absolute path, or run `REPO_ROOT=/absolute/path/to/workspace pnpm dev`.

## Deploy

The [deployment guide](docs/deploy.md) covers each path step by step:

- [Vercel through GitHub Actions sparse checkout](docs/deploy.md#vercel-through-github-actions-sparse-checkout-default) (default), or through the Vercel Git integration
- [Docker Compose](docs/deploy.md#docker-compose-with-a-remote-repository) or [plain Docker](docs/deploy.md#plain-docker-with-a-remote-repository) with a remote repository, optionally [behind a reverse proxy](docs/deploy.md#public-access-behind-a-reverse-proxy)
- [A local checkout inside a container](docs/deploy.md#local-checkout-inside-a-container)
- [GitLab as the note source](docs/deploy.md#gitlab-source-overlay)
- [Private R2 assets](docs/deploy.md#optional-private-r2-assets)

## Update

Run `pnpm update-core` from a clean `core` checkout; it fast-forwards `core` from `upstream/core`. Then `pnpm install && pnpm dev`. Hosted GitHub workspaces update from Settings. See [Core updates](docs/deploy.md#core-updates) and [Update and migrate](docs/deploy.md#update-and-migrate).

## Features

- Notes use ordinary Markdown with optional YAML frontmatter; Git preserves history and records explicit commits.
- Browse notes in List, Card, or Kanban views; search full text, manage folders and files, and explore a knowledge graph.
- Screen lanes organize notebook content; Markdown pages can also become flashcards.
- Choose from **nine palette families**, each with light and dark variants. **Flexoki** is the default; choices are saved in the browser.
- Connect local agents through stdio or remote agents through Streamable HTTP MCP with named read-only or write grants.
- The Files page manages notebook folders, notes, text files, and attachments: 3 MiB uploads, 5 MiB reads and changes, up to 200 changed files per operation.

## Documentation

- [Deployment guide](docs/deploy.md)
- [Agent and developer documentation](docs/agent/index.md)
- [Architecture](docs/agent/architecture/index.md)
- [MCP interface and security model](docs/agent/mcp/index.md)
- [Demo workspace](examples/demo-workspace/README.md)
- [Study and flashcard guide](docs/agent/study.md)

## License

MIT
