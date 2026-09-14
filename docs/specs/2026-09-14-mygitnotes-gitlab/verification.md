# 驗證

## 自動化與圖像檢查

| Requirement | Evidence | Result |
|---|---|---|
| 三種來源、GitLab.com／自架、舊設定相容 | gitlab-source tests：站台子路徑、巢狀群組、設定驗證、舊環境變數 | pass |
| GitLab 登入、憑證更新及站台隔離 | gitlab-http tests：HTTP OAuth state / PKCE / callback、token rotation、共用 Redis lock、跨站台拒絕 | pass |
| 遠端讀寫及原子提交 | source + HTTP + MCP tests：固定 revision、分頁、未知 frontmatter、多檔提交、main 權限、移動／刪除 | pass |
| 版本衝突及資料邊界 | source tests：過期 revision、提交時衝突、symlink、產品路徑及唯讀拒絕 | pass |
| MCP grant 生命週期 | HTTP/MCP tests：唯讀工具列表、寫入、登出後存續、撤銷與憑證隔離；GitHub 既有 grant regression | pass |
| GitLab stdio source | SDK in-memory transport 驗證公開讀取、唯讀工具及禁止本機寫入 | pass |
| 共用 Redis 隔離與整合環境變數 | session-namespace tests：相同 token / owner 的隔離、撤銷、鎖、既有鍵值保留、原生 KV 環境變數 | pass |
| MyGitNotes 品牌與原有架構圖風格 | Chrome 筆記與設定頁檢查；以 imagegen 編輯原始中英文 PNG，逐張檢查名稱、繁體文字、雙平台圖示與箭頭；README 引用 PNG | pass |
| 本機與 GitHub 相容 | 圖片修正整合 core f45a311 後，完整 pnpm test 59 files / 318 tests 與 pnpm build 通過；包含既有 GitHub / local regression；check:core-ownership 通過 | pass |
| trpg-notes 更新與資料保存 | 圖片修正前已匯入 core 22ccbce、main 743b11b 已推送；59 files / 311 tests、build 通過；追蹤筆記、設定與代理檔案雜湊一致 | pass |

## 真實 GitLab.com 與 Vercel

驗證日期：2026-09-14。測試站：[MyGitNotes GitLab Test](https://mygitnotes-gitlab-test.vercel.app)。私有測試儲存庫：`wayne930242/mygitnotes-gitlab-test`，固定 `main` 分支。

| Requirement | Evidence | Result |
|---|---|---|
| Vercel 部署 | 部署 9MxE1467xMbtmyEFSf5ZimSNxw5P 顯示 Ready；來源 main fb31320 包含 core 22ccbce | pass |
| Core 發布流程 | [GitHub Actions 34827704922](https://github.com/wayne930242/github-notes/actions/runs/34827704922) completed / success | pass |
| OAuth 與私有筆記讀取 | 使用者同意 api scope 後，測試站回呼登入成功，讀取私有測試筆記並取得可寫分支 | pass |
| 瀏覽器提交 | 從測試站儲存 welcome.md，GitLab 持久化 commit d148b8996f3fbf75aa8ef9298335eea1ff292910；GitLab blob 頁確認內容 | pass |
| 遠端 MCP 讀寫 | 官方 SDK 連線，唯讀 grant 拒絕寫入；寫入 grant 提交 notes/test/mcp-validation.md，commit 8e6ae43bc9b2a3e8fdd2338201734e721c3c8ba9；讀回文字吻合、過期 revision 拒絕 | pass |
| 瀏覽器登出與 MCP 存續 | 確認瀏覽器已登出、私有來源要求登入後，既有 MCP grant 仍成功讀取 | pass |
| MCP 授權撤銷 | 兩個測試 grant 均已撤銷；SDK 分別於 09:34:16、09:34:33 UTC 驗證 HTTP 401；設定頁無持久化 Agent 授權 | pass |
| Redis 配置 | 使用者同意連接既有免費 my-gh-core-sessions；部署使用獨立 mygitnotes-gitlab-test namespace 與加密金鑰；未建立付費資料庫 | pass |
| 真實自架 GitLab | 尚未提供實際站台；站台子路徑與 API 行為由自動化測試覆蓋 | unknown |
| 真實 OAuth token 到期更新 | 實站登入已通過；未等待 token 到期，更新與並行鎖以自動化測試驗證 | unknown |

## 證據界線

表列雲端版本是實際登入與提交驗證時的部署，與後續文件／圖片提交分開記錄。GitLab 寫入使用分支預檢及每檔 last_commit_id 的原子批次提交；此證據不代表分支層級 compare-and-swap。Redis namespace 隔離應用資料鍵值，連接憑證本身仍可存取整個資料庫。建置有既有 Vite chunk size 提示，結果成功。

## Reflexive

使用者指出 Mermaid 取代原圖造成視覺退步，已改為直接編輯原始 PNG 並移除新建的 Mermaid／SVG 替代圖。圖中文字與構圖已檢查；使用者對新版美感的評價仍以實際回饋為準。提示詞保存在 [architecture-image-prompts.md](architecture-image-prompts.md)。
