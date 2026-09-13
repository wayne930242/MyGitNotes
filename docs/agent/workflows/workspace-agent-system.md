# 工作區獨立 Agent System

每個工作區的 `main` 分支自行追蹤根目錄 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.agents/**`、`.codex/**`、`.claude/**` 與 `.agent/**`。Core 不追蹤這些實體檔案，也不透過共用 `.gitignore` 隱藏它們；更新時保留工作區內容與使用者刪除狀態。產品開發指引位於 [product/index.md](../product/index.md)，產品技能位於該目錄的 `skills/`。

## 新工作區

`pnpm bootstrap-workspace` 建立 main，從 `examples/workspace-agent-system/` 複製缺少的初始指引與技能並提交。之後可自行新增技能、Agent 角色及規則，照常透過 Git 管理。重複初始化不會覆蓋已存在的檔案。

## 既有工作區第一次遷移

先將工作區既有變更正常提交，確認工作目錄乾淨；不要使用舊版更新腳本直接合併移除 Agent 檔案的 Core 版本。

在已取得本次更新且完成安裝、建置的 **github-notes 產品目錄** 執行：

```bash
pnpm update-core --workspace /absolute/path/to/workspace
```

此入口由新版產品程式執行，但操作指定工作區的 main。它先合併而不提交，再將工作區 Agent 路徑恢復成更新前的 Git 樹，包含檔案內容、模式與使用者刪除的狀態；其他產品衝突仍保留供處理。驗證成功後才建立合併提交。

若工作區已用舊版腳本進入衝突狀態，先保留並處理該狀態；本腳本不會自動丟棄修改或重設分支。

## 後續更新

在乾淨的 main 執行 `pnpm update-core`。更新完成後執行 `pnpm test`、`pnpm build`，檢查差異與使用者資料，再推送工作區。Core 的 Agent 範本更新不會同步覆寫已建立的設定。公開 demo 同樣使用保護 Agent 設定的 merge 流程，不再以 rebase 重寫 main 歷史。

## 介面支援

Agents 頁面優先顯示「工作區技能」，再呈現共用規則、筆記本文件與產品參考。技能維持在 repository 根目錄的原生路徑，切換筆記本仍可存取。

- 根目錄及 notes 內的 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`，以及 `.claude/CLAUDE.md`。
- `.agents/skills/`、`.codex/skills/` 內的 Markdown／文字文件，以及各技能的 `agents/openai.yaml` 原生介面設定。
- Claude Code 的 `.claude/skills/` 與 Antigravity 舊版相容目錄 `.agent/skills/` 內的 Markdown／文字文件。
- Antigravity CLI 的 `.agents/skills/<name>.md` 單檔技能。
- `.agents/agents/`、`.codex/agents/` 內的 Markdown、文字、TOML 或 YAML 角色設定。
- 上述設定根目錄的 `rules/` 內 Markdown／`.rules`，以及 `docs/` 內 Markdown／文字文件。
- notes 內既有 `docs/agent/` 文件。

本機編輯自動儲存至磁碟，使用 Git 提交保留版本；本機「還原」取回目前 HEAD 版本。GitHub 來源需登入並具有 main 寫入權限，編輯會建立 Git 提交，版本衝突保留畫面草稿。GitHub 已提交內容的回復請使用 Git 歷史，不提供磁碟草稿的還原按鈕。

技能保存原生路徑，不自動複製或轉換各工具的技能。[Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) 與新版 [Antigravity](https://antigravity.google/docs/skills) 使用 `.agents/skills/`；[Claude Code](https://code.claude.com/docs/en/skills) 使用 `.claude/skills/`。Antigravity 仍相容 `.agent/skills/`，其 [CLI](https://www.antigravity.google/docs/cli/plugins) 也提供單檔技能格式。

Git 路徑所有權涵蓋完整 Agent 目錄，介面可存取範圍則限於上述文件。`.codex/auth.json`、`.codex/config.toml`、`.claude/settings*.json`、`CLAUDE.local.md`、憑證、執行紀錄、隱藏檔與腳本不會開放；文件不得透過符號連結讀寫其他檔案。憑證與執行紀錄應維持本機私有，不提交。

## Core 檢查

`pnpm check:core-ownership` 與 `pnpm test` 會在 core 檢查 Git index，拒絕重新追蹤上述工作區 Agent 路徑。CI 使用 `pnpm check:core-ownership --core`，支援 detached checkout；main 正常保留追蹤。
