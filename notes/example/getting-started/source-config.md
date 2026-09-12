---
title: 選擇筆記來源
tags: [設定, 入門]
status: done
---
# 選擇筆記來源

伺服器設定可以選擇本機資料夾或 GitHub 儲存庫，網站程式碼的 Git remote 不會決定筆記來源。

這個示範網站使用：

```yaml
source:
  type: github
  repository: wayne930242/github-notes
  branch: main
```

本機工作區可使用 `type: local` 與 `path` 指定資料夾。
