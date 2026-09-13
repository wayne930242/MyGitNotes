# 工作區 Agent System 設計

- 工作區 Agent System：main 自行版本管理的根目錄指引與 Agent 設定目錄。Core 範本僅用於第一次初始化；不是持續同步來源。
- Git 所有權和網頁可編輯資源分離。Git 保留 `AGENTS.md`、`.agents/**`、`.codex/**` 的完整既有樹；`packages/core` 集中定義可編輯的文件路徑，供本機、GitHub 來源與 UI 清單共用。
- 更新採用先合併但不提交、還原工作區擁有的路徑、檢查剩餘衝突與驗證後提交。使用同一個無依賴 Node 合併模組供 updateCore 與 demo 同步呼叫。相較 rebase 後修補，此方式能在提交前排除 Core 對工作區設定的影響，保留 main 歷史。
- 初次遷移可由新版產品端執行 `pnpm update-core --workspace /path/to/workspace`，腳本使用指定目錄而非產品目錄。拒絕 dirty tree，舊版腳本不承擔首次遷移。
- Core 的開發指引及技能放在 `docs/agent/product/`；workspace 初始範本在 `examples/workspace-agent-system/`。Core 分支检查阻止重新追蹤工作區路徑；不新增跨分支忽略設定。
- 本機延續自動儲存至磁碟與明確 Git 提交流程；GitHub 編輯以 main 寫入權限、版本比對與非強制更新保護，傳回實際提交版本。介面讀取清單包含指引、skills 與支援的設定文件。
- 驗證採用真實暫存倉庫的初始化／合併／demo CLI、HTTP 授權與路徑測試、GitHub API 寫入測試及瀏覽器操作。無另行待定的外觀選擇。
