export const en = {
  // Navigation & Shell
  'nav.notes': 'Notes',
  'nav.agent': 'Agent System',
  'nav.assets': 'Assets',
  'nav.settings': 'Settings',
  'nav.coreBaseline': 'Core Baseline',
  'nav.coreBanner': 'You are currently on the canonical core branch. To create your personal workspace and notes, run pnpm bootstrap-workspace.',

  // Views & Header
  'view.list': 'List View',
  'view.card': 'Card View',
  'view.kanban': 'Kanban View',
  'header.searchPlaceholder': 'Search notes, tags, content...',
  'header.newNote': 'New Note',
  'header.sort': 'Sort',
  'header.gitWorkspace': 'Git-Native Workspace',
  'header.readOnly': 'Read-only',

  // Sorting
  'sort.updatedDesc': 'Updated (Newest)',
  'sort.updatedAsc': 'Updated (Oldest)',
  'sort.createdDesc': 'Created (Newest)',
  'sort.createdAsc': 'Created (Oldest)',
  'sort.titleAsc': 'Title (A-Z)',
  'sort.titleDesc': 'Title (Z-A)',
  'sort.status': 'Status (Workflow)',

  // Folders & Breadcrumbs
  'folder.allFolders': 'All folders',
  'folder.folders': 'Folders',
  'folder.up': 'Up',
  'folder.noteCount': '{count} note',
  'folder.notesCount': '{count} notes',
  'folder.subfolderCount': '{count} folder',
  'folder.subfoldersCount': '{count} folders',
  'folder.empty': 'Empty folder',

  // Sidebar
  'sidebar.notebooks': 'Notebooks',
  'sidebar.statusFilter': 'Status Filter',
  'sidebar.allStatuses': 'All Statuses',
  'sidebar.clear': 'clear',
  'sidebar.showHidden': 'Show hidden notes',
  'sidebar.tags': 'Tags',
  'sidebar.clean': 'Clean',
  'sidebar.dirty': '{count} dirty',
  'sidebar.productCore': 'Product Core',
  'sidebar.userWorkspace': 'User Workspace',

  // Note List & Card
  'notes.emptyTitle': 'No notes found',
  'notes.emptyDescription': 'No notes match your current filters, or this folder is empty.',
  'notes.createNote': 'Create Note',
  'notes.title': 'Title',
  'notes.status': 'Status',
  'notes.tags': 'Tags',
  'notes.modified': 'Modified',
  'notes.actions': 'Actions',
  'notes.delete': 'Delete note',
  'notes.noContent': 'No content',

  // Settings
  'settings.title': 'Workspace Settings',
  'settings.description': 'Configure appearance theme palettes, language, workspace manifest, and manage Core updates.',
  'settings.theme': 'Theme & Color Palettes',
  'settings.themeDescription': 'Select from curated light and dark color schemes with exposed palette swatches.',
  'settings.language': 'Language',
  'settings.languageDescription': 'Select your preferred interface display language.',
  'settings.coreUpdates': 'Core Product Updates',
  'settings.coreUpdatesDesc': 'Safely fetch and merge changes from the Core product branch into your workspace.',
  'settings.manifest': 'Workspace Manifest (.github-notes.yaml)',
  'settings.saveCommit': 'Save & Commit',
  'settings.saving': 'Saving...',
  'settings.saved': 'Workspace configuration saved and committed.',
  'settings.checkCoreStatus': 'Check Core Status',
  'settings.checkUpdateCore': 'Check & Update Core',
  'settings.updating': 'Updating...',
  'settings.repoRoot': 'Repository Root',
  'settings.githubSource': 'GitHub Source',
};

export type TranslationKey = keyof typeof en;
