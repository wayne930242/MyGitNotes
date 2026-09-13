import React from 'react';
import { BookOpen, Bot, Image as ImageIcon, Settings } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import type { WorkspaceTab } from '../lib/routes.js';

interface HeaderProps {
  workspaceTitle: string;
  sourceLabel?: string;
  accountControls?: React.ReactNode;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
}

export function Header({ workspaceTitle, sourceLabel, accountControls, activeTab, setActiveTab }: HeaderProps) {
  const { t } = useTranslation();
  const items = [
    { id: 'notes', label: t('nav.notes'), icon: BookOpen },
    { id: 'agent', label: t('nav.agent'), icon: Bot },
    { id: 'assets', label: t('nav.assets'), icon: ImageIcon },
    { id: 'settings', label: t('nav.settings'), icon: Settings },
  ] as const;
  return <header className="workspace-header">
    <div className="header-layout">
      <div className="header-brand">
        <BookOpen aria-hidden="true" className="workspace-brand-icon" />
        <div className="min-w-0">
          <h1>{workspaceTitle || 'GitHub Notes'}</h1>
          <p>{sourceLabel || t('header.gitWorkspace')}</p>
        </div>
      </div>
      <nav aria-label="Main navigation" className="header-nav">
        {items.map(({id, label, icon: Icon}) => <button key={id} type="button"
          onClick={() => setActiveTab(id)} aria-label={label}
          aria-current={activeTab === id ? 'page' : undefined}
          data-header-settings={id === 'settings' ? '' : undefined}>
          <Icon aria-hidden="true" /><span>{label}</span>
        </button>)}
      </nav>
      <div className="header-account">{accountControls}</div>
    </div>
  </header>;
}
