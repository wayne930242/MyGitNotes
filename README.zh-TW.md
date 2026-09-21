# MyGitNotes

以本機為主的 Markdown 工作區，整合筆記、單字卡、閱讀屏幕與知識圖譜。內容保存在 Git；可在本機使用，也能透過 Docker、Docker Compose 或 Vercel 部署。

[English](README.md) · [繁體中文](README.zh-TW.md)

[線上展示](https://my-gh-core.vercel.app) · [單字卡展示](https://my-gh-core.vercel.app/screen/lanes/explore) · [範例工作區](https://github.com/wayne930242/MyGitNotes/tree/main)

![MyGitNotes architecture](docs/assets/mygitnotes-architecture-zh-TW.png)

## 為什麼要把兩邊接起來

本機優先工具讓檔案留在自己的裝置；雲端文件工具則提供瀏覽器與多裝置體驗。MyGitNotes 讓兩種使用方式共用同一個 Markdown 與 Git 工作區。不需要匯出、匯入或對帳第二份雲端副本。

## 運作方式

Markdown 是內容來源，Git 記錄並發布變更，儲存庫擁有者管理憑證與存取權。介面與 MCP endpoint 可在本機、Docker 容器或 Vercel 執行。遠端模式讀寫指定的 GitHub 或 GitLab 儲存庫；Compose 可提供 Redis 保存 session 與 MCP 授權。

同一個儲存庫以兩個分支、兩個 worktree 管理：

- **core** 放置產品程式碼、套件、測試、腳本與文件。
- **main** 放置工作區設定、筆記本、素材與工作區 Agent 設定。

Core 更新會 fast-forward 產品分支並保留工作區內容；產品程式碼不會存放個人筆記。

「檔案」頁可管理筆記本資料夾、Markdown 筆記、文字檔與附件。上傳上限為 3 MiB；讀取與修改內容上限為 5 MiB，每次操作最多 200 個異動檔案。

## 部署

選擇符合 hosting 設定的部署方式。

### 透過 GitHub Actions sparse checkout 部署至 Vercel（預設）

#### Vercel 部署準備

**帳號與服務**

- Vercel 專案、含 core 與 main 分支的 GitHub 儲存庫，以及 Upstash Redis database。
- 使用 GitHub 登入時，準備 GitHub OAuth App，並將 OAuth callback 設為 `https://<your-project>.vercel.app/api/auth/github/callback`。
- 使用 GitLab 登入時，準備 [GitLab 來源設定](#gitlab-來源設定) 所述的 GitLab OAuth App。

**要產生的值**

- 在第一個階段前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。
- 在第一個階段前於 Vercel Account Settings → Tokens 建立 `VERCEL_TOKEN`，Scope 設為擁有此專案的 team，並留存 token。

**要安裝的工具**

- 安裝 Vercel 與 GitHub CLI。

#### 設定 runtime values

1. 登入 Vercel CLI：`vercel login`
2. 登入 GitHub CLI：`gh auth login`
3. 在 Core checkout 連結 Vercel 專案：`vercel link`。從產生的 .vercel/project.json 讀取 [連接 GitHub Actions 階段](#連接-github-actions) 所需的 orgId 與 projectId。
4. 複製環境範本：`cp .env.example .env`
5. 填寫下方 .env 執行期欄位，使用工作區儲存庫與 main branch，以及 [Vercel 部署準備](#vercel-部署準備) 提供的 callback、`SESSION_SECRET` 和 Upstash Redis REST URL、token。
6. 將欄位匯入 Vercel production：`pnpm env:vercel production`

~~~bash
MYGITNOTES_SOURCE=github
MYGITNOTES_REPOSITORY=owner/workspace-repo
MYGITNOTES_BRANCH=main
APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app
SESSION_SECRET=<output of openssl rand -hex 32>
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
~~~

#### 連接 GitHub Actions

1. 在 Vercel 開啟「**Settings → Git**」並中斷 Git integration，避免同時觸發完整儲存庫部署。
2. 設定 gh 預設 GitHub 儲存庫為含有此 workflow 的儲存庫，將 OWNER/WORKSPACE_REPO 換成其擁有者與名稱：`gh repo set-default OWNER/WORKSPACE_REPO`
3. 將準備好的 `VERCEL_TOKEN` 設為 GitHub Actions secret：`gh secret set VERCEL_TOKEN`（出現提示時貼上 token）
4. 將 ORG_ID 換成[連結步驟](#設定-runtime-values)取得的 orgId，再設為 GitHub Actions variable：`gh variable set VERCEL_ORG_ID --body ORG_ID`
5. 將 PROJECT_ID 換成[連結步驟](#設定-runtime-values)取得的 projectId，再設為 GitHub Actions variable：`gh variable set VERCEL_PROJECT_ID --body PROJECT_ID`

#### 部署與驗證

1. 從 core 執行 production workflow：`gh workflow run deploy-vercel-sparse.yml --ref core`
2. 用 `gh run watch` 等待完成；再以 `vercel ls --prod` 確認部署為 Ready，並開啟網域確認筆記檢視正常。

workflow 從 core 部署產品路徑；main 的筆記異動不會觸發 build，app 會在執行期從 main 讀取工作區內容。workflow 預設從 core 部署；只有改用其他 deploy branch 時才設定 `MYGITNOTES_DEPLOY_BRANCH` repository variable。多個部署共用同一個 Redis database 時才設定 `MYGITNOTES_SESSION_NAMESPACE`，且每個部署使用不同值。

#### 替代方案：透過 Vercel Git integration 部署（停用 Actions 部署）

**帳號與服務**

- 完成[設定 runtime values 階段](#設定-runtime-values)，包括 CLI 登入、連結 Vercel 專案、GitHub OAuth App、Upstash Redis 與執行期欄位。
- 保持 Vercel Git integration 連線，並將 Vercel production branch 設為 core。

**要產生的值**

- 略過[準備階段](#vercel-部署準備)中的 `VERCEL_TOKEN` 設定。

**要安裝的工具**

- 使用預設 Vercel 路徑的 Vercel 與 GitHub CLI。

1. 在 GitHub 設定 workflow 停用變數：`gh variable set MYGITNOTES_VERCEL_DEPLOY --body git-integration`
2. 在 Vercel「**Settings → Git**」確認 production branch 為 core；vercel.json 已允許從 core 部署。
3. 在 Vercel「**Deployments**」確認最新的 core 部署狀態為 Ready，並開啟網域確認筆記檢視正常。

此路徑會由 Vercel 複製完整儲存庫，不需要 `VERCEL_TOKEN`、`VERCEL_ORG_ID` 或 `VERCEL_PROJECT_ID`。

### Docker Compose 連接遠端儲存庫

#### Docker Compose 部署準備

**帳號與服務**

- 安裝 Docker 與 Compose，準備公開網址或 http://localhost:4321。Compose 會在內部網路啟動 Redis，不需要 Redis 帳號。
- 使用 GitHub 登入時建立 GitHub OAuth App，將 Homepage 設為 `APP_URL`，callback 設為 `APP_URL`/api/auth/github/callback。
- 使用 GitLab 登入時，使用 [GitLab 來源設定](#gitlab-來源設定)。

**要產生的值**

- 在[Docker Compose 部署](#docker-compose-連接遠端儲存庫)前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。

**要安裝的工具**

- 安裝 Docker 與 Compose。

1. 複製環境範本：`cp docker.env.example .env.docker`
2. 在 .env.docker 設定 `MYGITNOTES_SOURCE=github`、`MYGITNOTES_REPOSITORY=owner/repo`、`MYGITNOTES_BRANCH=main`、`APP_URL`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 與 `GITHUB_APP_TYPE=oauth-app`。
3. 將準備步驟產生的值填入 `SESSION_SECRET`。
4. 檢查 Compose 展開後的設定：`docker compose -f compose.yaml config --quiet`
5. 建置並啟動 MyGitNotes 與 Redis：`docker compose -f compose.yaml up -d --build`
6. 開啟 `APP_URL` 驗收：筆記檢視成功載入，GitHub 登入會前往環境設定階段指定的 OAuth App。

Compose 預設將 app 發布於 127.0.0.1:4321，並以 redis-data volume 保存 Redis 資料。若要更換瀏覽器使用的連接埠，設定 `MYGITNOTES_PORT`，並將相同網址填入 `APP_URL`。

更新產品 checkout 後，執行 `docker compose up -d --build` 重新建置。`docker compose down` 會保留 Redis volume；`docker compose down -v` 會刪除 volume，使已存 session 與 MCP 授權失效。

### Docker 連接遠端儲存庫

#### Docker 部署準備

**帳號與服務**

- 安裝 Docker，設定 `APP_URL` 為 http://localhost:4321 或公開 HTTPS 網址，並準備保存加密 session 與 MCP 授權的持久 Docker volume。
- 使用 GitHub 登入時，將 OAuth App 的 Homepage 設為 `APP_URL`，callback 設為 `APP_URL`/api/auth/github/callback。
- 使用 GitLab 登入時，使用 [GitLab 來源設定](#gitlab-來源設定)。

**要產生的值**

- 在[Docker 部署](#docker-連接遠端儲存庫)前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。

**要安裝的工具**

- 安裝 Docker。

1. 複製環境範本：`cp docker.env.example .env.docker`
2. 在 .env.docker 設定 `MYGITNOTES_SOURCE=github`、`MYGITNOTES_REPOSITORY=owner/repo`、`MYGITNOTES_BRANCH=main`、`APP_URL`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 與 `GITHUB_APP_TYPE=oauth-app`；只有使用自有 Redis 時才在此設定 `REDIS_URL`。
3. 將準備步驟產生的值填入 `SESSION_SECRET`。
4. 建置 image：`docker build -t mygitnotes:local .`
5. 建立持久 session 儲存空間：`docker volume create mygitnotes-sessions`
6. 啟動容器：
   `docker run -d --name mygitnotes --init --restart unless-stopped -p 127.0.0.1:4321:4321 --env-file .env.docker --mount type=volume,source=mygitnotes-sessions,target=/app/.github-notes-sessions mygitnotes:local`
7. 開啟 `APP_URL` 驗收：筆記檢視成功載入，GitHub 登入會前往環境設定階段指定的 OAuth App。

[建立持久 session 儲存空間的步驟](#docker-連接遠端儲存庫)所建立的 volume，會在更換容器後保留 session、provider 憑證與 MCP 授權。若在環境設定中設定 `REDIS_URL`，Native Redis 優先於 Redis REST。

### 公開連線：使用 reverse proxy

本小節同時適用於 [Docker Compose](#docker-compose-連接遠端儲存庫) 與 [Docker](#docker-連接遠端儲存庫)。將 `APP_URL` 設為 HTTPS 網址，並把 reverse proxy 指向 127.0.0.1:4321。保留 public Host header，轉送 /api/*、/mcp/*、/raw-assets/* 與 /r2-assets/*，並允許 streamed MCP responses。若 proxy 在另一個容器，兩者須共用 app network，並轉送至 mygitnotes:4321。

### 以工作區 checkout 在本機開發

#### 本機開發準備

**帳號與服務**

- MyGitNotes Core 的 GitHub checkout。本機模式不需要 OAuth 帳號。

**要產生的值**

- 無。

**要安裝的工具**

- Node.js 22+、pnpm 9+ 與 Git 2.42+。

1. 複製產品儲存庫：`git clone --branch core --single-branch https://github.com/wayne930242/MyGitNotes.git mygitnotes`
2. 進入 Core checkout：`cd mygitnotes`
3. 安裝相依套件：`pnpm install`
4. 建置 bootstrap 指令所需的產品套件：`pnpm build`
5. 建立本機工作區 checkout，並將 `MYGITNOTES_LOCAL_PATH` 寫入 .env：`pnpm bootstrap-workspace`
6. 啟動 local server 與 web app：`pnpm dev`
7. 開啟 http://localhost:5173；[建立工作區的步驟](#以工作區-checkout-在本機開發)所建立的工作區會出現在筆記檢視。

bootstrap 指令會在相鄰 worktree 建立或 checkout main 分支，再把 worktree 路徑寫入 .env。若要改用既有工作區，請在啟動 local server 前將 .env 的 `MYGITNOTES_LOCAL_PATH` 設為它的絕對路徑。本機模式不需要 GitHub 登入。

要以另一個工作區 checkout 在本機開發，請執行 `REPO_ROOT=/absolute/path/to/workspace pnpm dev`。

### 在容器中開啟本機 checkout

#### 容器內 checkout 準備

**帳號與服務**

- 位於 main、含 .mygitnotes.yaml 與筆記的既有工作區 checkout。Linux 上請讓 UID/GID 1000:1000 可讀寫該 checkout。

**要產生的值**

- 無。

**要安裝的工具**

- Docker 與 Git。

1. 將 `WORKSPACE_PATH` 設為工作區絕對路徑：`export WORKSPACE_PATH=/absolute/path/to/workspace`
2. 設定工作區 commit 作者：`git -C "$WORKSPACE_PATH" config user.name "Your Name"`
3. 設定工作區 commit email：`git -C "$WORKSPACE_PATH" config user.email you@example.com`
4. 檢查 bind mount 與 Compose 設定：`docker compose -f compose.local.yaml config --quiet`
5. 建置並啟動容器：`docker compose -f compose.local.yaml up -d --build`
6. 開啟 http://localhost:4321 驗收：掛載的工作區會出現在筆記檢視。

此模式是限於 loopback host 的匿名桌面流程。編輯內容與 Screen／Study YAML 會保存在掛載的 checkout。若要 commit 與同步，請在該 checkout 設定遠端 Git 憑證。

### GitLab 來源設定

本小節可套用在 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設)、[Docker Compose](#docker-compose-連接遠端儲存庫) 或 [Docker](#docker-連接遠端儲存庫) 之上。

#### GitLab 來源準備

**帳號與服務**

- 在所選 GitLab 站台建立 OAuth application，使用 api scope，callback 為 `APP_URL`/api/auth/gitlab/callback。
- 自架 GitLab 請填 HTTPS 站台網址，若安裝於子路徑也要包含該路徑；部署環境需能連線並信任該站台。
- 保留所選基礎路徑的 `APP_URL`、`SESSION_SECRET` 與 session 儲存設定。

**要產生的值**

- 除所選基礎路徑的值之外，無其他值。

**要安裝的工具**

- 使用所選基礎路徑的工具。

1. 在 .env.docker（Docker）或 .env（Vercel）設定 `MYGITNOTES_SOURCE=gitlab`、`MYGITNOTES_REPOSITORY=group/subgroup/project`、`MYGITNOTES_BRANCH=main`、`MYGITNOTES_GITLAB_URL=https://gitlab.com`、`GITLAB_CLIENT_ID` 與 `GITLAB_CLIENT_SECRET`。
2. Vercel 請執行 `pnpm env:vercel production` 匯入更新後的 .env 欄位；Docker 使用來源設定階段編輯的 .env.docker。
3. Compose 從建置與啟動步驟接續；Docker 從 image 建置與容器啟動步驟接續；Vercel 執行 `gh workflow run deploy-vercel-sparse.yml --ref core`。
4. 開啟 `APP_URL` 驗收：GitLab 登入會連往準備階段建立的 OAuth application，筆記檢視成功載入。

使用 Actions 部署時，保留 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設) 的 GitHub 部署設定，只替換筆記來源與 OAuth provider 欄位。GitLab 寫入需要 main 的 push 權限；公開儲存庫支援匿名讀取。

## 更新與遷移

在乾淨的 `core` checkout 執行 `pnpm update-core`，將產品分支 fast-forward 並遷移已設定的工作區；接著執行 `pnpm install && pnpm dev`，以更新後的 Core 重新啟動。若要單獨遷移工作區，請在該 checkout 執行 `pnpm migrate-workspace`。若 `schema_version` 不相容，local server 會停止，並在錯誤訊息指出 `pnpm migrate-workspace`；若工作區需要較新的 Core，錯誤訊息會指出 `pnpm update-core`。

若舊工作區的 `main` 仍包含產品檔案，先提交或清除變更，再於 `main` 執行一次 `pnpm convert-workspace`。接著以 `git worktree add --track -b core ../mygitnotes-core origin/core` 建立獨立 Core worktree，在其 .env 將 `MYGITNOTES_LOCAL_PATH` 設為轉換後的 checkout，並從 Core worktree 啟動。`pnpm update-core` 僅能在 `core` 執行。

## 選用：私有 R2 素材

將大型檔案存放在 Cloudflare 私有 R2 bucket，並在筆記中以 `r2:<object-key>` 引用。於部署環境設定 `MYGITNOTES_R2_ACCOUNT_ID`、`MYGITNOTES_R2_ACCESS_KEY_ID`、`MYGITNOTES_R2_SECRET_ACCESS_KEY` 與 `MYGITNOTES_R2_BUCKET`。瀏覽器上傳還需要 bucket CORS 允許來自 `APP_URL` 的 PUT、GET 與 HEAD。唯讀 token 可預覽素材；檔案頁管理功能需要 Object Read & Write。參考 [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) 與 [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/)。

## 功能

- 筆記採用一般 Markdown 與選用的 YAML frontmatter；Git 保存歷程並記錄明確提交的變更。
- 以清單、卡片或看板瀏覽筆記；可全文搜尋、管理資料夾與檔案，並探索知識圖譜。
- Screen 河道整理筆記本內容；Markdown 分頁也能轉成單字卡複習。
- 提供 **九組主題配色**，各有淺色與深色版本；預設為 **Flexoki**，選擇會保存在瀏覽器。
- Agent 可透過本機 stdio 或遠端 Streamable HTTP MCP 連線，並使用具名唯讀或寫入授權。

## 文件

- [Agent 與開發者文件](docs/agent/index.md)
- [架構說明](docs/agent/architecture/index.md)
- [MCP 介面與安全模型](docs/agent/mcp/index.md)
- [示範工作區](examples/demo-workspace/README.md)
- [學習與單字卡指南](docs/agent/study.md)

## 授權條款

MIT
