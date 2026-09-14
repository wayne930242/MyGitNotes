# 驗證

| Requirement | Evidence | Result |
|---|---|---|
| 三種來源、GitLab.com／自架、舊設定相容 | gitlab-source tests：站台子路徑、巢狀群組、設定驗證、舊環境變數 | pass |
| GitLab 登入、憑證更新及站台隔離 | gitlab-http tests：HTTP OAuth state / PKCE / callback、token rotation、兩個 lock scope 共用 Redis lock、跨站台拒絕 | pass |
| 遠端讀寫及原子提交 | source + HTTP + MCP tests：固定 revision、分頁、未知 frontmatter、多檔提交、main 權限、移動／刪除 | pass |
| 版本衝突及資料邊界 | source tests：過期 revision、提交時衝突、symlink、產品路徑及唯讀拒絕 | pass |
| MCP grant 生命週期 | HTTP/MCP tests：唯讀工具列表、寫入、登出後存續、撤銷與憑證隔離；GitHub 既有 grant regression | pass |
| MyGitNotes 品牌與文件 | Chrome 實際渲染筆記與設定頁：MyGitNotes 標題、GitLab 登入、MCP 設定；雙語 README 與 Mermaid 架構來源更新 | pass |
| 本機與 GitHub 相容 | pnpm test：59 files / 303 tests；pnpm build 成功；針對性 GitHub / local 測試通過 | pass |
| GitLab stdio source | SDK in-memory transport 驗證公開讀取、唯讀工具及禁止本機寫入 | pass |
| trpg-notes 更新與資料保存 | 已匯入 442eae6，main df684af 已推送；追蹤筆記、設定與代理檔案雜湊一致；先 build 再 test 301 項通過 | pass |
| 真實 GitLab.com OAuth／提交 | GitLab.com 私有測試專案與 OAuth application 已建立；等待部署套用設定後進行真實登入 | unknown |
| 真實自架 GitLab | 尚未指定站台 | unknown |
| Vercel 測試部署 | mygitnotes-gitlab-test 已建立並 Ready；OAuth 與免費 Redis 已設定，等待套用最新隔離版本及登入驗收 | unknown |

| 共用 Redis 隔離與整合環境變數 | session-namespace tests：相同 token / owner 的隔離、撤銷、鎖、既有鍵值保留、原生環境變數 | pass |

## 證據界線

本機測試與瀏覽器 fixture 驗證不代表真實 GitLab 帳號、Redis 或雲端部署已驗收。建置有既有 Vite chunk size 提示，結果成功。

## Reflexive

專案指南與既有來源測試使共用邊界可直接抽取。瀏覽器檢查找出提示文字重複及登入入口載入時的平台閃現，已修正並複查。未變更工作區規則或個人記憶。
