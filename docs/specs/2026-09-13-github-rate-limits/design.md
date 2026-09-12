# 實作設計

GitHubSource 保持 repository/branch/token/fetch 建構方式；GitHubApi 封裝快取、條件式請求、合併、憑證佇列與限流冷卻。相同 fetch 實例代表同一執行環境；快取 key 只含憑證 SHA-256 摘要，不含 token 原文。

選擇在來源層處理，而非只在 React 快取，讓 HTTP 與 MCP 同時受益。原先 request-scoped reader 繼續負責一致的 commit；可重用的資料下移到來源層內的 transport。沒有引入泛用虛擬檔案系統。

快取上限 64 MiB / 5,000 筆；單筆最多 32 MiB；不可變內容最長一小時。程序內依憑證序列化，佇列最多 128 個請求。已登入 repository 資料即使快取仍以 ETag 重新驗證；匿名 repository 資料最多延遲 60 秒。寫入前強制重新驗證 branch 與 permissions；更新 ref 後失效可變快取。舊的未完成讀取不得重新填入已失效的可變快取。

首次大量讀取使用 GitHub tarball API，僅允許 HTTPS codeload.github.com 重新導向，不轉送 Authorization。tar-stream 串流解析，不寫入檔案系統；壓縮資料 32 MiB、解壓 128 MiB、保留內容 24 MiB、單檔 5 MiB。比對 GitHub tree 的 Git blob SHA，避免 export-subst/LFS/symlink 改變筆記內容。404 或大小超限回退逐檔，仍受共用冷卻限制；超大儲存庫不能保證首次載入低於匿名額度。

文字提交將 content 直接放入 Git tree entries。二進位附件先建立 blob；刪除與搬移沿用 sha/null。所有分支更新保持 force:false，沒有自動重放可能已成功的寫入。

新增 POST /api/notes/read-batch 接受 paths（1–200）與 revision，以同一新鮮 snapshot 讀取。前端一次取得 latestByPath 後沿用既有草稿合併、衝突與提交處理。

瀏覽器驗證由 scripts/qa-github-rate-limit.mjs 啟動自有 HTTP fixture 與 Chromium，不連線 GitHub。回歸測試在來源公開方法、HTTP 回應與 browser fetch 邊界計算實際請求。

部署限制：快取、合併與冷卻狀態是程序內狀態。Vercel 冷啟動與多實例不能共享它們；GitHub 帳號於其他應用的用量也不可由本服務掌控。因此減少已確認的浪費並遵守限流回應，不宣稱任意負載皆不會限流。未引入新的 Redis 資料或部署設定。
