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

## 工作區與交付狀態

- `trpg-notes` 的 `AGENTS.md` 仍由 Git 追蹤，保留前一輪新增的介面修改規則；本次未改動其筆記、設定或產品檔案。
- 產品目錄同時有另一個 workspace layout 任務；其專屬檔案及共用前端檔案的版面修改皆保留。整體建置與測試包含該並行工作，並非獨立發布產物。
- 本次尚未提交或推送 Core，也尚未對真實 `trpg-notes` 執行遷移。Core 舊指引／技能的刪除已暫存，以便 Git index 所有權檢查；其替代文件與功能修改仍待一併提交，不能只提交刪除項目。
- 無待確認的外觀決策。正式 GitHub／Vercel 部署及真實工作區遷移不列為已完成的驗證。
