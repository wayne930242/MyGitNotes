# 行為與驗證契約

使用者已於 2026-09-13 的設計檢查後授權修正。以下為該授權的實作化規格，無額外操作流程變更。

- 共用快取依 GitHub 憑證摘要與 repository 隔離。已登入請求每次重新確認 repository 存取權；不可用快取掩蓋 401/403/404。
- 一般分支資訊最多快取 60 秒；寫入與提交前檢查跳過這個新鮮度視窗。每個 reader 仍固定在單一 commit。
- 不變的 tree/blob 可重用。支援 ETag/304，並合併同時發出的相同請求。
- 一批超過六個未快取文字檔時，以固定 commit 的 tarball 批次讀取。限制重新導向、下載與解壓大小，檔案必須通過 Git blob SHA 驗證。封存檔缺檔或內容因 export-subst 改變時回退讀取原始 blob。
- 正確區分權限不足與限流。限流遵守 Retry-After 與 x-ratelimit-reset；不自動重試寫入。HTTP 保留 status 與 Retry-After，編輯器暫停背景請求。
- 請求按憑證序列執行，寫入間隔至少一秒。文字檔以 tree.content 提交；二進位附件仍使用 blob API。
- 切換筆記本重用已載入的清單。編輯器一般每分鐘檢查，唯讀每五分鐘檢查；隱藏分頁不輪詢，focus 事件不繞過等待時間。
- 提交前以一次批次請求讀取所有既有筆記，確認與工作區最新 revision 一致。刪除的筆記保留草稿並標示衝突。

正確性由 mocked GitHub、真實本機 HTTP 與 Chromium fixture 驗證，再執行 pnpm test、pnpm build、git diff --check。無需額外的人為適切性核准。

依據：[專案界線](../../../AGENTS.md)、[原來源設計](../2026-09-12-configurable-note-sources/design.md)、[GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)、[Git trees](https://docs.github.com/en/rest/git/trees)、[repository archives](https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-tar)。
