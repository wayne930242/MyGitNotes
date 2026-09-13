---
name: github-notes-workspace
description: Use when initializing or manipulating a GitHub Notes workspace, notebooks, notes, or manifests.
---

# GitHub Notes Workspace Management

Follow this workflow when creating or updating workspace manifests, notebooks, notes, or assets.

## Workspace Hierarchy

```text
Workspace (/.github-notes.yaml)
└─ Notebooks (e.g. notes/example/)
   └─ Notes (*.md) & Assets (assets/)
```

## Invariants

1. **Manifest Location**: `/.github-notes.yaml` exists only on user workspace branches (e.g. `main`), never on `core`.
2. **Notebook Slugs**: Notebook IDs must be unique URL/filesystem-safe slugs.
3. **Roots**: Notebook roots must be relative to repository root and must not overlap.
4. **Frontmatter**: Preserve unknown frontmatter keys. A note without frontmatter is valid.
5. **Git Save**: Every programmatic or user edit transaction should create a clean Git commit.

## 資料夾索引

建立或整理資料夾入口時：

1. 先讀 manifest，確認目標筆記本的 `root`。在該根目錄或任意子資料夾使用小寫檔名 `index.md`；例如 `notes/example/index.md` 或 `notes/example/projects/index.md`。只代表所在資料夾，不套用到其他層級。
2. 索引使用一般 Markdown，可省略 frontmatter；保留既有欄位。連結相對於索引檔案所在位置，例如根目錄索引中的 `[專案](projects/)` 或 `[每週回顧](projects/weekly-review.md)`。不要為了卡片名稱把正文標題或 frontmatter title 強制改成「索引」。
3. 列表、卡片及看板的資料夾卡片列，會把索引放在第一張白色文件圖示卡片，介面標示「索引」或「Index」。點擊後沿用一般筆記的開啟及編輯流程，不在資料夾畫面直接展示正文；該份索引不再重複列於下方筆記區。
4. 索引卡片遵守隱藏筆記設定。搜尋、狀態／標籤篩選及「攤開」不顯示索引卡片，索引檔仍可依一般筆記規則出現在符合條件的結果中。資料夾名稱與排序仍由 `_dir.yml` 管理，勿用 `index.md` 取代它。
5. 完成前確認目標資料夾的索引卡片位置、點開的檔案路徑與相對連結；只有索引而沒有其他筆記的資料夾也應顯示卡片，不應誤報為空資料夾。

可操作的教學範例位於 `examples/demo-workspace/notes/example/index.md`。Core 維護教學時修改 examples；不要把教學寫入使用者的 `notes/**`。
