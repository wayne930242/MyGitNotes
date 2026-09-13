import { ScreenIcon } from './ScreenIcon.js';
import React, { useEffect } from 'react';
import { BookOpen, Bot, Image as ImageIcon, Settings } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import type { WorkspaceTab } from '../lib/routes.js';
import type { NotebookConfig } from '../lib/types.js';
import { Select } from './Select.js';

interface HeaderProps {
  workspaceTitle: string;
  sourceLabel?: string;
  accountControls?: React.ReactNode;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  notebooks: NotebookConfig[];
  selectedNotebookId: string;
  onSelectNotebook: (id: string) => void;
  notebookDisabled?: boolean;
}

export function Header({ workspaceTitle, sourceLabel, accountControls, activeTab, setActiveTab,
  notebooks, selectedNotebookId, onSelectNotebook, notebookDisabled }: HeaderProps) {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${t(`nav.${activeTab}`)} · GitHub Notes`;
  }, [activeTab, t]);
  const items = [
    { id: 'notes', label: t('nav.notes'), icon: BookOpen },
    { id: 'agent', label: t('nav.agent'), icon: Bot },
    { id: 'assets', label: t('nav.assets'), icon: ImageIcon },
    { id: 'screen', label: t('nav.screen'), icon: ScreenIcon },
  ] as const;
  return <header className="workspace-header">
    <div className="header-layout">
      <div className="header-brand">
        <img src={`${import.meta.env.BASE_URL}brand/github-notes-64.png`} width="32" height="32"
          alt="GitHub Notes" className="workspace-brand-icon" />
        <div className="min-w-0">
          <h1>{workspaceTitle || 'GitHub Notes'}</h1>
          <p>{sourceLabel || t('header.gitWorkspace')}</p>
        </div>
      </div>
      <nav aria-label="Main navigation" className="header-nav">
        {items.map(({id, label, icon: Icon}) => <button key={id} type="button"
          onClick={() => setActiveTab(id)} aria-label={label}
          aria-current={activeTab === id ? 'page' : undefined}
>
          <Icon aria-hidden="true" /><span>{label}</span>
        </button>)}
      </nav>
      <div className="header-account">
        {notebooks.length > 0 && <div className="header-notebook">
          <BookOpen aria-hidden="true" />
          <Select aria-label={t('sidebar.notebooks')} value={selectedNotebookId}
            title={notebooks.find(nb => nb.id === selectedNotebookId)?.title}
            disabled={notebookDisabled} onValueChange={onSelectNotebook}
            options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} />
        </div>}
        <div className="header-utilities"><button type="button" className="ui-icon-button header-settings" data-header-settings="" aria-label={t('nav.settings')} title={t('nav.settings')} aria-current={activeTab === 'settings' ? 'page' : undefined} onClick={() => setActiveTab('settings')}><Settings size={17} /></button>{accountControls}</div>
      </div>
    </div>
  </header>;
}
