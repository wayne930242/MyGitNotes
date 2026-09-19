import { Button } from './Button.js';
import { ScreenIcon } from './ScreenIcon.js';
import React, { useEffect } from 'react';
import { BookOpen, Bot, Image as ImageIcon, Keyboard, Network, Plus, Settings } from 'lucide-react';
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
  onCreateNote: () => void;
  createNoteDisabled?: boolean;
  onOpenCommands: () => void;
  navigationDisabled?: boolean;
}

export function Header({ workspaceTitle, sourceLabel, accountControls, activeTab, setActiveTab, notebooks, selectedNotebookId, onSelectNotebook, notebookDisabled, onCreateNote, createNoteDisabled, onOpenCommands, navigationDisabled = false }: HeaderProps) {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = `${t(`nav.${activeTab}`)} · MyGitNotes`;
  }, [activeTab, t]);
  const items = [{ id: 'notes', label: t('nav.notes'), icon: BookOpen }, { id: 'graph', label: t('nav.graph'), icon: Network }, { id: 'assets', label: t('nav.assets'), icon: ImageIcon }, { id: 'screen', label: t('nav.screen'), icon: ScreenIcon }] as const;
  return (
    <header className='workspace-header'>
      <div className='header-layout'>
        <div className='header-brand'>
          <img src={`${import.meta.env.BASE_URL}brand/github-notes-64.png`} width='32' height='32' alt='MyGitNotes' className='workspace-brand-icon' />
          <div className='min-w-0'>
            <h1>{workspaceTitle || 'MyGitNotes'}</h1>
            <p>{sourceLabel || t('header.gitWorkspace')}</p>
          </div>
          <span id='workspace-sidebar-toggle-slot' className='sidebar-toggle-slot' />
        </div>
        <nav aria-label='Main navigation' className='header-nav'>
          {items.map(({ id, label, icon: Icon, ...item }, index) => (
            <React.Fragment key={id}>
              {index === 2 && (
                <Button variant='primary' type='button' className='mobile-nav-create' aria-label={t('header.newNote')} disabled={createNoteDisabled || navigationDisabled} onClick={onCreateNote}>
                  <Plus aria-hidden='true' />
                  <span>{t('header.newNote')}</span>
                </Button>
              )}
              <button
                type='button'
                disabled={navigationDisabled}
                onClick={() => setActiveTab(id)}
                aria-label={label}
                className={'desktopOnly' in item && item.desktopOnly ? 'desktop-only' : undefined}
                aria-current={activeTab === id ? 'page' : undefined}
              >
                <Icon aria-hidden='true' />
                <span>{label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className='header-account'>
          <div className='header-notebook'>
            <span id='workspace-sidebar-toggle-slot-mobile' className='sidebar-toggle-slot' />
            {notebooks.length > 0 && (
              <>
                <BookOpen aria-hidden='true' />
                <Select aria-label={t('sidebar.notebooks')} value={selectedNotebookId} title={notebooks.find(nb => nb.id === selectedNotebookId)?.title} disabled={notebookDisabled || navigationDisabled} onValueChange={onSelectNotebook} options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} />
              </>
            )}
          </div>
          <div className='header-utilities'>
            <button type='button' disabled={navigationDisabled} className='ui-icon-button header-agent' data-header-agent='' aria-label={t('nav.agent')} title={t('nav.agent')} aria-current={activeTab === 'agent' ? 'page' : undefined} onClick={() => setActiveTab('agent')}>
              <Bot size={17} />
            </button>
            <button type='button' disabled={navigationDisabled} className='ui-icon-button header-command' data-header-command='' aria-label={t('shortcuts.open')} title={t('shortcuts.open')} onClick={onOpenCommands}>
              <Keyboard size={17} />
            </button>
            <button type='button' disabled={navigationDisabled} className='ui-icon-button header-settings' data-header-settings='' aria-label={t('nav.settings')} title={t('nav.settings')} aria-current={activeTab === 'settings' ? 'page' : undefined} onClick={() => setActiveTab('settings')}>
              <Settings size={17} />
            </button>
            {accountControls}
          </div>
        </div>
      </div>
    </header>
  );
}
