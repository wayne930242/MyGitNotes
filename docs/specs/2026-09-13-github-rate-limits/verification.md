# 驗證結果

## 用量與安全性

`packages/core/tests/github-rate-limit.test.ts` 使用固定內容的模擬 GitHub 回應，無實際 GitHub 額度消耗：

| 場景 | 修正前 | 修正後 |
| --- | --- | --- |
| 首次讀取 100 篇筆記 | 104 次 REST | 5 次 REST + 1 次封存檔下載 |
| 已載入清單後提交 100 篇既有文字筆記，含 workspace 與逐篇／批次檢查 | 611 次 REST | 9 次 REST |
| 上述提交內的寫入 | 103 次 | 3 次 |

前兩輪紅燈分別重現 104 次逐篇讀取、平行六個 reader 發出 30 次請求、缺少條件式驗證、缺少 cooldown、103 次文字寫入，以及缺少批次檢查介面。修正後通過。

測試涵蓋：同時請求合併、憑證隔離、每次已登入 repository 權限重驗、ETag、primary reset、secondary Retry-After、跨 repository 的同憑證 cooldown、舊 revision 拒絕、已刪除草稿與路徑保護、codeload 不含 Authorization、外部重新導向拒絕。archive 測試涵蓋原始 CRLF、Git blob SHA、export-subst 內容差異、symlink、路徑穿越與損毀壓縮檔。

`apps/local-server/tests/github-rate-limit.test.ts` 透過真實本機 HTTP 驗證 429/Retry-After 保留，兩個 HTTP 請求只接觸上游一次。

## 瀏覽器

`node scripts/qa-github-rate-limit.mjs`：使用 Chromium 與獨立 HTTP fixture，把背景 timer 加速來驗證 cooldown。GitHub 模式切換筆記本後清單請求仍為 1 次；冷卻期間遠端檢查只有 1 次；無 pageerror。

`RATE_QA_LOCAL=1 node scripts/qa-github-rate-limit.mjs`：本機模式切換筆記本維持 2 次清單載入、0 次遠端檢查。本機行為曾被過度廣泛的清單重用影響；紅燈確定後收斂為只最佳化 GitHub 來源。

## 整體檢查與交付邊界

- `pnpm test`：29 個測試檔，157 項測試通過。
- `pnpm build`：五個套件建置通過；Vite 仍提示部分前端區塊超過 500 kB，未在此工作重構打包。
- `git diff --check`：通過。
- 驗證階段沒有修改使用者 notes，也沒有 commit、push、CI 或部署。工作區中同時進行的樣式與介面修改保留，未歸入本項修正。
- 尚未驗證真實線上帳號的剩餘額度或多 Vercel 實例負載；程序內快取與超大 archive 回退限制見 [設計](design.md)。

後續使用者授權 commit 並要求乾淨的工作目錄：限流修正與既有提交列翻譯分開提交。未追蹤的本機 notes 原樣保留，以只在 core 分支生效的本機 Git 排除設定處理，不放入產品 commit；沒有授權 push 或部署。
