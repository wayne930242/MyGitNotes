# 設計

共用核心新增分頁解析及 study 領域模組。Markdown lexer 辨識頂層分隔線，回傳原始頁面文字。普通 renderNote 保持不變。

Study workspace 以版本化 YAML 保存 notes、pages、cards 與 events。頁面有固定 ID 與原始內容快照，用唯一內容重新定位；卡片以頁面 ID 定義正反面及可選遮罩。讀取時有內容差異則由介面提供重新配對。每張卡有自己的 FSRS 狀態與政策；閱讀排程位於 note 層，與作答事件分離。

選擇獨立側錄檔而非 frontmatter：正文修改與高頻學習寫入分離、同一筆記可有多張獨立卡片、既有 metadata 編輯器保持相容。代價是外部大幅修改後需要明確重新配對。

HTTP study endpoint 沿用 Screen Page 的 local 原子寫入與 GitHub CAS commit 模式，增加 schema、大小、分支及 regular-file 驗證。local 保存後走既有 Git commit 流程，GitHub 每個明確學習操作直接提交，狀態文字區分保存及同步。撤銷是新的持久化事件，保留歷史。

Screen 保存篩選條件，study controller 提供學習狀態、保存與衝突處理，StudyLane 負責泳道單卡操作。stage action 由伺服器依持久化泳道配置計算目的 status 與間隔，原有 ts-fsrs 資料及方法保留相容性。

驗證面：Markdown 結構與重排、多卡身分、閱讀／評分／撤銷事件、HTTP local 保存／競爭／授權及 GitHub adapter，桌面與手機真實瀏覽器操作。

## 工具列與共用頁首

河道篩選及排序沿用同一組控制與保存邏輯，桌面顯示於 header，手機由按鈕展開。標籤與控制一組排列，文字保持單行；手機保留 44px 操作目標，一般卡片在手機以原生觸控捲動；閱讀／學習泳道的左右箭頭切換前後卡片。

Header 提供固定側欄開關插槽；WorkspaceSidebarToggle 透過 React portal 將各頁現有開關呈現在該插槽，開關狀態與處理仍由原頁面持有。筆記頁也使用共用開關。移除內容區為浮動開關預留的上方空白；低高度 Agent 頁收起品牌列，保留筆記本與側欄入口。

## Friction Notes

產品指南的 Linux 路徑在本機不存在；核對 Mac checkout 的遠端及 core 分支後使用隔離 checkout，保留原 checkout 的未提交工作。

Git 檢視具有 query 與 body 兩層路徑限制；學習檔一併加入，並以 HTTP diff 測試確認。瀏覽器示範使用原生鍵盤／觸控輸入；切換手機模擬會重新載入，測試在重新載入後恢復操作。

既有瀏覽器測試在下拉選單關閉後遇到焦點恢復競爭；測試等待實際焦點恢復再輸入，跨平台全選改用 input.select()。暫停狀態新增獨立旗標，讓閱讀提醒與記憶暫停可同時成立。

Reflexive：已依 solid-loop 移除產品指南中的機器限定絕對連結，改用相對文件連結。其餘摩擦以測試同步與領域狀態修正處理，未新增技能或流程規則。

## 河道階段實作

ScreenRow 增加閱讀／學習版型與 progression 設定，階段以 status 和 intervalDays 定義。核心模組負責計算流轉與可撤銷事件；畫面只提供當前卡片的翻頁、揭示與熟悉程度，設定集中在河道設定區。保存介面核對筆記正文／metadata 與學習版本，將狀態及事件一起保存；GitHub 使用同一個 Git commit，本機以序列化操作及失敗回復處理兩個檔案。純正文與未知 metadata 保留。

編輯器以可見分頁 widget 取代會縮成零寬的水平線 widget，沿用頂層 Markdown 分頁判斷。驗證點涵蓋四種評分、階段間隔、跨狀態河道移動、保存失敗停留、撤銷與 Markdown 原稿一致性。

## 專屬泳道頁與配置

路由解析新增 lane 身分，ScreenPage 僅呈現選定泳道，App 收起全域頁首及 Git footer。保留相同 React lane key，切換專屬頁延續當前卡片狀態；編輯器 returnTo 接受同一有效工作區路由。不存在的泳道提供返回提示。

StudyLane 提供受邊界及保存狀態限制的前後卡片操作；一般工具列與專屬頁呼叫同一組方法。答案揭示後，正面與背面組成連續頁序，回看題目保留揭示狀態。設定欄位是泳道編輯表單的一部分，提交時整體驗證，取消即捨棄本次草稿。

Reflexive：移除與泳道排序重複的最早到期勾選、分散的學習配置及筆記彈窗模式，使用既有版型、泳道編輯與路由結構承接需求。驗證使用隔離工作區，保持示範與真實筆記資料獨立。

## 獨立學習入口與控制樣式單一來源

ScreenPage 的一般 Lane 只呈現三種卡片大小。開始學習只改路由，不寫入 view 或 progression；學習頁將泳道候選筆記依到期排序，頁面的 mode 與 studyFilter 放在 query。伺服器依泳道已保存 progression 或工作區 status 的預設階段處理動作，不以 view 限制學習。

StudyLane 接收獨立 mode，負責閱讀／回想差異及前後卡片。Screen schema 讀取舊 reading／study view 時轉為 small，其他配置及身分保留。配置入口在學習 navbar，沿用泳道編輯表單的整體提交與取消。

Button 以原生 button 屬性、variant 和 size 提供共用元件。ui-buttons.css 是按鈕幾何與狀態配色的唯一來源；index.css 與 workspace.css 移除重複按鈕規則。hover 使用相同 variant 的 token，選中狀態由 aria-pressed 決定。主題設定分別計算主色與 hover 背景的文字顏色，維持對比。既有採用 ui-button class 的頁面共用同一套修正。

## 精簡單卡操作

StudyLane 持有佇列與次要操作視窗，StudyLaneCard 持有固定頁序與揭示狀態。卡片正文獨立捲動，底部控制為 flex 固定區；更多操作沿用 WorkspaceDialog 的焦點與關閉管理。篩選由 ScreenRowDialog 草稿與階段一起保存。

## 固定操作位置

共用 StudyFooter 同時呈現一般卡片及空佇列，熟悉程度常駐並依揭示狀態停用。儲存狀態供輔助工具讀取，錯誤置於卡片上方，維持底部位置。撤銷沿用頁首插槽及 React portal，佇列仍由 StudyLane 持有。

熟悉程度採用 CSS Grid 列高與透明度過渡展開，主要操作列保持底部對齊。收起時使用 aria-hidden 與停用按鈕，系統 reduced-motion 關閉過渡。

## 共用進階設定與預設策略

ScreenRowDialog 移除 studySettings 分流，使用原生 details 與獨立進階草稿。未改進階欄位時保留既有 progression，未保存預設隨來源筆記本變動；恢復預設為明確操作。core 的 studyLaneStatuses 與 defaultStudyProgression 由設定預覽、學習頁及 HTTP 操作共同使用，避免不同筆記本狀態污染與自動封存。

交付摩擦：遠端同時新增共用 GitLab 來源，推送被非快轉拒絕。依原流程合併遠端並保留雙方匯入，重新驗證，未覆寫他人變更。
