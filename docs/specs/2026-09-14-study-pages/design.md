# 設計

共用核心新增分頁解析及 study 領域模組。Markdown lexer 辨識頂層分隔線，回傳原始頁面文字。普通 renderNote 保持不變。

Study workspace 以版本化 YAML 保存 notes、pages、cards 與 events。頁面有固定 ID 與原始內容快照，用唯一內容重新定位；卡片以頁面 ID 定義正反面及可選遮罩。讀取時有內容差異則由介面提供重新配對。每張卡有自己的 FSRS 狀態與政策；閱讀排程位於 note 層，與作答事件分離。

選擇獨立側錄檔而非 frontmatter：正文修改與高頻學習寫入分離、同一筆記可有多張獨立卡片、既有 metadata 編輯器保持相容。代價是外部大幅修改後需要明確重新配對。

HTTP study endpoint 沿用 Screen Page 的 local 原子寫入與 GitHub CAS commit 模式，增加 schema、大小、分支及 regular-file 驗證。local 保存後走既有 Git commit 流程，GitHub 每個明確學習操作直接提交，狀態文字區分保存及同步。撤銷是新的持久化事件，保留歷史。

Screen 保存篩選條件，study controller 提供學習狀態、保存與衝突處理，StudyDialog 負責單卡操作。排程由 ts-fsrs 提供；呼叫端只傳入評分與時間。學習控制器不更新 note status。

驗證面：Markdown 結構與重排、多卡身分、閱讀／評分／撤銷事件、HTTP local 保存／競爭／授權及 GitHub adapter，桌面與手機真實瀏覽器操作。

## Friction Notes

產品指南的 Linux 路徑在本機不存在；核對 Mac checkout 的遠端及 core 分支後使用隔離 checkout，保留原 checkout 的未提交工作。

Git 檢視具有 query 與 body 兩層路徑限制；學習檔一併加入，並以 HTTP diff 測試確認。瀏覽器示範使用原生鍵盤／觸控輸入；切換手機模擬會重新載入，測試在重新載入後恢復操作。
