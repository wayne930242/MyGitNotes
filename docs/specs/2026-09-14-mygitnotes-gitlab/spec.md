Status: approved
Approved at: 2026-09-14
Approved from: 本對話逐項確認完整功能、兩種 GitLab 站台、單一來源部署、更名，以及 MyGitNotes 提案後回覆「好」。

# 可觀察契約

1. 每個部署選擇 local、github 或 gitlab；GitLab 使用 HTTPS 站台與可含子群組的專案路徑。舊 GITHUB_NOTES 設定繼續有效，MYGITNOTES 設定為新名稱。
2. 遠端 UI 顯示選定平台的登入入口；GitLab OAuth 使用 state 與 PKCE，伺服器保存及更新憑證。帳號、站台與平台構成授權身分。
3. GitLab 讀取固定提交的筆記、資料夾、資源及工作區配置；main 的寫入需平台授權，批次修改產生一個提交，保留未知 frontmatter。
4. 過期版本與同檔案並行修改回報衝突；保留草稿。GitLab 以批次 actions 與 last_commit_id 保護修改中的檔案；同時發生的其他檔案提交保留在歷史。
5. GitLab MCP grants 支援唯讀、寫入、列表與撤銷；瀏覽器登出後既有 grants 繼續有效。跨平台或站台憑證隔離，GitHub 既有 grants 相容。
6. UI、雙語 README 與架構圖使用 MyGitNotes，圖面呈現本機及兩種遠端平台。
7. 本機與 GitHub 行為通過既有測試；Core 更新保留 trpg-notes 的筆記與工作區設定。

Reality anchor：公開來源介面與 HTTP/MCP 路由的整合測試，完整 pnpm test / pnpm build，瀏覽器品牌與登入入口檢查。真實 GitLab OAuth／寫入以可用測試站台另行驗證；沒有實際執行的項目記 unknown。

標準：[產品指引](../../agent/product/index.md)、[安全邊界](../../agent/security/index.md)。正式 repo 為 `wayne930242/MyGitNotes`；使用者資料檔名與部署服務沿用。

## 共用 Redis 部署

新部署可設定 `MYGITNOTES_SESSION_NAMESPACE`，將登入狀態、共享憑證、MCP 授權索引與 refresh lock 存於獨立前綴。未設定的既有部署持續讀取原有鍵值。支援 Vercel 原生 Upstash 整合的 `KV_REST_API_URL` 與 `KV_REST_API_TOKEN`；明確設定的 `UPSTASH_REDIS_REST_*` 優先。資料前綴隔離應用程式的讀寫範圍，Redis 存取憑證仍具有整個資料庫的權限。

## Repo 與環境變數更名契約

產品 origin 與 trpg-notes upstream 使用 MyGitNotes 新 URL。Vercel 與設定範例使用 MYGITNOTES_*；程式仍讀取 GITHUB_NOTES_* fallback，新值優先。--local 明確選擇本機來源。來源 repo 路徑直接更新；綁定舊路徑的 MCP 授權由使用者重新授權。既有部署網址與筆記內容保留。
