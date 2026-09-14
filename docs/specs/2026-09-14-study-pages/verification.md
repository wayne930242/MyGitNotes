# 驗證

2026-09-14：產品隔離 checkout `github-notes-study`，基底 core `1c47a82`，本次統一預設收合的進階學習設定，並依來源筆記本產生任意階段數的預設策略。

| Requirement | Evidence | Result |
|---|---|---|
| 1. 純 Markdown 分頁 | note-pages 核心測試涵蓋 frontmatter、程式碼、HTML、巢狀結構與 Setext；瀏覽器開啟編輯器前後比對原稿 | pass |
| 2. 泳道單卡閱讀／學習 | qa-study 在由獨立按鈕進入全螢幕後直接揭示、評分、換卡；無筆記學習彈窗 | pass |
| 3. 隨選閱讀與延後 | qa-study 驗證閱讀換頁不寫入紀錄、stage-postpone 自訂日期及 FSRS 次數不變 | pass |
| 4. 熟悉程度與 stage status | 核心及瀏覽器驗證四種評分、跳兩階／最後階段、目的階段間隔與筆記 status 持久化 | pass |
| 5. 篩選與互斥排序 | screen-content 核心測試；瀏覽器驗證一般泳道按標題排序、學習頁固定最早到期；篩選配置套用後重載保留、取消不保存 | pass |
| 6. 卡片身分與重新配對 | 核心 study 測試涵蓋多卡、唯一內容重排、歧義及身分保留 | pass |
| 7. 保存、撤銷及衝突 | HTTP 與瀏覽器驗證撤銷、過期筆記拒絕、503 後停留原卡及重試事件數 | pass |
| 8. 來源邊界與資料保存 | local HTTP 驗證 main／symlink／兩檔保存失敗回復；GitHub adapter 模擬同一 tree 保存兩檔及非強制更新；core-update 保留測試 | pass |
| 9. 手機手勢與控制 | qa-study 原生觸控換頁、揭示前評分收起並停用、左右滑動只換頁、320／390px 按鈕尺寸及寬度 | pass |
| 10. 工具列與標籤 | qa-workspace-toolbar 驗證折疊單列、篩選展開、標籤不換行、控制留在 viewport | pass |
| 11. 手機共用頁首 | 筆記、屏幕、資源庫、Agent、設定五頁，320／390／820／1440px，以及 SPA 切頁後側欄開關同列且唯一 | pass |
| 12. 編輯器分頁版型 | qa-study 驗證兩個可見分頁間距、尺寸及原始 Markdown 不變 | pass |
| 13. 泳道專屬頁 | qa-study 直接重載專屬網址、只呈現一泳道、手機操作、評分撤銷、編輯器重載後返回、缺少泳道提示 | pass |
| 14. 前後頁及前後卡片 | qa-study 驗證答案返回題目、再次前進至所有答案頁、泳道箭頭切卡且不寫入事件 | pass |
| 15. 明確啟用與集中配置 | qa-workspace-toolbar 從新增視窗建立一般泳道、開始學習不修改 view、學習頁設定取消不保存、套用後 view 不變及返回一般泳道 | pass |
| 16. 單列 navbar | qa-study 驗證 320／390／820／1440px 所有 navbar 控制同列、44px 高、返回、撤銷與設定同列；320×420 底部操作完整可見且內容高度至少 80px | pass |
| 17. 共用按鈕狀態 | qa-study 在全部內建主題檢查選中、未選中與 primary hover 對比至少 4.5:1，鍵盤焦點可見、停用按鈕不切卡 | pass |

| 18. 整張摘要卡開啟 | qa-study 點擊筆記卡內容開啟編輯器並返回；開啟圖示已移除；qa-screen 通過既有捲動與拖曳鍵盤排序 | pass |

本機自動化：`pnpm test` 通過 58 個測試檔、309 項測試。`pnpm build` 通過，保留既有的大型 bundle 提示。

瀏覽器：`node scripts/qa-study.mjs`、`node scripts/qa-workspace-toolbar.mjs` 與 `node scripts/qa-screen.mjs` 通過。後者驗證既有一般泳道捲動、排序、來源編輯、拖曳排序與資源載入重試。截圖位於忽略版控的 `artifacts/qa/`，已檢視手機學習與全螢幕、編輯器分頁及配置視窗畫面。

GitHub 來源證據為真實 adapter 搭配模擬遠端回應；本機兩檔更新驗證涵蓋一般寫入失敗回復，不代表突然斷電恢復。上述測試不代表 CI 或線上部署。

`examples/study` 提供一般 status 接收泳道、可由獨立學習入口操作的筆記泳道。獨立 demo main 工作區由 dev server 提供試用。產品提交與推送、CI、使用者工作區匯入及受保護資料比對分別於交付時核對。

Reflexive：低高度瀏覽器檢查發現全螢幕隱藏全域 footer 後仍有 64px 預留，已由外層版面修正並重跑驗證；同一選卡值不觸發 change 的測試流程改為明確關閉操作視窗。

| Requirement | Evidence | Result |
|---|---|---|
| 19. 底部固定位置與循環 | qa-study 比對翻頁列與撤銷的座標及尺寸，涵蓋揭示、切卡、評分後、撤銷後、儲存失敗及空佇列；桌面及手機揭示前後相同，三頁按鈕與觸控可循環 | pass |

Reflexive：沿用既有頁首插槽與共用 footer，這次無新增流程摩擦。

| Requirement | Evidence | Result |
|---|---|---|
| 熟悉程度展開動畫 | qa-study 在真實瀏覽器以 requestAnimationFrame 取樣，觀察高度從 0 經中間值展開，主要列每幀位置偏差小於 0.5px；減少動態效果設定時無過渡並直接呈現 | pass |

| Requirement | Evidence | Result |
|---|---|---|
| 20. 共用收合的進階設定 | qa-workspace-toolbar 從一般編輯儲存學習設定，從學習頁取消／套用；每次開啟均收合，展開不寫入，明確恢復預設可保存。320px 實際瀏覽器確認展開及欄位寬度 | pass |
| 21. YAML 預設策略 | 核心測試涵蓋 1、2、3、6 階與空設定、去重及 archived 排除；HTTP 證實只使用來源筆記本狀態且 intervalDays 為 3，僅 archived 時拒絕寫入。瀏覽器預覽 1／2／3／未設定 statuses 後取消，Screen YAML 保持相同 | pass |

Reflexive：移除普通／學習編輯表單分流，將預設階段產生集中在 core，避免前端預覽與後端套用各自推算。

交付前遠端新增 MyGitNotes／GitLab 來源支援（442eae6）。整合後重跑 pnpm build、309 項測試及兩組學習／工具列瀏覽器驗證，全部通過。匯入列保留 createRemoteSource 與本次 studyLaneStatuses。
