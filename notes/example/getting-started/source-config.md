---
title: 選擇筆記來源
tags: [設定, 入門]
status: done
---
# 選擇筆記來源

應用程式部署的位置與筆記來源分開設定。這個示範網站從 `wayne930242/github-notes` 的 `main` 分支讀寫筆記；產品程式維護在 `core`。

## 本機資料夾

在應用程式根目錄的 `github-notes.server.yaml` 指定：

```yaml
source:
  type: local
  path: /absolute/path/to/my-notes
```

本機來源使用該資料夾的工作目錄。編輯會保存到磁碟；Commit 才建立版本紀錄。

## GitHub 儲存庫

```yaml
source:
  type: github
  repository: your-account/your-notes
  branch: main
```

也可以用 `.env` 的 `GITHUB_NOTES_SOURCE`、`GITHUB_NOTES_REPOSITORY`、`GITHUB_NOTES_BRANCH` 設定，環境變數優先於 YAML。金鑰留在本機或部署環境變數。

來源 repo 的 `.github-notes.yaml` 定義 notebooks。新工作區使用根目錄設定；既有 `notes/.github-notes.yaml` 仍有較高優先權。每個 notebook 的 `root` 是 repo 相對路徑。
