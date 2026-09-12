import { Select } from './Select.js';
import React from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { NotebookConfig } from '../lib/types.js';
import { AssetLibrary, AssetLibraryProps } from './AssetLibrary.js';
import { useTranslation } from '../lib/i18n/index.js';

interface AssetBrowserProps extends AssetLibraryProps {
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
}

export const AssetBrowser: React.FC<AssetBrowserProps> = ({ notebooks, selectedNotebookId, onSelectNotebook, ...library }) => {
  const { t } = useTranslation();

  return (
    <div className="ui-panel shadow-sm p-3 md:p-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold flex gap-2 items-center">
          <ImageIcon className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
          {t('assets.title')}
        </h2>
        <Select aria-label={t('assets.title')} value={selectedNotebookId} onValueChange={onSelectNotebook} options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} className="w-full sm:w-auto sm:max-w-xs" />
      </div>
      <AssetLibrary key={selectedNotebookId} {...library} />
    </div>
  );
};
