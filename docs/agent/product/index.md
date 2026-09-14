# MyGitNotes — Product Agent Instructions

Welcome to the **MyGitNotes** product codebase. This document guides AI coding and maintenance agents working on the application source code and infrastructure.

## 1. What MyGitNotes Is

MyGitNotes is a Git-native, local-first notes application and agent-operable workspace frontend. It stores notes as pure Markdown with optional YAML frontmatter, provides List, Card, and Kanban views, tracks every explicit save as a Git commit, and exposes a safe local MCP interface for coding agents.

## 2. Branch & Ownership Contract

- **`core`**: Canonical product branch and default branch of the public repository. Contains application source code, packages, scripts, tests, Agent templates, and documentation. Never contains real user data.
- **`main`**: User workspace branch created after cloning via `pnpm bootstrap-workspace`. Contains user workspace config (`/.github-notes.yaml`) and user notes (`notes/**`). In the public repository, `main` also serves as the demo workspace branch and is **automatically merged with `core` via GitHub Actions (`.github/workflows/release-main.yml`)** whenever `core` is pushed.

### Path Ownership Invariants
- **Core-owned paths**: `apps/**`, `packages/**`, `scripts/**`, `docs/**`, `examples/**`, `README.md`, `package.json`, `pnpm-workspace.yaml`.
- **User-owned paths**: `notes/**`, `/.github-notes.yaml`, `/AGENTS.md`, `/CLAUDE.md`, `/GEMINI.md`, `/.agents/**`, `/.codex/**`, `/.claude/**`, `/.agent/**`. Core must not track workspace Agent files; keep product guidance here and starter templates in `examples/workspace-agent-system/`.
- **Rule**: NEVER overwrite, alter, or delete content under `notes/**` during Core maintenance or Core update merges.

## 3. Product Documentation Map

Detailed architecture, security, and workflow guides live in `docs/agent/`:
- Overview: [`docs/agent/index.md`](../index.md)
- Architecture: [`docs/agent/architecture/index.md`](../architecture/index.md)
- Workflows: [`docs/agent/workflows/index.md`](../workflows/index.md)
- Security & Guards: [`docs/agent/security/index.md`](../security/index.md)
- MCP Server: [`docs/agent/mcp/index.md`](../mcp/index.md)

## 4. Repo-Local Codex Skills

Product development skills are maintained in `docs/agent/product/skills/`:
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
pnpm check:core-ownership # Verify workspace paths are absent from the Core index
pnpm test          # Run test suite across all packages
pnpm build         # Verify build succeeds cleanly
```


### Screen 配置所有權

工作區根目錄 `.github-notes-screen.yaml` 是使用者資料。Core 不得追蹤真實配置，工作區更新必須保留此檔案；測試配置只建立於隔離暫存工作區。

### 學習資料所有權

工作區根目錄 `.github-notes-study.yaml` 保存使用者的卡片對應、排程與事件。Core 維護及更新保留此檔案；示範正文位於 `examples/study/`，測試學習紀錄建立於隔離工作區。使用方式見 [學習指南](../study.md)。
