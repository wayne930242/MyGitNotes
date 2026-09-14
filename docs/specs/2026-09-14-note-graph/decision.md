# 決策記錄：Note Graph 筆記關聯圖

## 結果與參與者
- **結果**：在 GitHub Notes 建立筆記關聯圖（Note Graph / 知識圖譜）功能，包含純核心圖結構解析邏輯、Desktop 獨立 `/graph` 導覽頁面、以及相容 Mobile 現有底部 5 欄置中「新增按鈕」的雙軌存取機制。
- **使用者**：GitHub Notes 使用者、筆記寫作者、知識庫管理者。

## 範疇界定 (In & Out of Scope)
- **In Scope**：
  - `packages/core`：提供純函式解析 `NoteItem[]` 生成圖節點（Nodes）與邊（Links/Edges），包含內部 Markdown 相對路徑解析與反向連結計數（In-degree）。
  - `apps/web`：引入 `react-force-graph-2d`（動態載入），提供全螢幕力導向筆記關聯圖。
  - Desktop 導覽：頂部 Header 加入 `Graph` 頁面分頁（`/graph`）。
  - Mobile 導覽守護：維持底部導覽列 5 欄（`2 + [+] + 2`）置中 Add 按鈕佈局不變；手機端透過 Notes 視圖切換器（ViewMode 下拉選單增加 `graph`）進入關聯圖。
  - 互動：節點依狀態／標籤著色、半徑依關聯度加權、點擊節點開啟筆記、懸停高亮鄰接節點。
- **Out of Scope**：
  - 後端持久化圖資料庫（堅持純前端與 Core 運算，無伺服器架構）。
  - 編輯器即時雙向圖形拖拉連線（非心智圖編輯器，連結仍以純 Markdown 為唯一真相來源）。

## 關鍵決策矩陣

| Question | Answer | Basis | Status |
|---|---|---|---|
| 使用何種視覺化圖譜套件？ | `react-force-graph-2d`（Canvas + D3 物理力導向模擬） | 效能卓越（3000+ 節點 60fps）、支援 Canvas 客製化節點、Vite + React 18 動態載入友善、社群成熟 | confirmed |
| Graph 頁面在導覽結構中的定位？ | 雙軌導覽（Dual-track）：Desktop 頂部為獨立 `/graph` Tab；Mobile 維持底部 5 欄佈局，透過 Notes ViewMode 下拉選單進入 | 使用者確認方案 1，確保手機端置中 52px 浮動 Add 鈕不受擠壓且不破版 | confirmed |
| 圖結構解析邏輯放在哪裡？ | `packages/core/src/note-graph.ts` | 依據專案核心不變量（`docs/agent/product/index.md`），共用領域邏輯必須置於 `packages/core`，方便單元測試並可供 MCP 伺服器未來複用 | grounded |
| 節點與邊的萃取規則為何？ | 節點為筆記實體（含路徑、標題、狀態、標籤）；邊為 Markdown 語法內的內部相對連結 `[text](target.md)`，透過 `resolveWorkspaceHref` 驗證目標路徑 | 維持 Markdown 為唯一內容來源的原則，連結與導覽邏輯一致 | grounded |
| 點擊節點的行為？ | 點擊跳轉或開啟該筆記；懸停高亮直接相鄰節點並淡化無關節點 | 符合主流知識圖譜（如 Obsidian / Quartz）之標準操作直覺 | grounded |
