import { useLocation } from 'react-router-dom';
import { Folder } from 'lucide-react';
import { AssetLibrary, AssetLibraryProps } from './AssetLibrary.js';
import { WorkspaceSidebar } from './WorkspaceChrome.js';
import { useTranslation } from '../lib/i18n/index.js';

interface AssetBrowserProps extends AssetLibraryProps {
  selectedNotebookId: string;
}

export function AssetBrowser({ selectedNotebookId, ...library }: AssetBrowserProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const requestedAsset = new URLSearchParams(location.search).get('asset') || undefined;
  return <AssetLibrary key={selectedNotebookId} initialAssetPath={requestedAsset} initialDirectory={new URLSearchParams(location.search).get('directory') ?? undefined} {...library}
    renderSidebar={({ folders, directory, busy, onSelectDirectory }) => <WorkspaceSidebar label={t('nav.assets')} className="assets-sidebar">
      <div>
        <div className="sidebar-section-label">{t('folder.folders')}</div>
        {['', ...folders.filter(Boolean)].map(folder => <button type="button" key={folder} className="sidebar-link"
          disabled={busy} aria-pressed={directory === folder} onClick={() => onSelectDirectory(folder)}>
          <Folder aria-hidden="true" className="w-4 h-4" /><span>{folder || t('assets.root')}</span>
        </button>)}
      </div>
    </WorkspaceSidebar>} />;
}
