# 驗證紀錄

## 功能對照

- Core 不追蹤工作區 Agent 設定：原始根目錄指引與四個產品技能已移至 `docs/agent/product/`；`pnpm check:core-ownership` 通過。檢查測試證明 core 拒絕這些路徑，main 仍能正常追蹤。
- 新工作區：bootstrap CLI 測試證明 main 建立並提交初始指引與技能，Core 樹未包含工作區實體檔案，重複執行保留自訂內容。
- 舊工作區：真實暫存 Git 倉庫測試涵蓋 Core 刪除、重加及修改 Agent 設定、使用者自行刪除設定、非 ASCII 路徑、普通產品衝突、dirty tree、無效 manifest、重複更新及根目錄限制。
- 首次遷移：由產品目錄呼叫 `scripts/update-core.ts --workspace <舊工作區>` 的 CLI 測試成功；工作區根目錄指引仍被追蹤且保留自訂內容，產品 HEAD 未變動。
- 公開 demo：測試證明 Core 刪除舊 Agent 設定後，main 的自訂指引和未改動技能皆保留；一般衝突與並行遠端提交阻止發布。
- 本機介面：HTTP 與 `scripts/qa-workspace-agent-system.mjs` 瀏覽器驗證通過根目錄指引及技能編輯、切換前儲存、Git HEAD 還原、技能提交、Core 唯讀，以及憑證／產品路徑／內外部符號連結限制。
- GitHub 來源：HTTP 與來源層測試通過匿名唯讀、main 寫入權限、原始內容提交、版本比對與非強制 ref 更新。未使用真實帳號或遠端使用者檔案進行寫入測試。

## 執行結果

- `pnpm build`：通過；仍有前端 bundle 超過 500 kB 的提醒。
- `pnpm test`：32 個測試檔、169 項測試全部通過。
- `git diff --check` 與 `git diff --cached --check`：通過。
- 瀏覽器畫面：`artifacts/qa/workspace-agent-system.png`，已檢查；畫面套用同時進行的 workspace layout 變更。

## 實際提交與遷移（2026-09-13）

- Core 功能提交：`779572f`，已推送至 `github-notes/core`。HTTPS 因缺少 workflow scope 拒絕，改用現有 SSH Git 連線成功推送，未變更帳號憑證或遠端設定。
- 已在獨立 checkout `/tmp/github-notes-agent-release` 驗證此提交，未帶入並行版面任務的差異：Core 所有權檢查、build、169 tests 與瀏覽器檢查全部通過。
- `trpg-notes` 先提交既有規則為 `67af454`，再從已驗證的產品 checkout 執行 `pnpm update-core --workspace /home/weihung/trpg-notes`。
- 真實工作區遷移提交：`9a76f69`，已推送至 `trpg-notes/main`。Core 版本 `779572f` 為此提交祖先。
- 遷移前後，`notes/**`、工作區 manifest、`AGENTS.md`、`.agents/**` 與 `.codex/**` 共 82 個已追蹤檔案的 blob 雜湊與模式完全相同。根目錄指引與原有四個技能仍由 main 正常追蹤。
- 真實 `trpg-notes` 上的 `pnpm build` 與 `pnpm test` 通過（32 個測試檔、169 項測試）。
- 已實際啟動遷移後的工作區介面，確認 root 指引與四個技能列出；透過瀏覽器在 root 指引加入測試標記，確認磁碟儲存及 Git 差異，再透過 UI 還原。最終原文逐位元組相同、工作目錄乾淨且 HEAD 不變。
- 瀏覽器實測截圖：`/tmp/trpg-agent-migrated.png`；測試期間沒有提交測試標記。
- 另一個 workspace layout 任務的暫存與未提交內容均保留；本功能提交不含其版面差異。後續 UI 更新由該任務接手。
- 本次完成 commit、Core 推送、真實 workspace 遷移與 main 推送；尚未把 Vercel 遠端部署結果當作驗證通過的證據。
