# GitHub Notes

以 Markdown 保存筆記，使用 Git 追蹤版本。你可以在本機工作，也可以讓網站讀取設定中的 GitHub 儲存庫。Notebook 支援巢狀資料夾、List／Card／Kanban 檢視與圖片。

[開啟公開範例網站](https://my-gh-core.vercel.app)，或查看 [範例筆記儲存庫](https://github.com/wayne930242/github-notes/tree/main)。範例的原始檔也放在 [`examples/demo-workspace`](examples/demo-workspace/README.md)，可複製到自己的筆記儲存庫。

## 在本機開始

準備 Node.js 22、pnpm 9 以上與 Git。從產品儲存庫複製程式，然後建立自己的工作區：

```bash
git clone <product-repository-url> github-notes
cd github-notes
pnpm install
pnpm build
pnpm bootstrap-workspace
pnpm dev
```

前端位於 `http://localhost:5173`，本機 API 位於 `http://127.0.0.1:4321`。
也可執行 `pnpm dev:server`，直接透過 `http://127.0.0.1:4321` 使用已建置的前端。

`bootstrap-workspace` 會建立或切換到 `main`，建立 `notes/.github-notes.yaml`、範例筆記及工作區指引，並提交初始化內容。既有筆記會保留。

- `core`：產品程式與文件。
- `main`：你的筆記工作區。一般筆記修改在此分支進行。

本機編輯會自動寫入工作目錄；使用畫面底部的 Commit 操作才產生 Git 提交。遠端編輯則使用 **Save to GitHub** 明確提交；若遠端已有更新，畫面會保留你的編輯並提示重新讀取，避免覆蓋別人的提交。

## 選擇本機或 GitHub 來源

程式的部署位置與筆記來源分開設定。一個 workspace 使用一個 repo，其中可以有多個 notebooks。

在程式根目錄建立 `github-notes.server.yaml`。選擇本機 repo：

```yaml
source:
  type: local
  path: /absolute/path/to/my-notes-repository
```

`path` 可以是絕對路徑，也可以相對於這份設定檔。省略設定時沿用目前的本機 repo；`REPO_ROOT` 可指定既有本機工作區。改用 GitHub：

```yaml
source:
  type: github
  repository: your-account/your-notes
  branch: main
```

重新啟動伺服器後生效。`GITHUB_NOTES_SERVER_CONFIG` 可指定另一份設定檔；也可用下列環境變數設定部署來源：

```dotenv
GITHUB_NOTES_SOURCE=github
GITHUB_NOTES_REPOSITORY=your-account/your-notes
GITHUB_NOTES_BRANCH=main
```

環境變數的來源設定優先於 YAML。來源資料不含 token。GitHub 來源會讀取目標 repo 的工作區 manifest；應用程式本身的 `origin` 不決定筆記來源。

公開 GitHub repo 可免登入唯讀瀏覽。私人 repo 需要登入，而且登入者必須能存取該 repo；遠端筆記寫入還需要 GitHub 寫入權限及 `main` 分支。遠端版本目前提供瀏覽、筆記建立與儲存，資產上傳／刪除、工作區設定修改與 Core 更新使用本機版。

## 設定 notebooks

筆記 repo 內優先讀取 `notes/.github-notes.yaml`，也支援 repo 根目錄的 `.github-notes.yaml`：

```yaml
schema_version: 1
workspace:
  title: My Notes
  default_notebook: personal
notebooks:
  - id: personal
    title: Personal
    root: notes/personal
    assets: assets
    default_view: list
  - id: work
    title: Work
    root: notes/work
    assets: assets
    default_view: kanban
files:
  hide_dotfiles: true
```

各 notebook 的 `root` 為 repo 相對路徑，彼此保持獨立，不互相包含。一般使用 `notes/` 底下的目錄。

### 巢狀資料夾

```text
notes/personal/
  welcome.md
  projects/
    _dir.yml
    planning.md
    backend/
      _dir.yml
      api.md
  assets/
    diagram.png
```

在子目錄放入 `_dir.yml` 定義顯示名稱與排序：

```yaml
title: Projects
order: 1
description: Active projects
```

沒有設定檔時使用原始目錄名。側欄會顯示資料夾層級，點選後包含其下所有子目錄筆記，並可繼續套用搜尋、狀態及標籤條件。選定資料夾後建立的新筆記會寫入該處。同名路徑會提示衝突。

Git 不追蹤空目錄；若希望遠端顯示尚無筆記的資料夾，提交該目錄的 `_dir.yml`。`order` 越小越靠前，順序相同再依顯示名稱排序。

### 筆記與圖片

```markdown
---
title: API plan
status: doing
tags: [backend, project]
---

# API plan

Content goes here.
```

額外的 frontmatter 欄位會保留。圖片連結相對於筆記檔案，例如 `projects/backend/api.md` 引用 notebook 的圖片時使用 `../../assets/diagram.png`。本機編輯器的 Asset 選擇器會計算相對路徑。Markdown 預覽會清理可執行的 HTML。

## GitHub 登入與環境變數

```bash
cp .env.example .env
```

`.env` 在程式根目錄，本機伺服器啟動時讀取。填入：

| 變數 | 內容 |
|---|---|
| `GITHUB_CLIENT_ID` | GitHub 應用程式的 Client ID |
| `GITHUB_CLIENT_SECRET` | 同一應用程式的 Client Secret |
| `GITHUB_APP_TYPE` | `oauth-app` 或 `github-app` |
| `APP_URL` | 本機 `http://localhost:4321`；正式環境 `https://my-gh-core.vercel.app` |
| `SESSION_SECRET` | 執行 `openssl rand -hex 32` 產生的隨機字串 |
| `UPSTASH_REDIS_REST_URL` | Vercel 持久 session 儲存的 Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | 同一個 Redis 的 REST token |
| `GEMINI_API_KEY` | 選填，本機 Git 語意提交訊息使用 |

GitHub callback 設定為：

```text
https://my-gh-core.vercel.app/api/auth/github/callback
```

本機測試請用對應本機 callback 的應用程式設定，並從 `http://localhost:4321` 操作完整登入流程。

已申請 OAuth App 的 Client ID／Secret 可以使用。OAuth App 私人 repo 存取採 `repo` scope；若要限定授權 repo 與 Contents 權限，可選 GitHub App，設定 `GITHUB_APP_TYPE=github-app` 並安裝到指定 repo。兩者都使用 GitHub 登入。[GitHub 官方比較](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)

瀏覽器 cookie 只存隨機 session ID。GitHub token 以 AES-GCM 加密後放在伺服器端；本機使用忽略於 Git 的 `.github-notes-sessions/`，Vercel 使用持久 Redis。新建瀏覽器 session 最長三十天，到期重新登入；登出會移除 session。MCP 授權獨立保存，持續有效直到手動撤銷。GitHub token 到期或權限被撤銷時，GitHub API 會拒絕存取。

## 部署到 Vercel

目標網址為 `https://my-gh-core.vercel.app`。Vercel 使用 GitHub 來源，透過 GitHub API 讀寫內容；本機檔案系統與 Git subprocess 工作流程留在本機版。

```bash
vercel login
vercel link --project my-gh-core
```

在 Vercel 專案的 Storage／Marketplace 加入 [Upstash Redis](https://vercel.com/marketplace/upstash)，取得上述兩個 Redis 變數。將 `.env` 的來源改為 `github`，填妥 repo、分支、GitHub 登入設定與正式 `APP_URL`：

```bash
pnpm env:vercel production
vercel --prod
```

`env:vercel` 把允許清單中的環境變數透過 CLI 標準輸入寫入 Vercel，支援覆寫既有值。它只輸出變數名稱；`.env` 與秘密值不會提交到 Git。預覽環境可執行 `pnpm env:vercel preview`。若要在預覽環境登入，使用固定預覽網址、對應的 `APP_URL` 與專屬 GitHub callback 設定，讓登入起點與回呼保持同一個網域。

部署上傳排除本機 `notes/`、`.env`、session 儲存與本機來源設定。公開筆記由執行時 API 讀取，私人內容先授權再讀取。未設定來源時，網站會顯示設定提示；登入變數未就緒時，公開唯讀功能仍可使用。

部署後驗收：公開 repo 免登入可讀、未登入不能寫、私人 repo 登入前沒有筆記內容、無權限使用者不能讀寫、具寫入權限者能提交、衝突不覆蓋已有提交。

## MCP：讓 agent 操作筆記

### 本機 stdio

先執行 `pnpm build`，在支援 MCP 的 agent 中加入：

```json
{
  "mcpServers": {
    "github-notes": {
      "command": "node",
      "args": ["/absolute/path/to/github-notes/packages/mcp-server/dist/index.js", "/absolute/path/to/github-notes"]
    }
  }
}
```

第二個路徑用來解析來源設定。本機來源沿用工作區分支與路徑限制；GitHub 來源以匿名唯讀方式操作公開 repo。

### 已登入的遠端 MCP

在網站登入後，開啟 **Settings → Access control**（或頂部 **Agent access**），為客戶端命名並選擇唯讀或可編輯授權。建立後會顯示完整 MCP URL，例如 `https://my-gh-core.vercel.app/mcp/<agent-access-token>`。將完整 URL 貼到 ChatGPT connector，認證方式選擇 **No Authentication**；URL 本身即包含授權憑證。支援自訂 Header 的客戶端也可使用 `/mcp` 加上 `Authorization: Bearer <agent-access-token>`。

新授權持續有效直到在 Access control 手動撤銷，不受瀏覽器登出、session 到期或重新部署影響。GitHub 本身的授權失效時需要重新登入，以更新伺服器保存的憑證。舊版八小時授權仍遵守原期限，可重新建立持續授權。

遠端 MCP 提供 `ls`、`glob`、`read`、`find`、`write`、`append`、`edit`、`mkdir`、`cp`、`mv`、`rm`，並保留原本的筆記讀寫工具。Shell 風格工具的行號從 1 開始，內容包含 YAML frontmatter；`find` 以文字搜尋搭配 glob 篩選檔案。先讀取取得 `revision`，再將它帶入寫入工具。每次成功異動都以一次原子 Git commit 更新遠端分支，commit message 由程式產生。異動需同時具有 agent 編輯授權、GitHub 寫入權限與 `main` 分支。工具宣告 input/output schema、structured output 與讀寫／破壞性 annotations。

`cp`、`mv`、`rm` 的目標限於筆記及資料夾 `_dir.yml`；目錄操作需明確指定 recursive，包含素材或受保護檔案的目錄會整筆拒絕。相對連結內容維持原樣，移動後可用 `edit` 更新。

### 網頁路由與遠端編輯

Markdown 筆記預設使用 Live Preview：同一區域呈現格式，游標所在行顯示 Markdown 語法。支援行內圖片、表格、勾選清單與復原，並可切換 Source。筆記素材視窗和 Assets 頁面共用資料夾、上傳、選取、View、Move 與二次確認 Delete；在筆記內點 Insert 才插入參照。新參照使用 Git blob hash 網址，移動素材後仍有效。舊路徑參照保持原格式；移動前可換成新 hash 參照。單檔上傳上限 3 MiB。

頁面提供 `/notes`、`/assets`、`/agent`、`/settings` 路由。Notebook 與筆記使用 `/notebooks/:id`、`/notebooks/:id/folders/*`、`/notebooks/:id/notes/*`，支援直接開啟、重新整理與瀏覽器上一頁／下一頁；檢視與篩選條件記錄於 query string。

遠端筆記開啟後每三十秒、視窗重新取得焦點及儲存前會檢查最新版本。可合併的獨立變更會保留雙方內容；內容或 frontmatter 衝突時停用編輯與儲存，必須先 **Refresh remote version**。原草稿仍可下載，重新整理頁面後也可取得備份。儲存 API 同時檢查 revision，拒絕過期寫入。

## 更新產品程式

在 `main` 上提交自己的工作，設定產品 upstream，然後執行：

```bash
git remote add upstream <product-repository-url>
pnpm update-core
```

更新器要求乾淨工作目錄，使用 `upstream/core` 或 `origin/core`，保護 `notes/`。遇到衝突會保留 Git 狀態供處理。

## 開發驗證

```bash
pnpm test
pnpm build
```

架構與開發規範見 [docs/agent](docs/agent/index.md)，本次來源與部署接續記錄見 [規格](docs/specs/2026-09-12-configurable-note-sources/spec.md)。
