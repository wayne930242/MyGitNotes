# 設計

`@github-notes/core/screen-page` 是瀏覽器可用的共同模型。版本 1 配置含有序泳道；每道為 custom 或 dynamic，view 為 thumbnail、small、medium。自訂項目以 notebookId 與完整工作區相對路徑識別；YouTube 僅保存驗證過的 videoId、起始秒數與選填標題。動態泳道只存查詢，不保存計算出的項目。

動態泳道可選填 `sort: { field: updated | created | title | status, order: asc | desc }`。舊配置不注入預設值，維持版本 1；自訂泳道不接受此欄位。前端重用筆記排序函式；跨筆記本的狀態順序依筆記本配置順序合併去重，未知狀態依標題排列。

前端以 flex 橫排呈現泳道，dnd-kit 負責拖曳感應、排序及鍵盤操作。只有自訂泳道註冊卡片放置目標，Pointer collision 必須實際命中目標。內文的垂直捲動與泳道的水平捲動分開；非 passive 的 wheel 監聽僅在 Alt + 垂直滾動且非 Ctrl 時 preventDefault，含水平邊界。側欄直接修改泳道順序，重新命名使用獨立視窗；排序選單與尺寸 icon tab 位於泳道標題列。變更沿用配置自動保存。

固定端點 `/api/screen-page` 讀寫固定檔案 `.github-notes-screen.yaml`。本地使用原始檔案雜湊做版本比較，同一程序按工作區序列化寫入，以暫存檔原子更名避免半份 YAML。檢查 main、普通檔案及 512 KiB 上限，拒絕符號連結。跨程序／外部 Git 操作仍應先停止修改並同步工作區；檔案系統不是分散式交易鎖。

遠端沿用 GitHubSource 的 main、登入寫入權限、commit revision 與 non-force reference update；只能單檔寫入 Screen YAML，不影響原始筆記。既有登入 SessionStore 維持不變；Screen 不使用 Redis。Core ownership checker 和 workspace updater 保護這份使用者配置。

Markdown 解析器將連結分成外部、錨點、工作區路徑、App route 與資源 hash。共用 React 提供者負責導覽與資源預覽，CodeMirror 和閱讀卡片標記來源路徑並共用處理；導覽前註冊既有編輯器的待儲存處理。原生 dialog 管理焦點，Select portal 放入所屬 dialog，避免選單被 top layer 遮住。

參考：[dnd-kit](https://docs.dndkit.com/)、[YouTube 嵌入參數](https://developers.google.com/youtube/player_parameters)、[Google metadata 指引](https://developers.google.com/search/docs/crawling-indexing/special-tags)。
