# GitHub Notes

A Git-native, local-first notes application and agent-operable workspace frontend. Notes are stored as pure Markdown files with optional YAML frontmatter, organized into notebooks, and tracked via Git commits.

[English](README.md) · [繁體中文](README.zh-TW.md)

[Live Demo](https://my-gh-core.vercel.app) · [Example Repository](https://github.com/wayne930242/github-notes/tree/main)

## Branch Architecture

This repository uses a two-branch model to separate product source code from personal notes:

- **`core` (Default Branch)**: The canonical product branch. Contains application source code, packages, scripts, tests, and documentation. Never contains user notes.
- **`main`**: Your personal notes workspace branch. Created when you run `pnpm bootstrap-workspace`. Stores your notebooks, workspace configuration (`.github-notes.yaml`), and markdown notes (`notes/**`).

## Workspace Agent System

Each main workspace owns and tracks `AGENTS.md`, `.agents/`, and `.codex/`. Core keeps only product guidance and starter templates; updates preserve your Agent settings. Product contributors start with [the product instructions](docs/agent/product/index.md).

For an existing workspace's first migration, run `pnpm update-core --workspace /absolute/workspace/path` from the updated product checkout. See [initialization, migration and editable documents](docs/agent/workflows/workspace-agent-system.md).

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

Development commands read the local repository without GitHub sign-in, even if `.env` contains deployment settings. Set `REPO_ROOT=/path/to/workspace pnpm dev` to open another local checkout. To run with the configured source (including GitHub), use `pnpm --filter @github-notes/local-server start`; `pnpm dev:web` can run the frontend alongside it.

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

## Deploying to Vercel

GitHub Notes can be deployed to Vercel as a cloud-hosted, Git-backed workspace frontend. In production, notes are loaded directly from your GitHub repository branch, and user sessions are stored securely in Upstash Redis.

### 1. Register a GitHub OAuth App

To allow users to sign in with GitHub and commit notes:

1. Go to GitHub -> **Settings** -> **Developer Settings** -> **OAuth Apps** -> **New OAuth App** (or your organization's Developer Settings).
2. Configure the OAuth application:
   - **Application name**: e.g., `GitHub Notes`
   - **Homepage URL**: `https://<your-project>.vercel.app` (or your custom domain)
   - **Authorization callback URL**: `https://<your-project>.vercel.app/api/auth/github/callback`
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy the **Client Secret**.

> [!NOTE]
> Standard OAuth Apps request the `repo` scope to read and write notes on behalf of authenticated users.

### 2. Set Up Upstash Redis (Session Storage)

Vercel Serverless Functions require an external Redis instance to store encrypted user sessions and agent grants:

1. Create a free database at [Upstash Redis](https://upstash.com), or add the **Upstash Redis** integration directly from the Vercel Marketplace on your project dashboard.
2. Retrieve the REST connection credentials:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 3. Configure Environment Variables

Create or update `.env` with the following variables:

```bash
# Data source: connect to a GitHub repository
GITHUB_NOTES_SOURCE=github
GITHUB_NOTES_REPOSITORY=your-username/github-notes
GITHUB_NOTES_BRANCH=main

# Public URL and GitHub OAuth credentials
APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app

# 32+ character random secret (generate with: openssl rand -hex 32)
SESSION_SECRET=your_32_character_session_secret

# Upstash Redis REST API credentials
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token

# Optional: Gemini API key for AI-assisted semantic commit messages
GEMINI_API_KEY=your_gemini_api_key
```

### 4. Deploy with Vercel CLI or Dashboard

#### Option A: Using Vercel CLI

```bash
# Link the repository to your Vercel project
vercel link

# Import configured variables from .env to Vercel production
pnpm env:vercel production

# Deploy to production
vercel --prod
```

#### Option B: Using Vercel Dashboard

1. Import your Git repository into Vercel.
2. The included [`vercel.json`](vercel.json) automatically configures the build settings (`pnpm build`), output directory (`apps/web/dist`), and API rewrites (`/api/*`, `/mcp/*`).
3. Add the environment variables listed above under **Project Settings** -> **Environment Variables**.
4. Deploy the project.

## Documentation

- [Agent & Developer Documentation](docs/agent/index.md): Architecture, branch lifecycle, security boundaries, and MCP specifications.
- [Demo Workspace](examples/demo-workspace/README.md): Example notebooks, folder structure, and sample notes.

## License

MIT


## Screen Page

主導覽的 Screen 提供跨筆記本閱讀泳道。新增空白泳道後可釘選筆記、資料夾、資源或 YouTube；也可新增依標籤或資料夾自動列出內容的動態泳道。

每道可切換縮圖、小、中。拖曳把手可排序或跨自訂泳道移動；「泳道編輯」可命名、排序與移除泳道。動態泳道不接受項目拖入或拖出。滾輪在泳道標題或空白處左右捲動，在卡片內文優先上下閱讀；按住 Alt 暫停轉換，左右箭頭也能捲動。

「儲存配置」寫入工作區根目錄 `.github-notes-screen.yaml`。本地使用者再透過既有 Git 提交／同步流程將配置帶到其他機器；GitHub 來源則需要 main 分支寫入權限並直接提交這份檔案。Screen 不需要 Redis。此檔案屬於使用者工作區，不應放入產品 core 分支。取消釘選不會刪除原始內容。

Markdown 連結支援相對筆記與資料夾、跨筆記本路徑、標題錨點與外部網址。圖片可點選預覽，再選「在資源庫中顯示」定位原始資源。
