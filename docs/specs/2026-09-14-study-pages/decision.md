# 分頁與學習河道

Durable。使用者在本次對話確認以純 Markdown `---` 分頁，並回覆「好，實作？」授權實作已討論的方案。

| Question | Answer | Basis | Status |
|---|---|---|---|
| 正文格式 | 以頂層獨立 `---` 分頁，既有閱讀保持連續呈現 | 使用者明確要求 | confirmed |
| 本次可操作範圍 | 分頁閱讀、整份筆記正反面、隨選延後、固定間隔與 FSRS、到期篩選、手機操作 | 前述方案及實作授權 | confirmed |
| 未來功能 | 多題、反向卡、填空卡與線性簡報共用分頁及獨立卡片身分；本次預留資料結構 | 使用者要求評估未來 | confirmed |
| 學習資料 | 工作區側錄檔保存固定 ID、內容對應與完整事件，河道保存查詢及呈現 | 乾淨正文與跨裝置需求 | grounded |
| 內容修改 | 唯一且內容相同的頁面可重新定位；語義改變需重新配對並選擇是否重設 | 穩定學習身分 | grounded |
| 倉庫 | 同一產品遠端的隔離 core checkout；完成後更新 trpg-notes main | 本機產品 checkout 有他人未提交修改 | grounded |

核心規則已確認：產品與使用者資料分支分離、共享領域邏輯位於 packages/core、既有來源授權與版本衝突檢查保留。Open consequential decisions: none.
