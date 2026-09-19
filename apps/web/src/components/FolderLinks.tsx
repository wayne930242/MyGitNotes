import { ChevronRight, Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SubfolderInfo } from '../lib/folder-tree.js';
import { useTranslation } from '../lib/i18n/index.js';

export function FolderLinks({ folders, onSelect, children }: { folders: SubfolderInfo[]; onSelect?: (path: string) => void; children?: ReactNode; }) {
  const { t } = useTranslation();
  if (!folders.length && !children) return null;
  return (
    <div className='folder-links' aria-label={t('folder.folders')}>
      {children}
      {folders.map(folder => (
        <button
          key={folder.path}
          type='button'
          title={folder.path}
          onClick={() => onSelect?.(folder.path)}
          className='folder-link'
        >
          <Folder aria-hidden='true' />
          <span>
            <span className='folder-link-title'>{folder.title}</span>
            <span className='folder-link-count'>{t(folder.noteCount === 1 ? 'folder.noteCount' : 'folder.notesCount', { count: folder.noteCount })}</span>
          </span>
          <ChevronRight aria-hidden='true' className='folder-link-arrow' />
        </button>
      ))}
    </div>
  );
}
