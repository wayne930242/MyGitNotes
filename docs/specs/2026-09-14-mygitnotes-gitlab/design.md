# 設計

以既有來源類別為邊界，抽取 RemoteSource，集中筆記、資料夾、資源、Screen、Study 與 MCP 寫入規則。GitHubSource 與 GitLabSource 各自負責快照、blob 與原子提交；HTTP 與 MCP 透過來源工廠建立 adapter。

直接複製 GitHubSource 會重複路徑與原子寫入規則；將 GitLab 偽裝成 GitHub API 會把不同提交語意藏在傳輸層。因此共享領域行為，平台實作只處理讀取與提交。

GitLab tree 逐頁完整讀取，檔案固定到快照中的 blob。寫入先驗證分支版本與權限，使用快照檔案的 last_commit_id 提交所有 actions。GitHub 沿用 tree / commit / non-force ref update 與現有 cache。

OAuth 由部署來源決定端點。GitLab refresh token 存於加密 credential record，瀏覽器與 MCP 共用 credential；Redis lock 序列化跨實例更新，本機使用程序內序列化。GitLab 的 owner 與 credential key 包含站台與 client ID。GitHub 的既有 key 及 cookie 保留。

驗證：來源 contract、OAuth state/PKCE/refresh、憑證隔離、MCP 唯讀與撤銷、GitHub regression，以及前端實際頁面。

參考：[GitLab OAuth](https://docs.gitlab.com/api/oauth2/)、[批次提交](https://docs.gitlab.com/api/commits/)、[檔案版本](https://docs.gitlab.com/api/repository_files/)、[分支權限](https://docs.gitlab.com/api/branches/)。

## Redis 資料前綴

SessionStore 建立時固定資料前綴，涵蓋 encrypted records、grant indexes 與 distributed refresh locks。預設 `gh-notes` 保持相容；測試部署使用 `gh-notes:mygitnotes-gitlab-test`。同一 Redis 上使用不同加密金鑰時，前綴避免一個部署將另一部署的紀錄誤判為損壞並清除。前綴於首次登入前設定，既有登入資料不會自動搬移。

## 架構圖

依使用者回饋，以 imagegen 編輯原有中英文 PNG，保留插畫、構圖、配色與箭頭，只更新 MyGitNotes 品牌和 GitHub／GitLab 平台選項。README 使用編輯後的 PNG；原始 PNG 保留作為編輯來源。[實際提示詞](architecture-image-prompts.md)。

## 登入入口的載入狀態

AuthControls 與 MCP 授權設定皆等待 session 回傳 provider 後，再顯示對應平台的登入連結。實站複查發現 MCP 設定將初始空 session 視為未登入 GitHub；沿用標頭已有的 provider 判斷，修正短暫錯誤入口。初始元件渲染可重現修正前的連結，修正後該檢查通過。

## 直接更新 repo 與環境設定

以使用者提供的新 repo URL 更新 Git remotes 與產品連結。來源設定集中於 loadSourceConfig，保留新舊環境變數的優先序。Vercel 匯入工具讀取舊值時以新鍵名寫入，QA 與 --local 也寫入新名稱。既有雲端環境先建立新鍵、確認後移除舊鍵，再隨發布套用。GitHub 來源更新為新 repo 路徑，既有 MCP source identity 若包含舊路徑則需重新建立授權。
