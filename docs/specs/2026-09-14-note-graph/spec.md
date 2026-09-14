# 可觀察合約：Note Graph 筆記關聯圖

Status: approved
Approved at: 2026-09-14
Approved from: "同意"

## 可觀察合約

1. **圖結構解析（`@github-notes/core/note-graph`）**：
   - 接收 `NoteItem[]` 與當前工作區路徑，過濾無效或隱藏筆記（依選項），產出 `{ nodes, links }`。
   - 每個節點包含：`id`（筆記路徑）、`title`（標題）、`status`（狀態）、`tags`（標籤）、`inDegree`（被引用次數）、`outDegree`（主動引用次數）。
   - 邊為有向連結：來源筆記至目標筆記，排除指向外部 URL、錨點或不存在之檔案路徑。
   - 節點半徑依 `inDegree` 動態計算（基礎半徑 4px，隨被引用次數等比放大，最大 16px）。

2. **Desktop 導覽與全螢幕頁面（`/graph`）**：
   - 頂部 [`Header.tsx`](../../apps/web/src/components/Header.tsx) 導覽列擴充為 5 個項目：`Notes`、`Agent`、`Assets`、`Screen`、`Graph`。
   - 點選 `Graph` 進入全螢幕畫布頁面，自動適配視窗尺寸。
   - 支援滑鼠滾輪縮放（Zoom）、畫布平移（Pan）、節點拖曳物理排斥。
   - 點選節點直接開啟該筆記；懸停節點高亮其直接相鄰的入度與出度節點及連線，其餘節點與連線淡化。

3. **Mobile 導覽佈局保護（`< 768px`）**：
   - 底部導覽列（`.header-nav`）**維持 5 欄網格不變**（`repeat(5, minmax(0, 1fr))`），包含原本的 `[Notes] [Agent] [+] [Assets] [Screen]`，確保中央 52px 浮動新增筆記按鈕（`.mobile-nav-create`）空間充裕、外觀置中不變形、兩側間隔舒適。
   - 在手機端，使用者可透過 Notes 頂部視圖切換器（`ViewMode` 下拉選單中新增 `graph` 選項）切換至全螢幕關聯圖視圖；亦可在 `/graph` 路由直接瀏覽。

4. **視覺外觀與主題適配**：
   - 節點顏色對應工作區狀態配置（`inbox`: 灰色/紫藍色、`working`: 藍色/琥珀色、`done`: 綠色、`archived`: 深灰色），深淺色主題自動切換。
   - 標籤文字在縮放到一定比例時清晰呈現，避免畫面擁擠雜亂。

## 邊界情況與防護 (Edge Cases)
- **循環引用（A -> B -> A）**：物理力導向引擎能穩定收斂，不會陷入無窮遞迴。
- **孤立筆記（Orphan Notes，無任何出入度）**：正常呈現為散落節點，圍繞中心點分佈。
- **自引用（A -> A）**：自動過濾或不繪製自環邊，避免物理震盪。
- **目標筆記不存在（Broken Link）**：忽略無效連結，不產生虛假連線。
- **大量筆記效能**：Canvas 模式確保 1,000+ 筆記保持 60 FPS 流暢度；採用 `React.lazy` 動態加載，不膨脹初始載入體積。

## 非目標 (Non-goals)
- 不在本機或遠端儲存專屬圖資料庫檔案。
- 不提供心智圖式的拖拉直接建立連結連線操作（維持純 Markdown 文字編輯為唯一真理）。

## 依據與規範
- 專案架構規範：[`docs/agent/product/index.md`](../agent/product/index.md)
- 工作區版面規範：[`docs/specs/2026-09-13-workspace-layout/spec.md`](2026-09-13-workspace-layout/spec.md)
