# GitHub Notes — Product Agent Instructions

Welcome to the **GitHub Notes** product codebase. This document guides AI coding and maintenance agents working on the application source code and infrastructure.

## 1. What GitHub Notes Is

GitHub Notes is a Git-native, local-first notes application and agent-operable workspace frontend. It stores notes as pure Markdown with optional YAML frontmatter, provides List, Card, and Kanban views, tracks every explicit save as a Git commit, and exposes a safe local MCP interface for coding agents.

## 2. Branch & Ownership Contract

- **`core`**: Canonical product branch and default branch of the public repository. Contains application source code, packages, scripts, tests, skills, and documentation. Never contains real user data.
- **`main`**: User workspace branch created after cloning via `pnpm bootstrap-workspace`. Contains user workspace config (`/.github-notes.yaml`) and user notes (`notes/**`). In the public repository, `main` also serves as the demo workspace branch and is **automatically rebased onto `core` via GitHub Actions (`.github/workflows/release-main.yml`)** whenever `core` is pushed.

### Path Ownership Invariants
- **Core-owned paths**: `apps/**`, `packages/**`, `scripts/**`, `docs/**`, `.agents/**`, `examples/**`, `AGENTS.md`, `README.md`, `package.json`, `pnpm-workspace.yaml`.
- **User-owned paths**: `notes/**`, `/.github-notes.yaml`.
- **Rule**: NEVER overwrite, alter, or delete content under `notes/**` during Core maintenance or Core update merges.

## 3. Product Documentation Map

Detailed architecture, security, and workflow guides live in `docs/agent/`:
- Overview: [`docs/agent/index.md`](file:///home/weihung/github-notes/docs/agent/index.md)
- Architecture: [`docs/agent/architecture/index.md`](file:///home/weihung/github-notes/docs/agent/architecture/index.md)
- Workflows: [`docs/agent/workflows/index.md`](file:///home/weihung/github-notes/docs/agent/workflows/index.md)
- Security & Guards: [`docs/agent/security/index.md`](file:///home/weihung/github-notes/docs/agent/security/index.md)
- MCP Server: [`docs/agent/mcp/index.md`](file:///home/weihung/github-notes/docs/agent/mcp/index.md)

## 4. Repo-Local Codex Skills

Repo-local skills are defined in `.agents/skills/`:
- `github-notes-dev`: Product development, testing, boundaries, and validation.
- `github-notes-workspace`: Initializing and manipulating workspaces, notebooks, notes, and manifests.
- `github-notes-core-update`: Safe fetch/merge updates from Core into user branches without data loss.
- `github-notes-mcp`: Developing, testing, and invoking the local MCP server safely.

## 5. Local MCP Usage & Safety

- Stdio transport is used for local agent integration.
- Strictly enforce repository root resolution, path traversal (`..`) prevention, and symlink escape rejection.
- Normal note mutation tools operate only on user branches (`main`).
- Multi-file saves are atomic and return git commit hashes.

## 6. Secrets Policy

- Never commit secrets, tokens, or API keys (`GEMINI_API_KEY`, `GH_TOKEN`, `GITHUB_NOTES_MCP_TOKEN`).
- Respect `.gitignore` for `.env*` files.
- `.env.example` contains only placeholder names.

## 7. Verification Commands

Before concluding any work on the product source:
```bash
pnpm test          # Run test suite across all packages
pnpm build         # Verify build succeeds cleanly
```
