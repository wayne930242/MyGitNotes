---
title: 資料夾索引｜index.md 與 README.md
tags: [getting-started, organization]
status: done
---
# 用 index.md 或 README.md 建立資料夾入口

你剛剛點開的白色「索引」卡片，就是這份筆記。英文介面會顯示 **Index**。

在筆記本根目錄或任何子資料夾放入一份 `index.md` 或 `README.md`，就能替該資料夾加上索引卡片。檔名大小寫依這兩種寫法；兩者都有時，以 `index.md` 為主。它使用資料夾卡片的版型、白色背景與文件圖示，排列在其他資料夾之前。

## 放在哪裡

這個示範筆記本的根目錄是 `notes/example`：

```text
notes/example/
├─ index.md               ← 筆記本根目錄的索引，也就是這篇教學
├─ welcome.md
└─ projects/
   ├─ index.md            ← 可自行新增，成為 projects 資料夾的索引
   └─ weekly-review.md
```

每份索引只對應所在的資料夾。沒有 `index.md` 時會使用同層的 `README.md`；兩者都沒有，就不會出現索引卡片，也不會借用上層的索引。同時存在時，`README.md` 仍留在一般筆記區，索引卡片只開啟 `index.md`。

## 點開與編輯

在列表、卡片或看板檢視中，點第一張「索引」卡片即可開啟正文，操作方式與其他筆記相同。資料夾畫面不會攤開整篇正文，也不會把這份索引再重複列在下方筆記區。

索引是一份普通 Markdown 文件，可以寫導覽、閱讀順序、資料夾說明或常用連結，不需要額外的設定檔，也不一定要有 frontmatter。卡片固定標示「索引／Index」，正文和筆記標題可以自行命名。

編輯後沿用一般儲存方式：本機寫入工作目錄；GitHub 模式先保留瀏覽器草稿，再透過底部的 Commit 提交。詳見[編輯與提交](getting-started/edit-and-commit.md)。

## 用連結串起內容

Markdown 連結以這份檔案所在位置為起點。例如根目錄索引可以寫：

```markdown
- [開始使用](welcome.md)
- [教學資料夾](getting-started/)
- [每週回顧](projects/weekly-review.md)
```

試著點開[開始使用](welcome.md)、[教學資料夾](getting-started/)或[每週回顧](projects/weekly-review.md)。若索引放在 `projects/`，連到同一層筆記只需寫 `weekly-review.md`；回上一層則使用 `../welcome.md`。

## 顯示規則

- 即使資料夾只有 `index.md` 或 `README.md`，仍會顯示索引卡片；被選作索引的檔案不重複列在下方筆記區。
- 被隱藏的索引不顯示卡片；打開「顯示隱藏筆記」才會出現。若同層的 `index.md` 被隱藏，也不會因此改用 `README.md`。詳見[狀態與可見性](getting-started/status-and-visibility.md)。
- 搜尋、狀態／標籤篩選及「攤開」時，不顯示索引卡片；索引檔仍可作為符合條件的一般筆記結果被找到。
- 資料夾的名稱與排序仍由 `_dir.yml` 管理，索引不會改變它們。
