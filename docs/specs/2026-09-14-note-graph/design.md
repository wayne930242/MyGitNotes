# 設計實作：Note Graph 筆記關聯圖

## 選擇途徑 (Chosen Approach)
本功能分為兩個主要層次：
1. **核心領域解析（`packages/core/src/note-graph.ts`）**：
   - 純函式 `buildNoteGraph(notes: NoteItem[], options?: NoteGraphOptions): NoteGraphData`
   - 從 Markdown 正文解析內部連結 `\[.*?\]\((.*?)\)`。
   - 使用 `resolveWorkspaceHref` 將相對連結映射至目標筆記路徑。
   - 彙整節點清單 `NoteGraphNode`（含 `inDegree`、`outDegree`、`status`、`tags`、`title`）。
   - 彙整邊清單 `NoteGraphLink`（含 `source`、`target`）。
2. **Web 介面視覺化（`apps/web/src/components/GraphPage.tsx`）**：
   - 使用 `react-force-graph-2d` 繪製 Canvas 力導向圖。
   - 採 `React.lazy` 動態加載，避免阻塞主應用程式載入。
   - 依主題提供 Canvas 節點光暈與標籤文字渲染（深淺色適配）。
   - 提供互動面板（過濾無引用孤立節點、按標籤過濾、縮放至適當視野）。
   - 點擊節點觸發 `onSelectNote(path)` 開啟筆記。
3. **導覽結構整併（`apps/web`）**：
   - `lib/routes.ts`：`WorkspaceTab` 擴充 `'graph'`，支援 `/graph` 與 `/notebooks/:notebook/graph` 路由。
   - `components/Header.tsx`：Desktop 端新增 Graph 導覽按鈕。
   - `components/Sidebar.tsx` / `components/NoteToolbar.tsx`：Mobile 端保持底部導覽列 5 欄不變（`repeat(5, minmax(0, 1fr))`），在 Notes 工具列之 `ViewMode` 下拉選單中新增 `graph` 選項。

## 介面與資料流 (Interfaces & Data Flow)
```ts
export interface NoteGraphNode {
  id: string; // note path, e.g. "notes/example/welcome.md"
  title: string;
  notebookId: string;
  status?: string;
  tags: string[];
  inDegree: number;
  outDegree: number;
}

export interface NoteGraphLink {
  source: string; // note path
  target: string; // note path
}

export interface NoteGraphData {
  nodes: NoteGraphNode[];
  links: NoteGraphLink[];
}
```

## 現有前例 (Precedents)
- 連結解析：[`apps/web/src/lib/workspace-links.ts`](file:///Users/weihung/projects/github-notes/apps/web/src/lib/workspace-links.ts)
- 頁面懶載入：[`apps/web/src/components/ScreenPage.tsx`](file:///Users/weihung/projects/github-notes/apps/web/src/components/ScreenPage.tsx)
- 狀態色彩：[`packages/core/src/note-status.ts`](file:///Users/weihung/projects/github-notes/packages/core/src/note-status.ts)

## 真實接觸點（Reality Anchor）
- **Core 測試**：`packages/core/tests/note-graph.test.ts` 驗證單元測試（解析相向與反向連結、排除無效與外連、計算 inDegree）。
- **Web 編譯檢查**：`pnpm build` 驗證 TypeScript 型別與 Vite 打包無誤。
- **UI 佈局驗證**：檢查 `< 768px` 下 `.header-nav` 依然為 5 欄網格且未破版。
