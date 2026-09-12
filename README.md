# GitHub Notes

A Git-native, local-first notes application and agent-operable workspace frontend. Notes are stored as pure Markdown files with optional YAML frontmatter, organized into notebooks, and tracked via Git commits.

[Live Demo](https://my-gh-core.vercel.app) · [Example Repository](https://github.com/wayne930242/github-notes/tree/main)

## Branch Architecture

This repository uses a two-branch model to separate product source code from personal notes:

- **`core` (Default Branch)**: The canonical product branch. Contains application source code, packages, scripts, tests, and documentation. Never contains user notes.
- **`main`**: Your personal notes workspace branch. Created when you run `pnpm bootstrap-workspace`. Stores your notebooks, workspace configuration (`.github-notes.yaml`), and markdown notes (`notes/**`).

## Quick Start

### Prerequisites
- Node.js 22+
- pnpm 9+
- Git

### Installation & Setup

```bash
# Clone the repository (defaults to the `core` branch)
git clone <repository-url> github-notes
cd github-notes

# Install dependencies and build packages
pnpm install
pnpm build

# Initialize your personal workspace branch (creates and switches to `main`)
pnpm bootstrap-workspace

# Start local development servers
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. The local API runs on `http://127.0.0.1:4321`.
Alternatively, run `pnpm dev:server` to preview the built frontend directly on `http://127.0.0.1:4321`.

## Key Features

- **Local-First & Git-Native**: Full local filesystem control. Editing saves locally; the Commit footer publishes selected note changes as one Git commit.
- **Flexible Note Views**: Switch instantly between List, Card, and Kanban views.
- **Hierarchical Folders**: Organize notes in nested directories. Use optional `_dir.yml` files for custom titles and ordering.
- **Configurable Note Sources**: Work against your local filesystem or connect to remote GitHub repositories.
- **Agent Integration (MCP)**: Built-in Model Context Protocol server for local (stdio) and remote AI coding agents.
- **Safe Core Updates**: Update product code anytime via `pnpm update-core` while keeping your notes in `notes/**` intact.

## Keeping Core Updated

To pull updates from the product repository into your workspace:

```bash
git remote add upstream <product-repository-url>
pnpm update-core
```

This merges the latest changes from `upstream/core` into your current branch without modifying your notes.

## Documentation

- [Agent & Developer Documentation](docs/agent/index.md): Architecture, branch lifecycle, security boundaries, and MCP specifications.
- [Demo Workspace](examples/demo-workspace/README.md): Example notebooks, folder structure, and sample notes.

## License

MIT
