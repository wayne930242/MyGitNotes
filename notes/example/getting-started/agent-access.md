---
title: Agent System 與 MCP
tags: [入門, MCP]
status: done
---
# Agent System 與 MCP

Agent System 可檢視工作區的指引、skills 與文件。本機可使用與筆記相同的編輯器維護指引；指引文字與範例 MCP 指令建議使用英文。

## 連接 MCP

登入網站後開啟 **Settings → Access control**，為 connector 建立授權。唯讀授權適合先測試搜尋與閱讀；需要編輯時才使用可寫入授權。

複製畫面產生的完整 MCP URL 到 connector。URL 已包含授權憑證，請保存在 connector 設定中。授權持續有效，直到在 Access control 手動撤銷。

## 常用操作

- `ls`、`glob`：瀏覽路徑與篩選檔名。
- `read`、`find`：閱讀內容、搜尋文字。
- `write`、`append`、`edit`：寫入、追加或編輯特定位置。
- `mkdir`、`cp`、`mv`、`rm`：建立目錄、複製、搬移或刪除。

讀取結果提供 `revision`，寫入時使用該版本。版本過期會拒絕寫入，需重新讀取。

MCP 的每次成功異動都直接建立一筆遠端提交，提交訊息由程式產生。這與網頁的本機草稿、手動 Commit 流程分開運作。
