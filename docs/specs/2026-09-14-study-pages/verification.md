# 驗證

2026-09-14：產品隔離 checkout 整合 core `31285d6` 後執行。

| Requirement | Evidence | Result |
|---|---|---|
| 1. 純 Markdown 分頁與相容性 | note-pages 核心測試涵蓋 frontmatter 後正文、頂層分隔線、程式碼、HTML、巢狀結構及 Setext；瀏覽器保存前後逐字比較原稿 | pass |
| 2. 河道進入閱讀與正反面 | qa-study 桌面從卡片開啟、依序換頁、揭示後呈現答案；核心測試驗證無分頁的標題／內文對應 | pass |
| 3. 隨選閱讀與延後 | qa-study 操作明天、固定間隔、修改間隔與自訂本地日期，核對持久化到期時間；核心測試確認不新增回想次數 | pass |
| 4. FSRS、配置及暫停 | qa-study 揭示後評分、核對 FSRS 狀態，修改保留率、暫停／恢復並保留閱讀日期；核心測試分辨閱讀卡與暫停卡 | pass |
| 5. 河道篩選及排序 | qa-study 保存未來篩選並重新載入；screen-content 測試核對到期排序與手動項目不變，study 測試核對暫停及到期分類 | pass |
| 6. 固定身分與重新配對 | 核心測試驗證多卡、唯一內容重排及歧義；qa-study 外部修改後明確重新配對，重設排程但保留卡片 ID | pass |
| 7. 保存、撤銷及衝突 | qa-study 重新載入、撤銷、競爭版本衝突、503 失敗後重試，核對事件數與保存狀態 | pass |
| 8. 來源邊界與工作區保留 | local HTTP 測試驗證 main、symlink、版本及 Git diff；GitHub adapter 與 HTTP 模擬驗證登入及非強制版本更新；core-update 測試保留學習檔 | pass |
| 9. 手機手勢與完整控制 | qa-study 原生觸控換頁、垂直捲動、揭示前不評分、左滑忘記／右滑記得，以及 320／390px 控制可達性 | pass |

本機自動化：`pnpm test` 通過 54 個測試檔、272 項測試。

建置：`pnpm build` 通過。Vite 保留既有的大型 bundle 提示。

瀏覽器：`node scripts/qa-study.mjs` 全部通過；`node scripts/qa-screen.mjs` 通過既有河道捲動、排序、標籤來源、側欄與手機控制回歸。畫面截圖保存在忽略版控的 `artifacts/qa/`。

GitHub 來源證據為真實 adapter 搭配模擬遠端回應；未以真實帳號操作線上學習資料。上列結果不代表部署或 CI 結果。

示範以四份 `examples/study` 原稿建立獨立 main 工作區，提供到期、未來與暫停狀態。dev server 的人工試用留待使用者回饋；可操作性已有瀏覽器檢查，主觀體驗尚未取得人工判定。

產品推送及使用者工作區更新以交付時的 Git 遠端與保護路徑比對為準，另行回報。完整簡報與多題／填空編輯器為已記錄的後續範圍。
