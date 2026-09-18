# MyGitNotes — Product Agent Instructions

Welcome to the **MyGitNotes** product codebase. This document guides AI coding and maintenance agents working on the application source code and infrastructure.

## 1. What MyGitNotes Is

MyGitNotes is a Git-native, local-first notes application and agent-operable workspace frontend. It stores notes as pure Markdown with optional YAML frontmatter, provides List, Card, and Kanban views, tracks every explicit save as a Git commit, and exposes a safe local MCP interface for coding agents.

## 2. Branch & Ownership Contract

- **`core`**: Canonical product branch and default branch of the public repository. Contains application source code, packages, scripts, tests, Agent templates, and documentation. Never contains real user data.
- **`main`**: User workspace branch created after cloning via `pnpm bootstrap-workspace`. Contains user workspace config (`/.mygitnotes.yaml`, or the legacy `/.github-notes.yaml`) and user notes (`notes/**`). In the public repository, `main` also serves as the demo workspace branch and is **automatically merged with `core` via GitHub Actions (`.github/workflows/release-main.yml`)** whenever `core` is pushed.

### Path Ownership Invariants
- **Core-owned paths**: `apps/**`, `packages/**`, `scripts/**`, `docs/**`, `examples/**`, `README.md`, `package.json`, `pnpm-workspace.yaml`.
- **User-owned paths**: `notes/**`, `/.mygitnotes.yaml` (or legacy `/.github-notes.yaml`), `/AGENTS.md`, `/CLAUDE.md`, `/GEMINI.md`, `/.agents/**`, `/.codex/**`, `/.claude/**`, `/.agent/**`. Core must not track workspace Agent files; keep product guidance here and starter templates in `examples/workspace-agent-system/`.
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

- Never commit secrets, tokens, or API keys (`GEMINI_API_KEY`, `GH_TOKEN`, `SESSION_SECRET`).
- Respect `.gitignore` for `.env*` files.
- `.env.example` contains only placeholder names.

## 7. Verification Commands

Before concluding any work on the product source:
```bash
pnpm check:core-ownership # Verify workspace paths are absent from the Core index
pnpm test          # Run test suite across all packages
pnpm build         # Verify build succeeds cleanly
```

Browser QA scripts (`node scripts/qa-*.mjs`) drive the built `apps/local-server/dist` and `apps/web/dist` output; outside Linux, set `PUPPETEER_EXECUTABLE_PATH` (`GRAPH_QA_CHROME` for `qa-graph-*.mjs`) to a local Chrome binary.


### Screen 配置所有權

工作區根目錄 `.github-notes-screen.yaml` 是使用者資料。Core 不得追蹤真實配置，工作區更新必須保留此檔案；測試配置只建立於隔離暫存工作區。

配置 `version: 2` 的每條泳道記錄 `notebookId`，自訂項目與動態來源必須屬於該筆記本。`readScreenPage` 讀取 `version: 1` 時依來源歸屬泳道、拆分混合筆記本的自訂泳道，無法判斷時歸預設筆記本；下次儲存寫回 `version: 2`。

### 學習資料所有權

工作區根目錄 `.github-notes-study.yaml` 保存使用者的卡片對應、排程與事件。Core 維護及更新保留此檔案；示範正文位於 `examples/study/`，測試學習紀錄建立於隔離工作區。使用方式見 [學習指南](../study.md)。

### Focus 配置所有權

工作區根目錄 `.github-notes-focus.yaml` 保存使用者具名 Focus 的名稱、劃分與各窗格的 tab。
Core 不得追蹤真實配置，工作區更新必須保留此檔案；測試配置只建立於隔離暫存工作區。
每個 Focus 記錄 `notebookId`，tab 只參照該筆記本的筆記或河道；(current) 與作用窗格等檢視狀態只存在瀏覽器。

### 工作區文件

Screen、學習資料與 Focus 配置登錄在 `packages/core/src/workspace-documents.ts`，登錄決定可提交的範圍、大小上限、格式驗證，以及搬移筆記或資料夾時如何更新參照。
新增工作區根目錄的使用者檔案時，加入登錄與上述所有權清單（`scripts/lib/workspace-agent-merge.mjs`）。
