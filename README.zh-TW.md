# MyGitNotes

一個高密度、本地優先的 Markdown 工作區，整合單字卡學習、閱讀屏幕與筆記關聯圖；以 Git 保存資料，支援 Docker、Docker Compose 與 Vercel 部署。

Markdown、儲存庫、部署、版本歷史與 Agent 存取權，全都由使用者掌控。

[English](README.md) · [繁體中文](README.zh-TW.md)

[線上展示](https://my-gh-core.vercel.app) · [範例儲存庫](https://github.com/wayne930242/MyGitNotes/tree/main)

## 這是什麼

MyGitNotes 把一個 Git 儲存庫變成集中處理筆記、文件、素材與 AI Agent 的工作區。你使用專為筆記設計的介面工作，而 Markdown 檔案、Git 歷史與儲存庫權限始終是資料的最終依據。

它有兩種運作模式：

- **本地模式：** 介面直接讀寫本機儲存庫。
- **遠端模式：** Docker／Docker Compose 或 Vercel 提供介面與 HTTP MCP 端點，GitHub 或 GitLab 保存檔案與 commit 歷史。

同一個工作區可以完全留在本機、透過 Git 在裝置間移動，也能讓瀏覽器與 MCP 用戶端遠端存取。依照自己的基礎設施，選擇自架 Node.js 容器或 serverless 部署。

## 核心功能

- **高密度筆記介面：** 清單、卡片與看板檢視；全文搜尋；標籤與狀態；巢狀資料夾；資料夾索引卡；Markdown 編輯與即時預覽；素材管理；桌面與行動裝置響應式版面。
- **單字卡學習模式：** 把 Markdown 筆記變成單字或任意主題的問答卡；揭示多頁答案、評估熟悉程度，依到期時間複習。每條泳道可設定狀態階段與間隔，並支援自由閱讀、延後與撤銷最近操作。
- **屏幕：** 把不同筆記本的筆記、資料夾、圖片與 YouTube 影片排進閱讀泳道；可釘選、排序，也能依標籤或資料夾動態收集內容，各泳道獨立設定排序與卡片大小。
- **筆記關聯圖：** 用互動圖探索筆記間的連結，支援縮放、平移、拖曳節點、查看相鄰筆記與開啟筆記；可依資料夾、筆記本或狀態配色。
- **純 Markdown：** 筆記是一般 `.md` 檔，可選用 YAML frontmatter。既有 Markdown 與未知 metadata 在讀寫後仍會保留。
- **Git 原生工作流：** 本地編輯先寫入磁碟，再由你明確選取並提交。遠端寫入使用 revision 檢查與非強制 commit，拒絕覆蓋過期版本。
- **本地與遠端來源：** 用同一套介面開啟本機 checkout 或指定的 GitHub 或 GitLab 儲存庫。
- **本地與託管 MCP：** Agent 可透過本地 stdio、自架或 Vercel 託管的 Streamable HTTP，列出、讀取、搜尋、建立、編輯、移動與提交工作區內容。
- **可控的 Agent 權限：** 建立具名的唯讀或寫入授權；連線網址只顯示一次，任何授權都能隨時個別撤銷。
- **安全的產品更新：** 產品程式碼放在 `core`，個人工作區放在 `main`；更新 Core 時保留 `notes/**` 與工作區自己的 Agent 設定。

## 特色導覽

以下截圖來自本機 Docker 部署，使用示範筆記。

### 單字卡學習與閱讀模式

從屏幕的任一泳道開始學習。Markdown 第一頁是題目，其餘頁是答案；使用前後保留空行、獨立一行的 `---` 分頁。沒有分頁的筆記，以標題為題目、正文為答案。

揭示答案後，選擇「忘記」、「吃力」、「記得」或「輕鬆」。泳道設定把每個階段對應到筆記狀態與間隔天數；評分成功時，一起保存狀態、到期時間與學習歷史。可篩選全部、到期、未來或暫停卡片，切換自由閱讀，並在手機上使用滑動手勢。屏幕配置與學習進度保存在工作區 YAML，隨 Git 同步。

![揭示單字答案的學習模式](docs/assets/feature-study.png)

### 屏幕：跨筆記本的閱讀桌面

把相關筆記與素材並排閱讀。自訂泳道放置釘選內容，動態泳道依標籤或資料夾收集內容；各自設定縮圖、小、中卡片與排序，並可進入專屬學習頁。圖片保持比例，YouTube 卡片在播放時才載入嵌入播放器。

![閱讀與學習泳道組成的屏幕](docs/assets/feature-screen.png)

### 筆記關聯圖

開啟「關聯圖」，查看 Markdown 連結如何串起筆記。透過縮放、平移、拖曳節點與相鄰筆記高亮探索內容，並直接開啟筆記閱讀或編輯。手機可從筆記的檢視選單進入。可搜尋筆記、依標籤篩選、選擇資料夾／筆記本／狀態配色，並透過小地圖導覽。圖形直接從筆記與連結產生。

![互動筆記關聯圖](docs/assets/feature-graph.png)

## 設計邏輯

![MyGitNotes architecture](docs/assets/mygitnotes-architecture-zh-TW.png)

各層的責任刻意分開：

- **Markdown 掌管內容。** 沒有需要匯出的專有筆記資料庫。
- **Git 掌管歷史與發布。** 你決定提交哪些變更，也能檢查或還原每一次修改。
- **GitHub 或 GitLab 掌管遠端保存。** Docker／Compose 或 Vercel 提供介面與 MCP 傳輸。Compose 自帶 Redis 與持久化 volume，保存加密 session 與 MCP 授權；單獨使用 Docker 可選原生 Redis 或 session volume，Vercel 則使用 Redis REST。筆記留在 Git。
- **使用者掌管系統邊界。** 儲存庫、分支、部署、憑證、Core 更新與每一筆 Agent 授權都由你決定。
- **介面與 Agent 遵守同一套規則。** 路徑限制、分支限制、revision 檢查與儲存庫權限同時約束兩者。

## 為什麼要把兩邊接起來

市面上的筆記工具通常把這兩種路線當成不同的產品模型：

- **像 [Obsidian](https://obsidian.md/blog/free-your-notes/) 的本地優先：** 一般檔案保存在自己的裝置上，可離線使用，也能直接透過 IDE、CLI 或本地 Agent 編輯。
- **像 [Craft](https://support.craft.do/en/account-and-subscription/data-and-security/data-storage)／[Notion](https://www.notion.com/help/notion-for-web) 的雲端文件：** 提供完整的瀏覽器與多裝置體驗，以及自動同步、分享和遠端協作。

即使同一產品支援兩種模式，通常也只是二選一。以 Craft 為例，它支援本地 [External Locations](https://support.craft.do/en/account-and-subscription/storage-and-recovery/external-locations)，但該模式不提供內建分享與協作。

MyGitNotes 則把兩種介面接到同一個 Markdown 與 Git 工作區。本地 UI 和本地 Agent 直接編輯檔案；Git 將內容同步到 GitHub 或 GitLab；自架容器或 Vercel 再以同一個儲存庫提供高密度遠端筆記介面與 HTTP MCP。不需要匯出、匯入或對帳第二份雲端副本。

## 儲存庫模型

- **`core`**：產品原始碼、套件、測試、指令稿與說明文件，不包含個人筆記。
- **`main`**：你的工作區分支，包含 `.github-notes.yaml`、`notes/**`、素材與工作區 Agent 設定。

這個分離讓產品可以持續更新，卻不取得你內容的所有權。

## 快速開始

需要 Node.js 22+、pnpm 9+ 與 Git。

```bash
git clone <repository-url> mygitnotes
cd mygitnotes
pnpm install
pnpm build
pnpm bootstrap-workspace
pnpm dev
```

開啟 [http://localhost:5173](http://localhost:5173)。開發指令直接使用本機儲存庫，不需要平台登入。

若要開啟另一個 checkout：

```bash
REPO_ROOT=/absolute/path/to/workspace pnpm dev
```

若要從產品分支更新既有工作區：

```bash
git remote add upstream <product-repository-url>
pnpm update-core
```

## Docker 與 Docker Compose 部署

容器在 `4321` port 提供建置後的網頁介面、API、素材與 Streamable HTTP MCP，支援本地、GitHub 與 GitLab 來源。從產品 checkout 建置映像；遠端筆記保存在指定的工作區儲存庫與分支。

### Docker Compose：連接遠端儲存庫

```bash
cp docker.env.example .env.docker
# Edit .env.docker: repository, APP_URL, OAuth credentials, SESSION_SECRET.
# Generate SESSION_SECRET once with: openssl rand -hex 32

docker compose up -d --build
docker compose logs -f mygitnotes
```

Compose 會一併啟動 MyGitNotes 與 Redis，等待 Redis 健康檢查通過後，透過內部網路以 `REDIS_URL=redis://redis:6379` 連線。Redis 使用 append-only 持久化，資料保存在 `redis-data` volume，並且只供容器內部連線。此部署不需要 Upstash 帳號。

開啟 [http://localhost:4321](http://localhost:4321)。公開部署時，讓 HTTPS 反向代理轉送到 `127.0.0.1:4321`、保留公開 Host header，並設定 `APP_URL=https://notes.example.com`。GitHub OAuth App 的 callback 設為 `${APP_URL}/api/auth/github/callback`；GitLab 使用[下方設定](#gitlab-部署)。代理需轉送所有路徑，包括 `/api/*`、`/mcp/*`、`/raw-assets/*`，並允許 MCP 串流回應。若代理也在容器內，讓它加入應用程式網路並轉送到 `mygitnotes:4321`。

Compose 預設只在 localhost 發布 port。以 `MYGITNOTES_PORT` 調整主機 port，並將 `APP_URL` 設為瀏覽器實際使用的網址；`MYGITNOTES_ENV_FILE` 可指定另一份環境檔。登入後，在「設定 → MCP 存取控制」建立連線，使用 `${APP_URL}/mcp/<token>`。

### Docker：連接遠端儲存庫

沿用同一份 `.env.docker`：

```bash
docker build -t mygitnotes:local .
docker volume create mygitnotes-sessions
docker run -d --name mygitnotes --init --restart unless-stopped \
  -p 127.0.0.1:4321:4321 \
  --env-file .env.docker \
  --mount type=volume,source=mygitnotes-sessions,target=/app/.github-notes-sessions \
  mygitnotes:local
```

### 在容器中開啟本地 checkout

準備位於 `main` 分支、包含 `.github-notes.yaml` 與筆記的既有工作區 checkout。容器以 UID/GID `1000:1000` 執行；Linux 上需讓該使用者可讀寫掛載目錄，並在工作區設定 Git 提交者（`git config user.name`、`git config user.email`）。

```bash
WORKSPACE_PATH=/absolute/path/to/workspace \
  docker compose -f compose.local.yaml up -d --build
```

或直接執行映像：

```bash
docker run -d --name mygitnotes-local --init --restart unless-stopped \
  -p 127.0.0.1:4321:4321 \
  -e MYGITNOTES_SOURCE=local -e MYGITNOTES_LOCAL_PATH=/workspace \
  -e APP_URL=http://localhost:4321 \
  --mount type=bind,source=/absolute/path/to/workspace,target=/workspace \
  mygitnotes:local
```

開啟 `http://localhost:4321`。本地模式提供免登入的桌面工作流程，限 loopback host 存取；公開網站請選用 GitHub 或 GitLab 來源及 OAuth。編輯結果、屏幕與學習 YAML 保存在掛載的 checkout，使用既有 Git 工作流程提交與同步；需要遠端 Git 操作時，另行設定其憑證。

### 持久化與更新

Compose 的自架 Redis 保存加密 session、平台憑證與 MCP 授權。更換容器時，保留 `redis-data` volume 與相同的 `SESSION_SECRET`，並一起備份。單獨使用 Docker 的範例改用 `mygitnotes-sessions` volume；也可設定 `REDIS_URL=redis://...` 或 `rediss://...` 連接自己的 Redis。原生 Redis 設定優先於 REST。同一部署的多個實例共用儲存與 secret；不同部署使用各自的儲存，或透過 `MYGITNOTES_SESSION_NAMESPACE` 區分 Redis key。Vercel 的檔案系統是暫存空間，因此使用 Redis REST。

更新產品 checkout 後執行 `docker compose up -d --build`。`docker compose down` 保留 Redis volume；`docker compose down -v` 會刪除它，使已存 session 與授權失效。本地模式的更新與停止指令使用 `-f compose.local.yaml`。映像的健康檢查確認 HTTP 服務存活；來源存取另以 `/api/workspace` 驗證。

參考：[Compose 設定](compose.yaml)、[本地設定](compose.local.yaml)、[環境變數範本](docker.env.example)、[Docker Compose 官方說明](https://docs.docker.com/reference/compose-file/services/)。

## Vercel 部署（選用）

將 `main` 分支部署到你自己的 Vercel 專案。隨附的 [`vercel.json`](vercel.json) 會建置網頁介面，並將 `/api/*`、`/mcp/*` 與 `/raw-assets/*` 導向 serverless API。

你需要：

1. GitHub OAuth App，callback URL 設為 `https://<your-project>.vercel.app/api/auth/github/callback`。
2. Upstash Redis，用來保存加密的瀏覽器 session 與持久 MCP 授權。
3. 以下 Vercel 環境變數：

```bash
MYGITNOTES_SOURCE=github
MYGITNOTES_REPOSITORY=your-username/your-repository
MYGITNOTES_BRANCH=main

APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app
SESSION_SECRET=your_random_secret_of_at_least_32_characters

UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
# Optional for a new deployment sharing Redis
MYGITNOTES_SESSION_NAMESPACE=your_unique_deployment_name
```

部署後以 GitHub 登入，在「**設定 → MCP 存取控制**」建立唯讀或寫入授權，再把產生的 `/mcp/<token>` 網址貼到 ChatGPT、Claude、Cursor、Windsurf 或其他 MCP 用戶端。

標準 GitHub OAuth App 會要求 `repo` scope，讓通過驗證的擁有者讀寫私人儲存庫。MCP 授權只適用於指定的儲存庫，並可逐一撤銷。

## GitLab 部署

每個部署指定一個平台、站台、專案與分支。Docker 將以下設定寫入 `.env.docker`；Vercel 則使用專案環境變數。保留所選部署的 APP_URL、SESSION_SECRET 與儲存設定，來源與 OAuth 改用：

```bash
MYGITNOTES_SOURCE=gitlab
MYGITNOTES_REPOSITORY=group/subgroup/project
MYGITNOTES_BRANCH=main
MYGITNOTES_GITLAB_URL=https://gitlab.com
GITLAB_CLIENT_ID=your_application_id
GITLAB_CLIENT_SECRET=your_application_secret
```

自架 GitLab 的 `MYGITNOTES_GITLAB_URL` 填入 HTTPS 站台網址；安裝於子路徑時包含該路徑。部署環境須能連線至該站台，並信任其 TLS 憑證。在所選站台註冊 OAuth application，啟用 `api` scope，callback 設為 `${APP_URL}/api/auth/gitlab/callback`。介面會顯示 GitLab 登入入口。Access token 與 refresh token 加密保存在伺服器端，持久 MCP 授權共用更新後的憑證。

登入帳號需有 `main` 的 push 權限才能寫入。GitLab 將多檔修改批次提交為一個 commit，並以各既有檔案的最後提交 ID 檢查並行修改。公開儲存庫支援匿名讀取。內網 GitLab 須搭配能連入該網路的部署環境。

產品已更名為 **MyGitNotes**。既有 `.github-notes.yaml`、Screen／Study 側錄檔、`@github-notes/*` 套件、GitHub OAuth callback 及 MCP 授權保持相容。新的 `MYGITNOTES_*` 來源設定優先於對應的 `GITHUB_NOTES_*`。伺服器設定新名稱為 `mygitnotes.server.yaml`，同時支援 `github-notes.server.yaml`。正式儲存庫為 `wayne930242/MyGitNotes`，部署網址維持不變。Repo 更名後直接更新來源的儲存庫路徑；綁定舊路徑的 MCP 授權需要重新建立。

參考：[GitLab OAuth](https://docs.gitlab.com/api/oauth2/)、[批次提交](https://docs.gitlab.com/api/commits/)。

## 說明文件

- [Agent 與開發者說明](docs/agent/index.md)
- [系統架構](docs/agent/architecture/index.md)
- [MCP 介面與安全模型](docs/agent/mcp/index.md)
- [展示工作區](examples/demo-workspace/README.md)

## 授權

MIT
