# GitHub Notes

GitHub Notes 是 Git 原生、本地優先的**高密度功能性筆記本**。每個筆記本服務一個明確用途，保有自己的內容、結構與工作規則。筆記以純 Markdown 檔案儲存（支援選填的 YAML frontmatter），透過 Git 追蹤版本，也能由 Agent 在相同的筆記本範圍內協作。

[English](README.md) · [繁體中文](README.zh-TW.md)

[線上展示（Live Demo）](https://my-gh-core.vercel.app) · [範例儲存庫](https://github.com/wayne930242/github-notes/tree/main)

## 產品定位：為正在進行的事建立筆記本

GitHub Notes 的使用情境包括 TRPG 遊戲準備、單次專案的設計文件、單字背誦計畫等。筆記本集中放置這件事需要的筆記、資源、操作規則與進度，支援過程中密集的查閱、修改和協作。

產品的特色在於**隔離**。每個筆記本有自己的情境與組織方式，不必把不同用途的資料整合成同一個系統。屏幕等跨筆記本檢視，是使用者主動選取的參照方式；各筆記本的內容歸屬與工作界線仍然保留。

這與長期知識庫的需求有所不同。Obsidian 可以承載長期累積、較低密度回訪的資料；GitHub Notes 則服務特定活動中高密度使用的功能性筆記。組織內容時，優先問的是：**這本筆記本要幫我完成什麼事？**

## 分支架構（Branch Architecture）

本儲存庫採用雙分支模型，將產品原始碼與個人筆記完全隔離：

- **`core`（預設分支）**：標準產品核心分支。包含應用程式原始碼、套件、指令稿、測試與說明文件。絕不包含使用者個人筆記。
- **`main`**：個人筆記工作區分支。於執行 `pnpm bootstrap-workspace` 時建立。存放筆記本、工作區設定檔（`.github-notes.yaml`）以及 Markdown 筆記（`notes/**`）。

## 工作區 Agent System

每個 main 工作區自行追蹤 `AGENTS.md`、`.agents/` 與 `.codex/`。Core 僅維護產品指引及初始範本，更新會保留工作區的 Agent 設定。產品開發請先閱讀[產品指引](docs/agent/product/index.md)。

既有工作區第一次遷移，請從已更新的產品目錄執行 `pnpm update-core --workspace /absolute/workspace/path`。詳細流程與介面支援範圍見[工作區 Agent System](docs/agent/workflows/workspace-agent-system.md)。

## 快速開始（Quick Start）

### 先決條件
- Node.js 22+
- pnpm 9+
- Git

### 安裝與設定

```bash
# 複製儲存庫（預設檢出 `core` 分支）
git clone <repository-url> github-notes
cd github-notes

# 安裝相依套件並建置專案
pnpm install
pnpm build

# 初始化個人工作區分支（會建立並切換至 `main` 分支）
pnpm bootstrap-workspace

# 啟動本地開發伺服器
pnpm dev
```

在瀏覽器中開啟 [http://localhost:5173](http://localhost:5173)。本地 API 執行於 `http://127.0.0.1:4321`。
亦可執行 `pnpm dev:server` 直接在 `http://127.0.0.1:4321` 預覽建置後的前端。

開發指令會直接讀取本地儲存庫，不需要 GitHub 登入，即使 `.env` 中保留了部署設定也一樣。可用 `REPO_ROOT=/path/to/workspace pnpm dev` 開啟另一個本地工作區。若要依設定使用 GitHub 等資料來源，請執行 `pnpm --filter @github-notes/local-server start`，並搭配 `pnpm dev:web` 啟動前端。

## 主要特色（Key Features）

- **本地優先與 Git 原生（Local-First & Git-Native）**：完整的本地檔案系統控制權。編輯內容會立即儲存於本地；點擊頁尾的 Commit 即可將選取的筆記變更打包為單一 Git commit 發布。
- **靈活的筆記檢視模式**：隨時在清單（List）、卡片（Card）與看板（Kanban）檢視之間即時切換。
- **階層式目錄結構**：支援在巢狀目錄中組織筆記。可透過選用的 `_dir.yml` 檔案自訂目錄標題與排序。
- **多種筆記來源設定**：可直接操作本機檔案系統，或連線至遠端 GitHub 儲存庫。
- **AI Agent 整合（MCP）**：內建 Model Context Protocol (MCP) 伺服器，支援本機（stdio）與遠端 AI Coding Agent。
- **安全的 Core 核心更新**：可隨時透過 `pnpm update-core` 取得最新產品原始碼，同時確保 `notes/**` 中的個人筆記完好無損。

## 保持 Core 核心更新（Keeping Core Updated）

若要將產品儲存庫的最新更新同步至個人工作區：

```bash
git remote add upstream <product-repository-url>
pnpm update-core
```

此指令會將 `upstream/core` 的最新變更合併至目前分支，且不會修改您的個人筆記。

## 部署至 Vercel（Deploying to Vercel）

GitHub Notes 可作為雲端託管、Git 後端的 workspace 前端部署至 Vercel。在正式環境中，筆記會直接從 GitHub 儲存庫分支讀取，使用者工作階段（session）則安全地儲存在 Upstash Redis。

### 1. 註冊 GitHub OAuth App

為了讓使用者能透過 GitHub 登入並提交筆記：

1. 前往 GitHub -> **Settings** -> **Developer Settings** -> **OAuth Apps** -> **New OAuth App**（或所屬組織的 Developer Settings）。
2. 設定 OAuth 應用程式：
   - **Application name**：例如 `GitHub Notes`
   - **Homepage URL**：`https://<your-project>.vercel.app`（或自訂網域）
   - **Authorization callback URL**：`https://<your-project>.vercel.app/api/auth/github/callback`
3. 點擊 **Register application**。
4. 複製 **Client ID**。
5. 點擊 **Generate a new client secret** 並複製 **Client Secret**。

> [!NOTE]
> 標準 OAuth App 需要請求 `repo` scope 權限，以代表通過驗證的使用者讀取與寫入筆記。

### 2. 設定 Upstash Redis（工作階段儲存）

Vercel Serverless Functions 需要外部 Redis 執行個體來儲存加密的使用者工作階段（session）與 Agent 授權權杖：

1. 在 [Upstash Redis](https://upstash.com) 建立免費資料庫，或直接在 Vercel 專案儀表板的 Marketplace 新增 **Upstash Redis** 整合。
2. 取得 REST 連線憑證：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 3. 設定環境變數

建立或更新 `.env` 檔案並填入以下變數：

```bash
# 資料來源：連線至 GitHub 儲存庫
GITHUB_NOTES_SOURCE=github
GITHUB_NOTES_REPOSITORY=your-username/github-notes
GITHUB_NOTES_BRANCH=main

# 公開網址與 GitHub OAuth 憑證
APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app

# 32 字元以上的隨機密鑰（可使用 openssl rand -hex 32 產生）
SESSION_SECRET=your_32_character_session_secret

# Upstash Redis REST API 憑證
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token

# 選填：用於 AI 輔助語意化 Commit 訊息的 Gemini API 金鑰
GEMINI_API_KEY=your_gemini_api_key
```

### 4. 使用 Vercel CLI 或儀表板進行部署

#### 方法 A：使用 Vercel CLI

```bash
# 將本機儲存庫連結至 Vercel 專案
vercel link

# 將 .env 中設定的變數匯入至 Vercel 正式環境
pnpm env:vercel production

# 部署至正式環境
vercel --prod
```

#### 方法 B：使用 Vercel 儀表板

1. 將 Git 儲存庫匯入至 Vercel。
2. 專案隨附的 [`vercel.json`](vercel.json) 會自動套用建置設定（`pnpm build`）、輸出目錄（`apps/web/dist`）與 API 重寫規則（`/api/*`、`/mcp/*`）。
3. 在 **Project Settings** -> **Environment Variables** 新增上方列出的環境變數。
4. 點擊部署。

## 說明文件（Documentation）

- [Agent 與開發者說明文件](docs/agent/index.md)：架構設計、分支生命週期、安全界限與 MCP 規範。
- [展示工作區（Demo Workspace）](examples/demo-workspace/README.md)：範例筆記本、目錄結構與範例筆記。

## 授權條款（License）

MIT


## 屏幕

屏幕以泳道跨筆記本整理閱讀、圖片與 YouTube。自訂泳道可自由釘選項目，也能建立依標籤或資料夾自動帶入內容的動態泳道。每道支援縮圖、小、中三種顯示方式；可在自訂泳道之間拖曳項目，透過 sidebar 新增、命名及排序泳道。

配置會自動保存。本地寫入工作區根目錄的 `.github-notes-screen.yaml`；GitHub 模式先保留本機草稿，再由共用浮動提交列統一檢視及提交，可與選取的筆記一起提交。配置隨工作區 Git 同步，不需要 Redis；取消釘選不會刪除原始內容。

滾輪可左右捲動泳道，筆記內文優先保留上下閱讀；按住 Alt 暫停方向轉換，也可使用左右箭頭。

## 資料夾整理

筆記 sidebar 可新增資料夾。拖到插入線可調整同層順序，拖到資料夾中央可變更層級；選單也提供「移動與排序」對話框。刪除時預設將內容移到上層，也能指定其他資料夾，完整保留筆記與子資料夾；有同名衝突時拒絕覆蓋。可解析的 Markdown 連結及屏幕參照會隨搬移更新，資料夾順序保存在 `_dir.yml`。

筆記的「攤開」檢視會列出目前資料夾及所有子資料夾的筆記，不再分資料夾呈現。

在筆記本根目錄或任意子資料夾放入 `index.md`，該資料夾的列表、卡片及看板上方便會顯示其 Markdown 正文。相對連結與圖片沿用一般筆記的操作方式，可點「開啟索引筆記」進入編輯器；檔案仍保留在一般筆記清單中。介紹區遵守隱藏筆記設定，搜尋、狀態／標籤篩選及「攤開」時不顯示。
