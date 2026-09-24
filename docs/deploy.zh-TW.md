# 部署 MyGitNotes

[English](deploy.md) · [繁體中文](deploy.zh-TW.md)

先依 [快速開始](../README.zh-TW.md#快速開始) 在本機跑起來，再選擇符合 hosting 設定的部署方式。

## 透過 GitHub Actions sparse checkout 部署至 Vercel（預設）

### Vercel 部署準備

**帳號與服務**

- Vercel 專案、含 core 與 main 分支的 GitHub 儲存庫，以及 Upstash Redis database。
- 使用 GitHub 登入時，準備 GitHub OAuth App，並將 OAuth callback 設為 `https://<your-project>.vercel.app/api/auth/github/callback`。
- 使用 GitLab 登入時，準備 [GitLab 來源設定](#gitlab-來源設定) 所述的 GitLab OAuth App。

**要產生的值**

- 在第一個階段前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。
- 在第一個階段前於 Vercel Account Settings → Tokens 建立 `VERCEL_TOKEN`，Scope 設為擁有此專案的 team，並留存 token。

**要安裝的工具**

- 安裝 Vercel 與 GitHub CLI。

### 設定 runtime values

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

### 連接 GitHub Actions

1. 在 Vercel 開啟「**Settings → Git**」並中斷 Git integration，避免同時觸發完整儲存庫部署。
2. 設定 gh 預設 GitHub 儲存庫為含有此 workflow 的儲存庫，將 OWNER/WORKSPACE_REPO 換成其擁有者與名稱：`gh repo set-default OWNER/WORKSPACE_REPO`
3. 將準備好的 `VERCEL_TOKEN` 設為 GitHub Actions secret：`gh secret set VERCEL_TOKEN`（出現提示時貼上 token）
4. 將 ORG_ID 換成[連結步驟](#設定-runtime-values)取得的 orgId，再設為 GitHub Actions variable：`gh variable set VERCEL_ORG_ID --body ORG_ID`
5. 將 PROJECT_ID 換成[連結步驟](#設定-runtime-values)取得的 projectId，再設為 GitHub Actions variable：`gh variable set VERCEL_PROJECT_ID --body PROJECT_ID`

### 部署與驗證

1. 從 core 執行 production workflow：`gh workflow run deploy-vercel-sparse.yml --ref core`
2. 用 `gh run watch` 等待完成；再以 `vercel ls --prod` 確認部署為 Ready，並開啟網域確認筆記檢視正常。

workflow 從 core 部署產品路徑；main 的筆記異動不會觸發 build，app 會在執行期從 main 讀取工作區內容。workflow 預設從 core 部署；只有改用其他 deploy branch 時才設定 `MYGITNOTES_DEPLOY_BRANCH` repository variable。多個部署共用同一個 Redis database 時才設定 `MYGITNOTES_SESSION_NAMESPACE`，且每個部署使用不同值。

### 替代方案：透過 Vercel Git integration 部署（停用 Actions 部署）

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

## Docker Compose 連接遠端儲存庫

### Docker Compose 部署準備

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

## Docker 連接遠端儲存庫

### Docker 部署準備

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

## 公開連線：使用 reverse proxy

本小節同時適用於 [Docker Compose](#docker-compose-連接遠端儲存庫) 與 [Docker](#docker-連接遠端儲存庫)。將 `APP_URL` 設為 HTTPS 網址，並把 reverse proxy 指向 127.0.0.1:4321。保留 public Host header，轉送 /api/*、/mcp/*、/raw-assets/* 與 /r2-assets/*，並允許 streamed MCP responses。若 proxy 在另一個容器，兩者須共用 app network，並轉送至 mygitnotes:4321。

## 在容器中開啟本機 checkout

### 容器內 checkout 準備

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

## GitLab 來源設定

本小節可套用在 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設)、[Docker Compose](#docker-compose-連接遠端儲存庫) 或 [Docker](#docker-連接遠端儲存庫) 之上。

### GitLab 來源準備

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

## Core 更新

「設定」頁會分別檢查儲存庫的 Core 版本與正在執行的 build。本機更新需要位於 `core` 的乾淨產品 checkout；工作區分支不影響此操作。更新後以新版 Core 執行 `pnpm migrate-workspace`，再重新啟動 server。

GitHub 工作區在「設定」頁提示缺少 workflow 時，先按 **Install Core sync**，再按 **Update Core**。bootstrap 也會把 [canonical workflow](../packages/core/assets/mygitnotes-core-sync.yml) 安裝到 `main` 的 `.github/workflows/mygitnotes-core-sync.yml`；預設分支不是 `main` 的儲存庫，可透過「設定」頁安裝到該分支。workflow 會抓取 MyGitNotes upstream，並 push `core` 的 fast-forward。「設定」頁會追蹤對應的 run，確認更新後的 revision 才回報成功。既有 workflow 檔案會保留。

GitHub OAuth 需要 `repo workflow` scope；較舊的授權會顯示 **Re-authorize GitHub**。app 會加密使用者的授權，存成儲存庫 Actions secret `MYGITNOTES_CORE_SYNC_TOKEN`，供 runner push 使用。能修改該儲存庫 workflow 的人，都能透過 workflow 使用這份憑證。以使用者 token push 會觸發已設定的部署事件；部署完成與 Core sync 完成是兩件事。

GitHub App 安裝需在 App 設定開啟 **Contents**、**Workflows**、**Actions** 與 **Secrets** 的寫入權限；App 登入不會要求 OAuth scope。GitLab 目前不支援 Core 更新，GitLab 登入維持既有的 `api` scope。

## 更新與遷移

在乾淨的 `core` checkout 執行 `pnpm update-core`，將產品分支從 `upstream/core`（沒有 `upstream` remote 時改用 `origin/core`）fast-forward，並遷移已設定的工作區；接著執行 `pnpm install && pnpm dev`，以更新後的 Core 重新啟動。若要單獨遷移工作區，請在該 checkout 執行 `pnpm migrate-workspace`。若 `schema_version` 不相容，local server 會停止，並在錯誤訊息指出 `pnpm migrate-workspace`；若工作區需要較新的 Core，錯誤訊息會指出 `pnpm update-core`。

若舊工作區的 `main` 仍包含產品檔案，先提交或清除變更，再於 `main` 執行一次 `pnpm convert-workspace`。接著以 `git worktree add --track -b core ../mygitnotes-core origin/core` 建立獨立 Core worktree，在其 .env 將 `MYGITNOTES_LOCAL_PATH` 設為轉換後的 checkout，並從 Core worktree 啟動。`pnpm update-core` 僅能在 `core` 執行。

## 選用：私有 R2 素材

將大型檔案存放在 Cloudflare 私有 R2 bucket，並在筆記中以 `r2:<object-key>` 引用。於部署環境設定 `MYGITNOTES_R2_ACCOUNT_ID`、`MYGITNOTES_R2_ACCESS_KEY_ID`、`MYGITNOTES_R2_SECRET_ACCESS_KEY` 與 `MYGITNOTES_R2_BUCKET`。瀏覽器上傳還需要 bucket CORS 允許來自 `APP_URL` 的 PUT、GET 與 HEAD。唯讀 token 可預覽素材；檔案頁管理功能需要 Object Read & Write。參考 [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) 與 [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/)。
