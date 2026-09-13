# 行為規格（待確認）

## 預期行為

1. Core 停止版本追蹤根目錄 `AGENTS.md`、`.agents/**`、`.codex/**` 的工作區實體檔案。產品指引及可選初始範本移入 Core 擁有的文件／範本目錄；用檢查阻止這些工作區路徑被重新提交至 Core。
2. `pnpm bootstrap-workspace` 在 main 建立並提交缺少的 Agent 設定；重複執行保留使用者修改。倉庫辨識不再依賴根目錄 `AGENTS.md`。
3. main 中上述檔案保持一般 Git 追蹤，不以跨分支共用的 `.gitignore`、assume-unchanged 或 skip-worktree 隱藏修改。
4. 既有 workspace 遷移與 `pnpm update-core` 保留更新前已追蹤的 Agent 設定內容、增刪決策及追蹤狀態；包含首次匯入 Core 刪除這些檔案的版本，以及後續更新。首次遷移必須提供可由舊版工作區執行的明確入口，不能假設合併後的新程式已在執行。
5. 更新前維持乾淨工作目錄要求。一般產品衝突保留供處理；驗證完成前不得推送。公開 demo 同步同樣保留自己的 Agent 設定。
6. Agent system 介面將根目錄 `AGENTS.md` 與支援的工作區 Agent 文件視為工作區資源；讀寫遵守現有授權、分支及路徑安全規則。秘密、執行階段狀態及任意產品原始碼不因此開放編輯。

## 相容性與非目標

- 保留 `notes/**`、工作區設定、現有筆記層級 Agent 指引。
- 本次不實作 Agent 執行器、模型設定或憑證管理。
- 不自動更新已複製至 workspace 的 skill 內容。

## 依據與驗證

- `AGENTS.md`：調整既有 Core-owned paths 契約。
- `scripts/bootstrap-workspace.ts`：初始化及 root AGENTS 存在檢查。
- `packages/git/src/core-update.ts`：目前為一般 merge，須測試 Core 刪除與修改對工作區的影響。
- `scripts/sync-demo-main.mjs`：目前 rebase 流程須納入相同保護。
- `apps/local-server/src/local-app.ts`、`apps/local-server/src/app.ts`：目前根目錄指引視為唯讀產品文件。
- 先以暫存 Git 倉庫與初始化／更新腳本建立失敗案例，再驗證新建工作區、舊工作區遷移、自訂內容保留、後續更新、main 追蹤狀態、dirty tree 拒絕及產品衝突。介面讀寫補授權與路徑越界測試並實際檢查畫面，最後執行 `pnpm test`、`pnpm build` 與差異檢查。

## 使用者確認

2026-09-13：使用者回覆「同意」，確認上述設定範圍及遷移規格。
