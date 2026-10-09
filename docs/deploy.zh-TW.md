# 部署 MyGitNotes

[English](deploy.md) · [繁體中文](deploy.zh-TW.md)

先依 [快速開始](../README.zh-TW.md#快速開始) 在本機跑起來，再選擇符合 hosting 設定的部署方式。

## 透過 GitHub Actions sparse checkout 部署至 Vercel（預設）

### Vercel 部署準備

**帳號與服務**

- Vercel 專案、含 core 與 main 分支的 GitHub 儲存庫，以及 Upstash Redis database。
- 使用 GitHub 登入時，準備 GitHub OAuth App，並將 OAuth callback 設為 `https://<your-project>.vercel.app/api/auth/github/callback`。
- 使用 GitLab 登入時，準備 [GitLab 來源設定](#gitlab-來源設定) 所述的 GitLab OAuth App。使用 GitHub Enterprise 時，依 [GitHub Enterprise 來源設定](#github-enterprise-來源設定) 在該站台註冊 App。

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

## 輕量 Vercel 部署（不用 Redis，訪客自選儲存庫）

這條路徑不需要 Redis，也不需要固定的筆記儲存庫。
每位訪客透過 GitHub 登入後，從自己的儲存庫中選一個來使用。
登入狀態（包括 GitHub token）和選定的儲存庫都以 `SESSION_SECRET` 加密，存在 HttpOnly cookie，伺服器不保存任何資料。
沒有 MyGitNotes manifest 的儲存庫會以頂層資料夾作為筆記本開啟，並提示可以 commit 一份 manifest。

伺服器不保存資料，代價如下：沒有 MCP 連線授權、不支援 GitLab 登入、沒有 Core 更新面板；GitHub App 的 refresh token 到期（六個月）或更新失敗後，需要重新登入。

### 輕量部署準備

**帳號與服務**

- 依 [Vercel 部署準備](#vercel-部署準備) 建立 Vercel 專案，不需要 Upstash Redis。
- 建立 GitHub App（**Settings → Developer settings → GitHub Apps → New GitHub App**）：
  - Homepage URL 設為 `APP_URL`，Callback URL 設為 `APP_URL`/api/auth/github/callback。
  - 保持開啟 **Expire user authorization tokens**，並開啟 **Request user authorization (OAuth) during installation**。
  - 關閉 **Webhook**。
  - Repository permissions：**Contents** 設為 Read and write，**Metadata** 設為 Read-only。
  - 安裝範圍選 **Any account**，讓訪客能安裝到自己的儲存庫。
  - 產生 client secret，記下 client ID 與 App 的網址名稱（`https://github.com/apps/<slug>` 中的 slug）。

**要產生的值**

- 以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。
  更換這個值會讓所有訪客登出，也會清掉他們選過的儲存庫。

### 輕量部署的 runtime values

在 .env 填入下列欄位，再以 `pnpm env:vercel production` 匯入；`MYGITNOTES_REPOSITORY`、`MYGITNOTES_BRANCH` 與所有 Redis 變數都不要設定。

```dotenv
APP_URL=https://<your-project>.vercel.app
MYGITNOTES_SOURCE=github
GITHUB_APP_TYPE=github-app
GITHUB_APP_SLUG=<GitHub App 的網址名稱>
GITHUB_CLIENT_ID=<GitHub App 的 client ID>
GITHUB_CLIENT_SECRET=<GitHub App 的 client secret>
SESSION_SECRET=<openssl rand -hex 32 的輸出>
```

依 [連接 GitHub Actions](#連接-github-actions) 與 [部署與驗證](#部署與驗證) 部署後開啟網域：先出現登入畫面，登入後出現儲存庫選擇畫面。

沒有筆記儲存庫的訪客，可在選擇畫面按「建立新的筆記 repository」：會開啟已預填範本的 GitHub 新儲存庫頁面，建立並授權給 App 後，選擇畫面會自動選取它。
範本預設為公開的 [`wayne930242/mygitnotes-starter`](https://github.com/wayne930242/mygitnotes-starter)；設定 `MYGITNOTES_STARTER_TEMPLATE=<owner>/<name>` 可改用你自己的範本儲存庫。

任何部署都能以 `MYGITNOTES_STORAGE=cookie` 改用 cookie session；Vercel 在沒有設定 Redis 時會自動使用。
有設定 `MYGITNOTES_REPOSITORY` 的部署仍固定使用該儲存庫，有沒有 Redis 都一樣。

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

## GitHub Enterprise 來源設定

本節疊加在 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設)、[Docker Compose](#docker-compose-連接遠端儲存庫) 或 [Docker](#docker-連接遠端儲存庫) 之上，讓筆記放在 GitHub Enterprise Server（GHES）或 GitHub Enterprise Cloud 資料落地（GHE.com）的儲存庫，而不是 github.com。

### GitHub Enterprise 來源準備

**帳號與服務**

- 在同一個 Enterprise 站台註冊 GitHub OAuth App 或 GitHub App，callback 為 `APP_URL`/api/auth/github/callback。不支援個人存取權杖（PAT）登入。
- 確認部署環境能以 HTTPS 連線並信任該站台，API 也要連得到：GHES 為 `https://<站台>/api/v3`，GHE.com 為 `https://api.<主機>`。
- `APP_URL`、`SESSION_SECRET` 與 session 儲存沿用所選基礎路徑。

**需要產生的值**

- 除了所選基礎路徑已有的值，不需要其他值。

**需要安裝的工具**

- 沿用所選基礎路徑的工具。

1. 在 .env.docker（Docker）或 .env（Vercel）設定 `MYGITNOTES_SOURCE=github`、`MYGITNOTES_REPOSITORY=team/notes`、`MYGITNOTES_BRANCH=main`、`MYGITNOTES_GITHUB_URL=https://ghe.example.com`（GHE.com 為 `https://octocorp.ghe.com`，安裝在子路徑也可以），以及該站台上註冊之 App 的 `GITHUB_CLIENT_ID` 與 `GITHUB_CLIENT_SECRET`。`GITHUB_NOTES_GITHUB_URL` 同樣會被讀取。只有 `MYGITNOTES_SOURCE=github` 時才讀這個設定；留空或填 `https://github.com`，行為與 github.com 部署完全相同。
2. Vercel 以 `pnpm env:vercel production` 匯入更新後的 .env 欄位；Docker 使用來源設定步驟的 .env.docker。
3. Compose 接續建置與啟動步驟；單純 Docker 接續映像建置與容器啟動步驟；Vercel 執行 `gh workflow run deploy-vercel-sparse.yml --ref core`。
4. 開啟 `APP_URL`：登入會前往 Enterprise 站台，筆記檢視成功載入。

下列項目都跟著這個站台：儲存庫讀寫、登入、`MYGITNOTES_REPOSITORY` 留空時的儲存庫選擇器、GitHub App 安裝連結（`<站台>/github-apps/<slug>/installations/new`），以及 Gist 發佈（筆記的「開啟 Gist」連結會向站台的 Gist API 查詢網址，再開到那裡）。工作區的每個儲存庫都在部署的站台上；位於其他站台的儲存庫會標成無法使用，因為這個站台的登入碰不到它。

舊版會忽略 `github` 來源上的 `url`。現在 manifest 或 server YAML 裡帶了 `url`，就代表那個站台；github.com 的來源若殘留 `url`（例如填了儲存庫的網頁網址），請刪掉，也不要留空值。

與 github.com 的差異：

- **從範本建立**：github.com 提供入門範本。Enterprise 站台只有在 `MYGITNOTES_STARTER_TEMPLATE` 指定該站台上的範本時才顯示建立連結；否則請使用者選擇既有儲存庫。
- **Core 更新**仍然追蹤 github.com，產品儲存庫在 Enterprise 站台時不提供，站台的權杖也就不會送到 github.com。
- **封存檔下載**只接受導向該站台自己的 codeload（`https://codeload.<主機>/…`，未啟用子網域隔離時為 `https://<主機>/codeload/…`），必須是 HTTPS，連接埠與站台網址相同（預設連接埠則不帶）。
- Pro 服務仍然只支援 github.com。

## Core 更新

「設定」頁會分別檢查儲存庫的 Core 版本與正在執行的 build。本機更新需要位於 `core` 的乾淨產品 checkout；工作區分支不影響此操作。更新後以新版 Core 執行 `pnpm migrate-workspace`，再重新啟動 server。

線上部署只為它的產品儲存庫提供 Core 更新，也就是它部署的 `core` 分支所在的儲存庫。用 `MYGITNOTES_PRODUCT_REPOSITORY`（`owner/name`）或 `mygitnotes.server.yaml` 的 `product_repository: owner/name` 指定；它在部署的 GitHub 站台上（`MYGITNOTES_GITHUB_URL`，未設定時是 github.com）。fork-model 部署的筆記儲存庫同時帶著 `core`，就指定同一個儲存庫。沒有指定時，「設定」頁不顯示 Core 更新，更新路由直接回 404，不會向 provider 發出請求。

GitHub 工作區在「設定」頁提示缺少 workflow 時，先按 **Install Core sync**，再按 **Update Core**。bootstrap 也會把 [canonical workflow](../packages/core/assets/mygitnotes-core-sync.yml) 安裝到 `main` 的 `.github/workflows/mygitnotes-core-sync.yml`；預設分支不是 `main` 的儲存庫，可透過「設定」頁安裝到該分支。workflow 會抓取 MyGitNotes upstream，並 push `core` 的 fast-forward。「設定」頁會追蹤對應的 run，確認更新後的 revision 才回報成功。既有 workflow 檔案會保留。

GitHub OAuth 需要 `repo workflow gist` scope；`gist` 讓筆記的「資訊」分頁能把本文發佈成 secret Gist。較舊的授權會顯示 **Re-authorize GitHub**，用這類授權發佈時會要求重新登入。app 會加密使用者的授權，存成儲存庫 Actions secret `MYGITNOTES_CORE_SYNC_TOKEN`，供 runner push 使用。能修改該儲存庫 workflow 的人，都能透過 workflow 使用這份憑證。以使用者 token push 會觸發已設定的部署事件；部署完成與 Core sync 完成是兩件事。

GitHub App 安裝需在 App 設定開啟 **Contents**、**Workflows**、**Actions** 與 **Secrets** 的寫入權限；App 登入不會要求 OAuth scope。GitLab 目前不支援 Core 更新，GitLab 登入維持既有的 `api` scope。

## 更新與遷移

在乾淨的 `core` checkout 執行 `pnpm update-core`，將產品分支從 `upstream/core`（沒有 `upstream` remote 時改用 `origin/core`）fast-forward，並遷移已設定的工作區；接著執行 `pnpm install && pnpm dev`，以更新後的 Core 重新啟動。若要單獨遷移工作區，請在該 checkout 執行 `pnpm migrate-workspace`。若 `schema_version` 不相容，local server 會停止，並在錯誤訊息指出 `pnpm migrate-workspace`；若工作區需要較新的 Core，錯誤訊息會指出 `pnpm update-core`。

若舊工作區的 `main` 仍包含產品檔案，先提交或清除變更，再於 `main` 執行一次 `pnpm convert-workspace`。接著以 `git worktree add --track -b core ../mygitnotes-core origin/core` 建立獨立 Core worktree，在其 .env 將 `MYGITNOTES_LOCAL_PATH` 設為轉換後的 checkout，並從 Core worktree 啟動。`pnpm update-core` 僅能在 `core` 執行。

## 筆記本放在其他儲存庫

工作區可以提供多個儲存庫的筆記本。每個儲存庫自己的 `.mygitnotes.yaml`（`schema_version: 4`）宣告它保存的筆記本，`root` 和 `assets` 相對於那個儲存庫，並設定儲存庫的標題、開啟時進入的筆記本與偏好設定。部署指定的儲存庫（`MYGITNOTES_REPOSITORY`、`MYGITNOTES_LOCAL_PATH` 或最上層的 `source:`）是預設儲存庫，工作區從這裡開啟。本機部署在 `mygitnotes.server.yaml` 把其他儲存庫對應到 worktree，`path` 相對於這個設定檔：

```yaml
repositories:
  - type: github
    repository: owner/trpg-notes
    path: ../trpg-notes
```

連不上的儲存庫、或 manifest 無法載入的儲存庫，會標成無法使用並顯示原因，其他儲存庫照常運作；「設定」頁會開啟有問題的 manifest 讓人修正。每個儲存庫各自保存 Screen、Focus、Study 設定檔和 Agent 檔案；跨儲存庫的提交會在每個儲存庫各產生一個 commit。

### 轉換 `source` 筆記本

schema 3 允許主 manifest 用 `source` 宣告其他儲存庫的筆記本。schema 4 移除了 `source`；仍使用它的 manifest 會讓所在儲存庫標成無法使用，原因是 `Notebook <id> uses source, which schema 4 removed. Run pnpm convert-sources in <repository>.`。請在 Core checkout 執行一次轉換，它的 `mygitnotes.server.yaml` 要把每個被指定的儲存庫對應到 worktree：

```sh
pnpm convert-sources            # 顯示計畫；在終端機中寫入前會先詢問
pnpm convert-sources --yes      # 不詢問，直接套用
pnpm convert-sources --workspace ../hub --yes   # 轉換另一個已對應 worktree 的 manifest
```

每個帶 `source` 的筆記本，會原樣（只拿掉 `source`）加進它指定的儲存庫的 manifest。那個儲存庫沒有 manifest 時會新建一份：標題是儲存庫名稱，開啟時進入第一個移入的筆記本，偏好設定複製自轉換中的 manifest，寫入前會完整顯示；已有的 manifest 則保留原本的標題、預設筆記本與偏好設定。接著把筆記本從轉換中的 manifest 移除，兩邊都改成 `schema_version: 4`。以下情況會在寫入任何檔案前拒絕：被指定的儲存庫沒有對應的 worktree、目標已有同 id 但內容不同的筆記本或 root 重疊的筆記本、要改的 manifest 有未提交的變更。轉換中的 manifest 開啟時進入的筆記本被移走時，計畫會列出原本與新的 `default_notebook`（剩下的第一個筆記本）。轉換中的儲存庫的 Focus 與 Study 檔若有被移走筆記本的項目，會列出來並留在原處。

每個儲存庫的變更各是一個 commit。commit 失敗時指令會停下，並印出提交已寫入檔案的指令；提交後再執行一次 `pnpm convert-sources`，已經以相同內容存在於目標儲存庫的筆記本會略過。所有筆記本都會離開轉換中的 manifest 時，指令會停下，除非加上 `--remove-emptied`：它在該儲存庫的 commit 裡刪除那份 manifest，並把該儲存庫從 `mygitnotes.server.yaml` 的 `repositories` 移除；部署本身的來源不能這樣移除，要先換成其他儲存庫。沒有 `source` 的 manifest 用 `pnpm migrate-workspace` 升到 schema 4。低於 schema 3 的 manifest 可能還有只有 schema 3 Core 才會轉換的 Screen 檔：`convert-sources` 會拒絕它，請先在 `fd0fd42` 的 Core checkout 執行 `pnpm migrate-workspace`。

## 選用：私有 R2 素材

將大型檔案存放在 Cloudflare 私有 R2 bucket，並在筆記中以 `r2:<object-key>` 引用。於部署環境設定 `MYGITNOTES_R2_ACCOUNT_ID`、`MYGITNOTES_R2_ACCESS_KEY_ID`、`MYGITNOTES_R2_SECRET_ACCESS_KEY` 與 `MYGITNOTES_R2_BUCKET`。瀏覽器上傳還需要 bucket CORS 允許來自 `APP_URL` 的 PUT、GET 與 HEAD。唯讀 token 可預覽素材；檔案頁管理功能需要 Object Read & Write。參考 [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) 與 [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/)。
