import { Folder, BookOpen } from 'lucide-react';
import type { NotebookConfig } from '../lib/types.js';
import { AssetLibrary, AssetLibraryProps } from './AssetLibrary.js';
import { PageHeader, WorkspaceSidebar } from './WorkspaceChrome.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';

interface AssetBrowserProps extends AssetLibraryProps {
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
}

export function AssetBrowser({ notebooks, selectedNotebookId, onSelectNotebook, ...library }: AssetBrowserProps) {
  const { t } = useTranslation();
  return <AssetLibrary key={selectedNotebookId} {...library}
    renderHeader={busy => <PageHeader title={t('nav.assets')} description={notebooks.find(nb => nb.id === selectedNotebookId)?.title}>
      <Select aria-label={t('assets.title')} value={selectedNotebookId} onValueChange={onSelectNotebook} disabled={busy}
        options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} className="assets-notebook-picker" />
    </PageHeader>}
    renderSidebar={({ folders, directory, busy, onSelectDirectory }) => <WorkspaceSidebar label={t('nav.assets')} className="assets-sidebar">
      <div>
        <div className="sidebar-section-label">{t('sidebar.notebooks')}</div>
        {notebooks.map(nb => <button type="button" key={nb.id} className="sidebar-link" disabled={busy}
          aria-pressed={selectedNotebookId === nb.id} onClick={() => onSelectNotebook(nb.id)}>
          <BookOpen aria-hidden="true" className="w-4 h-4" /><span>{nb.title}</span>
        </button>)}
      </div>
      <div>
        <div className="sidebar-section-label">{t('folder.folders')}</div>
        {['', ...folders.filter(Boolean)].map(folder => <button type="button" key={folder} className="sidebar-link"
          disabled={busy} aria-pressed={directory === folder} onClick={() => onSelectDirectory(folder)}>
          <Folder aria-hidden="true" className="w-4 h-4" /><span>{folder || t('assets.root')}</span>
        </button>)}
      </div>
    </WorkspaceSidebar>} />;
}
