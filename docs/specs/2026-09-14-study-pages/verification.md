# 驗證

2026-09-14：產品隔離 checkout `github-notes-study`，基底 core `ef0ae11`，本次修正學習泳道、status 流轉與全螢幕頁。

| Requirement | Evidence | Result |
|---|---|---|
| 1. 純 Markdown 分頁 | note-pages 核心測試涵蓋 frontmatter、程式碼、HTML、巢狀結構與 Setext；瀏覽器開啟編輯器前後比對原稿 | pass |
| 2. 泳道單卡閱讀／學習 | qa-study 在泳道內直接揭示、評分、換卡；無筆記學習彈窗 | pass |
| 3. 隨選閱讀與延後 | qa-study 驗證閱讀換頁、stage-read 事件、自訂日期及 FSRS 次數不變 | pass |
| 4. 熟悉程度與 stage status | 核心及瀏覽器驗證四種評分、跳兩階／最後階段、目的階段間隔與筆記 status 持久化 | pass |
| 5. 篩選與互斥排序 | screen-content 核心測試；瀏覽器切換最早到期及標題排序、重載後比對配置 | pass |
| 6. 卡片身分與重新配對 | 核心 study 測試涵蓋多卡、唯一內容重排、歧義及身分保留 | pass |
| 7. 保存、撤銷及衝突 | HTTP 與瀏覽器驗證撤銷、過期筆記拒絕、503 後停留原卡及重試事件數 | pass |
| 8. 來源邊界與資料保存 | local HTTP 驗證 main／symlink／兩檔保存失敗回復；GitHub adapter 模擬同一 tree 保存兩檔及非強制更新；core-update 保留測試 | pass |
| 9. 手機手勢與控制 | qa-study 原生觸控換頁、揭示前無評分、左右評分、320／390px 按鈕尺寸及寬度 | pass |
| 10. 工具列與標籤 | qa-workspace-toolbar 驗證折疊單列、篩選展開、標籤不換行、控制留在 viewport | pass |
| 11. 手機共用頁首 | 筆記、屏幕、資源庫、Agent、設定五頁，320／390／820／1440px，以及 SPA 切頁後側欄開關同列且唯一 | pass |
| 12. 編輯器分頁版型 | qa-study 驗證兩個可見分頁間距、尺寸及原始 Markdown 不變 | pass |
| 13. 泳道專屬頁 | qa-study 直接重載專屬網址、只呈現一泳道、手機操作、評分撤銷、編輯器重載後返回、缺少泳道提示 | pass |
| 14. 前後頁及前後卡片 | qa-study 驗證答案返回題目、再次前進至所有答案頁、泳道箭頭切卡且不寫入事件 | pass |
| 15. 明確啟用與集中配置 | qa-workspace-toolbar 從新增視窗建立一般泳道、切換學習後顯示設定、取消不保存、套用後重載及切回一般版型 | pass |

本機自動化：`pnpm test` 通過 55 個測試檔、287 項測試。`pnpm build` 通過，保留既有的大型 bundle 提示。

瀏覽器：`node scripts/qa-study.mjs`、`node scripts/qa-workspace-toolbar.mjs` 與 `node scripts/qa-screen.mjs` 通過。後者驗證既有一般泳道捲動、排序、來源編輯、拖曳排序與資源載入重試。截圖位於忽略版控的 `artifacts/qa/`，已檢視手機學習與全螢幕、編輯器分頁及配置視窗畫面。

GitHub 來源證據為真實 adapter 搭配模擬遠端回應；本機兩檔更新驗證涵蓋一般寫入失敗回復，不代表突然斷電恢復。上述測試不代表 CI 或線上部署。

`examples/study` 提供一般 status 接收泳道、明確啟用的學習泳道與隨選閱讀泳道。獨立 demo main 工作區由 dev server 提供試用。產品提交與推送、CI、使用者工作區匯入及受保護資料比對分別於交付時核對。
