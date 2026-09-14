# 設計

以既有來源類別為邊界，抽取 RemoteSource，集中筆記、資料夾、資源、Screen、Study 與 MCP 寫入規則。GitHubSource 與 GitLabSource 各自負責快照、blob 與原子提交；HTTP 與 MCP 透過來源工廠建立 adapter。

直接複製 GitHubSource 會重複路徑與原子寫入規則；將 GitLab 偽裝成 GitHub API 會把不同提交語意藏在傳輸層。因此共享領域行為，平台實作只處理讀取與提交。

GitLab tree 逐頁完整讀取，檔案固定到快照中的 blob。寫入先驗證分支版本與權限，使用快照檔案的 last_commit_id 提交所有 actions。GitHub 沿用 tree / commit / non-force ref update 與現有 cache。

OAuth 由部署來源決定端點。GitLab refresh token 存於加密 credential record，瀏覽器與 MCP 共用 credential；Redis lock 序列化跨實例更新，本機使用程序內序列化。GitLab 的 owner 與 credential key 包含站台與 client ID。GitHub 的既有 key 及 cookie 保留。

驗證：來源 contract、OAuth state/PKCE/refresh、憑證隔離、MCP 唯讀與撤銷、GitHub regression，以及前端實際頁面。

參考：[GitLab OAuth](https://docs.gitlab.com/api/oauth2/)、[批次提交](https://docs.gitlab.com/api/commits/)、[檔案版本](https://docs.gitlab.com/api/repository_files/)、[分支權限](https://docs.gitlab.com/api/branches/)。
