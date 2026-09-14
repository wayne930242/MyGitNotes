# MyGitNotes 與 GitLab 相容

成果：MyGitNotes 保留 GitHub，加入 GitLab.com 及自架 GitLab 的遠端筆記操作與 MCP。

| Question | Answer | Basis | Status |
|---|---|---|---|
| 功能範圍 | 登入、筆記讀寫、提交、遠端 MCP；保留 GitHub | 使用者逐項選擇完整遠端功能 | confirmed |
| GitLab 站台 | GitLab.com 與自架 GitLab | 使用者選擇兩者 | confirmed |
| 部署模型 | 每個部署固定平台、站台、儲存庫與分支 | 使用者選擇單一來源 | confirmed |
| 名稱 | MyGitNotes | 使用者提出名稱並回覆「好」 | confirmed |
| 相容性 | 保留既有設定檔、套件識別及 GitHub grants；新增中立部署設定 | 已確認保留既有設定相容 | grounded |
| 原始碼所有權 | macOS 產品 checkout 的 core；驗證並推送後以 update-core 更新 trpg-notes | 兩倉庫 remote 與產品指南 | grounded |

核心規則已確認：[產品指引](../../agent/product/index.md)。產品與使用者工作區資料分離。更名涵蓋產品標題、操作提示、文件與架構圖；遠端儲存庫 URL、部署 URL 與已發布套件識別沿用既有值，保持更新路徑。

- 使用者核准測試部署共用既有免費 Upstash Redis。新增可選資料前綴以隔離 sessions、credentials、grants 與 refresh locks；既有部署未設定時沿用原有鍵值。
