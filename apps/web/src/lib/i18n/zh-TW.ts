import { TranslationKey } from './en.js';

export const zhTW: Record<TranslationKey, string> = {
  // Navigation & Shell
  'nav.notes': '筆記',
  'nav.agent': 'Agent 系統',
  'nav.assets': '資源庫',
  'nav.settings': '設定',
  'nav.coreBaseline': '核心基準分支',
  'nav.coreBanner': '您目前處於核心開發分支 core。若要建立個人筆記工作區，請執行 pnpm bootstrap-workspace。',

  // Views & Header
  'view.list': '清單檢視',
  'view.card': '卡片檢視',
  'view.kanban': '看板檢視',
  'header.searchPlaceholder': '搜尋筆記、標籤、內文...',
  'header.newNote': '新增筆記',
  'header.sort': '排序',
  'header.gitWorkspace': 'Git 原生工作區',
  'header.readOnly': '唯讀',

  // Sorting
  'sort.updatedDesc': '更新時間 (由新到舊)',
  'sort.updatedAsc': '更新時間 (由舊到新)',
  'sort.createdDesc': '建立時間 (由新到舊)',
  'sort.createdAsc': '建立時間 (由舊到新)',
  'sort.titleAsc': '標題 (A 到 Z)',
  'sort.titleDesc': '標題 (Z 到 A)',
  'sort.status': '狀態 (工作流程順序)',

  // Folders & Breadcrumbs
  'folder.allFolders': '所有資料夾',
  'folder.folders': '資料夾',
  'folder.up': '上一層',
  'folder.noteCount': '{count} 則筆記',
  'folder.notesCount': '{count} 則筆記',
  'folder.subfolderCount': '{count} 個資料夾',
  'folder.subfoldersCount': '{count} 個資料夾',
  'folder.empty': '空白資料夾',

  // Sidebar
  'sidebar.notebooks': '筆記本',
  'sidebar.statusFilter': '狀態篩選',
  'sidebar.allStatuses': '所有狀態',
  'sidebar.clear': '清除',
  'sidebar.showHidden': '顯示隱藏筆記',
  'sidebar.tags': '標籤',
  'sidebar.clean': '乾淨',
  'sidebar.dirty': '{count} 項變更',
  'sidebar.productCore': '產品核心',
  'sidebar.userWorkspace': '使用者工作區',

  // Note List & Card
  'notes.emptyTitle': '找不到筆記',
  'notes.emptyDescription': '沒有符合目前篩選條件的筆記，或此資料夾為空。',
  'notes.createNote': '建立筆記',
  'notes.title': '標題',
  'notes.status': '狀態',
  'notes.tags': '標籤',
  'notes.modified': '修改時間',
  'notes.actions': '操作',
  'notes.delete': '刪除筆記',
  'notes.noContent': '無內容',

  // Settings
  'settings.title': '工作區設定',
  'settings.description': '設定外觀主題配色、介面語言、工作區清單，並管理核心版本更新。',
  'settings.theme': '外觀與主題配色',
  'settings.themeDescription': '選擇精心設計的淺色與深色配色主題。',
  'settings.language': '介面語言',
  'settings.languageDescription': '選擇您偏好的使用者介面顯示語言。',
  'settings.coreUpdates': '核心產品更新',
  'settings.coreUpdatesDesc': '安全地將 Core 核心產品分支的最新更新擷取並合併至您的個人工作區。',
  'settings.manifest': '工作區設定清單 (.github-notes.yaml)',
  'settings.saveCommit': '儲存並提交',
  'settings.saving': '儲存中...',
  'settings.saved': '工作區設定已儲存並提交。',
  'settings.checkCoreStatus': '檢查核心狀態',
  'settings.checkUpdateCore': '檢查並更新核心',
  'settings.updating': '更新中...',
  'settings.repoRoot': '儲存庫根目錄',
  'settings.githubSource': 'GitHub 來源',
};
