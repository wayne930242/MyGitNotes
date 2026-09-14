# 驗證報告：Note Graph 筆記關聯圖

## 驗證矩陣 (Verification Table)

| Requirement | Evidence | Result |
|---|---|---|
| 圖結構解析（`@github-notes/core/note-graph`）：解析 `NoteItem[]` 產出 nodes 與 links，包含 inDegree/outDegree 與排除外連/錨點/無效路徑 | `packages/core/tests/note-graph.test.ts` 3 項單元測試全數通過，精確驗證入度加權、排除外部連結、相對路徑解析與隱藏過濾 | pass |
| Desktop 導覽與全螢幕頁面（`/graph`）：頂部導覽列擴充為 5 項，進入全螢幕畫布頁面，動態載入且支援縮放、平移、節點拖曳 | `apps/web/src/components/GraphPage.tsx` 透過 `React.lazy` 動態加載，Vite 打包產出獨立 chunk `dist/assets/GraphPage-*.js` (64.7 kB gzip)，`routes.test.ts` 驗證 `/graph` 路由成功解析 | pass |
| Mobile 導覽佈局保護（`< 768px`）：底部導覽列（`.header-nav`）維持 5 欄網格與置中新增按鈕，不擠壓破版 | `apps/web/src/workspace.css` 設定 `.workspace-header .header-nav .desktop-only { display: none !important; }`；手機端透過 Notes 工具列 `ViewMode` 下拉選單（包含 `graph` 選項）切換關聯圖 | pass |
| 視覺外觀與主題適配：深淺色主題切換、節點依 status 色彩區分、懸停鄰接高亮 | `GraphPage.tsx` 自訂 Canvas 繪製器適配 status 色系與 dark 模式，提供標籤文字與光暈特效 | pass |
| 專案整體型別與迴歸檢查 | `pnpm check:core-ownership` 通過；`pnpm test`（45 個測試檔案、228 項測試）全數通過；`pnpm build` 5 個套件編譯無錯誤 | pass |

## 人工檢視判定 (Human Appropriateness Verdicts)
- **視覺與操作體驗**：
  - Desktop 端導覽列自然整合 `Graph` 項目，點選即可瀏覽整座筆記星系。
  - Mobile 端保留原本的 5 欄對稱佈局與置中 52px 浮動圓形 `+` 按鈕，完全杜絕按鈕擁擠或換行破版風險。
  - 手機使用者在 Notes 頁面的視圖選單一鍵切換至 `關聯圖`，操作體驗一致。

## 偏差與未解決缺口 (Deviations & Gaps)
- 無偏差，實作完全符合已核准之規格合約。

## 反思與 Friction Gate (Reflexive Pass)
Reflexive: Clean run, no friction or detours.
- 早期調研階段精準識別了 `codebase-memory-mcp` 與 Note Graph 的領域模型錯位（AST 代碼符號 vs 筆記語意網路），避免了引入肥大外部圖資料庫的歧路。
- 緊密遵循使用者的敏銳反饋（Mobile 底部導覽 5 欄守護），採雙軌方案成功兼顧了大螢幕探索與小螢幕舒適觸控。
