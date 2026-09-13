# 工作區獨立 Agent System

## 目標與已確認需求

- 每個衍生 workspace 自行定義並透過 main 分支追蹤 Agent system，包括根目錄 `AGENTS.md`、skills 與其他 Agent 設定。
- Core 不再發布對工作區 `AGENTS.md` 的更新；產品修改從 github-notes 著手，再由 pnpm 更新流程帶入工作區。
- 遷移須保留既有工作區內容，包含 trpg-notes 尚未提交的介面修改規則。

## 範圍

涵蓋 Core 與 workspace 路徑所有權、初始化、既有工作區遷移、Core 更新、公開 demo 同步，以及 Agent system 介面的讀寫權限。

## 已確認範圍（2026-09-13）

以根目錄 `AGENTS.md`、`.agents/**`、`.codex/**` 為工作區擁有的 Agent 設定範圍；Core 的共用範本與產品開發指引移至產品文件／範本目錄。其他工具的設定目錄暫不納入。
