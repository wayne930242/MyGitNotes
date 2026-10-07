# 工作區獨立 Agent System

每個工作區的 `main` 分支只放工作區內容，自行追蹤根目錄 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md`、`.agents/**`、`.codex/**`、`.claude/**` 與 `.agent/**`。Core 不追蹤這些實體檔案，也不透過共用 `.gitignore` 隱藏它們；更新時保留工作區內容與使用者刪除狀態。產品開發指引位於 [product/index.md](../product/index.md)，產品技能位於該目錄的 `skills/`。

## 新工作區

在 `core` checkout 執行 `pnpm bootstrap-workspace`：以 orphan 分支在 core checkout 內、由 `.gitignore` 忽略的 `workspace/` worktree 建立 `main`（`--path` 可指定其他位置），從 `examples/workspace-agent-system/` 複製缺少的初始指引與技能並提交，再把 `MYGITNOTES_LOCAL_PATH` 寫入 core 的 `.env`。之後可自行新增技能、Agent 角色及規則，照常透過 Git 管理。重複初始化不會覆蓋已存在的檔案。

## Core 更新

在 `core` worktree 執行 `pnpm update-core`：只從 `upstream`（或 `origin`）的 `core` fast-forward，接著對 `.env` 指定的工作區執行 `migrate-workspace`。`core` 有本機 commit 時拒絕更新。更新後執行 `pnpm install`、`pnpm build`。Core 的 Agent 範本更新不會同步覆寫已建立的設定。

## 轉換舊工作區

分離前建立、`main` 仍帶著產品程式碼的工作區，在乾淨的 `main` 執行一次 `pnpm convert-workspace`：取得目前的 `core`，以一個 commit 移除其 sparse 部署清單內的產品路徑，以及與 `main` 上次合併的 Core 版本完全相同的檔案；Agent 設定與共用資料夾內屬於工作區的檔案保留並列出。`update-core` 只在 `core` 執行，不會合併進 `main`。公開 demo 的 release 只同步範例到只放內容的 `main`。

## Agent 工作區

Agent 工作區是 Pi 工作的資料夾。每個儲存庫的根目錄一定是 Agent 工作區；其他資料夾放了 `AGENTS.md` 就成為工作區。可以當工作區的資料夾有三種：筆記本根目錄、它的上層資料夾，以及筆記本內的一般資料夾（路徑不含隱藏資料夾）。工作區的名稱就是資料夾名稱，主儲存庫的根目錄以工作區標題顯示。

一個工作區有三個部分：

- 核心指示：`<資料夾>/AGENTS.md`。
- 技能：`<資料夾>/.agents/skills/<名稱>/`，入口是 `SKILL.md`。參考資料是技能內 `scripts/` 以外的 Markdown 或文字檔；腳本是 `scripts/` 內的文字檔（`.sh`、`.py`、`.js`、`.ts`、`.json`、`.yaml`、`.toml` 等）。
- MCP 伺服器：社群版的 Agents 頁沒有這一區，請在 Pi 裡設定（`pi mcp add`，或對話中的 `/mcp`）。MCP 設定可能帶 token，所以不放進儲存庫。Pro 版預計透過 `WebFeature.agentWorkspaceSections` 在 Agents 頁加上 MCP 設定，存在伺服器的加密紀錄；目前尚未提供。

這些都是 Pi 自己讀的路徑：Pi 從執行資料夾往上讀每一層的 `AGENTS.md`，也讀到儲存庫根目錄為止每一層的 `.agents/skills/`。因此內層工作區也套用外層工作區的核心指示與技能，Agents 頁會列出這些外層工作區。App 不替各工具轉換或複製檔案；Codex 與新版 Antigravity 也讀 `.agents/skills/`。

## 介面

Agents 頁先選工作區，再編輯它的核心指示與技能。「新增工作區」選一個筆記本或其中的資料夾，在那裡建立 `AGENTS.md`。根目錄還沒有 `AGENTS.md` 時，頁面提供「撰寫核心指示」。

`SKILL.md` 的編輯器只顯示內文；名稱、描述與其他欄位放在右側面板，和筆記的標頭屬性一樣有表單與 YAML 兩種檢視。名稱就是技能資料夾的名稱，修改名稱會重新命名整個技能資料夾，並更新其他工作區檔案裡指向它的路徑。腳本以程式碼編輯器開啟，參考資料與核心指示以 Markdown 編輯器開啟。

右側欄的 Agent 窗格同樣選工作區，Pi 在該資料夾執行，預設是主儲存庫的根目錄。切換工作區會結束目前的對話；記住的工作區已不存在時，回到主儲存庫的根目錄。

本機編輯自動儲存至磁碟，使用 Git 提交保留版本；本機「還原」取回目前 HEAD 版本。GitHub 來源需登入並具有 main 寫入權限，編輯會建立 Git 提交，版本衝突保留畫面草稿。GitHub 已提交內容的回復請使用 Git 歷史，不提供磁碟草稿的還原按鈕。

## 其他工具的檔案

`CLAUDE.md`、`GEMINI.md`、`.claude/**`、`.codex/**`、`.agent/**`、`.agents/agents/**`、這些資料夾內的 `rules/` 與 `docs/`，以及筆記本內的 `docs/agent/**`，不再出現在 Agents 頁。檔案原樣留在儲存庫，仍可從變更面板提交。Core 的產品參考文件（`docs/agent/**`）也不在 Agents 頁顯示，MCP 的 `read_agent_resource` 照舊可以讀。

要讓 Pi 使用這些檔案，手動遷移：

- `.claude/skills/<名稱>/`（或 `.codex/skills/`、`.agent/skills/`）移到同一層的 `.agents/skills/<名稱>/`。Pi 讀不到原本的位置。
- 只有 `CLAUDE.md`、沒有 `AGENTS.md` 的資料夾：Pi 讀得到 `CLAUDE.md`，但 Agents 頁不把它當工作區。把內容併進 `AGENTS.md`，資料夾就會出現在工作區清單。
- 只有 `.agents/skills/`、沒有 `AGENTS.md` 的資料夾（儲存庫根目錄除外）：Pi 與 MCP 的 `list_skills` 照常使用這些技能，但 Agents 頁不把資料夾當工作區，技能也就不會出現。加上 `AGENTS.md`，技能才會顯示在 Agents 頁。
- 已經用 `AGENTS.md` 與 `.agents/skills/` 的資料夾不用改。

Git 路徑所有權涵蓋完整 Agent 目錄，Agents 頁只開放上述工作區檔案。`.codex/auth.json`、`.codex/config.toml`、`.claude/settings*.json`、`CLAUDE.local.md`、憑證、執行紀錄與隱藏檔不會開放；檔案不得透過符號連結讀寫其他檔案。憑證與執行紀錄應維持本機私有，不提交。
