---
title: 狀態與封存
tags: [入門, 整理]
status: done
---
# 狀態與封存

此範例沿用預設狀態，notebook 沒有另外定義 `statuses`。

| 狀態 | 適合放什麼 |
|---|---|
| inbox | 新收集、尚未整理的想法 |
| working | 正在撰寫、研究或處理的筆記 |
| done | 已整理好、可供參考的內容 |
| archived | 暫時退出日常視野、仍要保留的內容 |

List、Card、Kanban 與筆記 Frontmatter 都使用同一組狀態。狀態可以留空；未指定狀態的筆記仍可閱讀。

## 隱藏與封存

切換為 archived 時，介面會寫入 `hiden: true`，預設列表因此隱藏這篇筆記。離開 archived 時會改為 `hiden: false`。

```yaml
status: archived
hiden: true
```

在左側欄勾選 **Show hidden notes**，就能看到 [封存回顧範例](../projects/archived-review.md)。直接開啟筆記網址也能閱讀。`hiden: false` 可以讓 archived 筆記繼續顯示。

筆記 Frontmatter 的 Hide note 可獨立控制隱藏。設定只影響瀏覽，不會刪除檔案。
