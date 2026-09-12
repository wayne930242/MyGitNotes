import { Select } from './Select.js';
import React from 'react';
import {
  BookOpen,
  LayoutList,
  LayoutGrid,
  Kanban,
  Plus,
  Bot,
  Image as ImageIcon,
  Settings,
  Search,
  PanelLeft,
} from 'lucide-react';
import { ViewMode } from '../lib/types.js';

interface HeaderProps {
  workspaceTitle: string;
  readOnly?: boolean;
  sourceLabel?: string;
  accountControls?: React.ReactNode;
  activeTab: 'notes' | 'agent' | 'assets' | 'settings';
  setActiveTab: (tab: 'notes' | 'agent' | 'assets' | 'settings') => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onOpenNewNoteModal: () => void;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  workspaceTitle,
  readOnly = false,
  sourceLabel,
  accountControls,
  activeTab,
  setActiveTab,
  viewMode,
  setViewMode,
  searchQuery,
  setSearchQuery,
  onOpenNewNoteModal,
  filtersOpen,
  onToggleFilters,
}) => {
  return (
    <header
      className="border-b sticky top-0 z-20 transition-colors shrink-0 flex-none"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="header-layout px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
        {/* Left: Brand & Main Navigation Tabs */}
        <div className="header-left flex items-center gap-6 min-w-0">
          <div className="header-brand flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-xl text-white flex items-center justify-center shadow-md shadow-black/10"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              <BookOpen className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-semibold text-slate-900 dark:text-slate-100 text-base leading-tight tracking-tight">
                {workspaceTitle || 'GitHub Notes'}
              </h1>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span className="truncate">{sourceLabel || 'Git-Native Workspace'}</span>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav aria-label="Main navigation" className="header-nav flex shrink-0 items-center bg-black/5 dark:bg-white/5 p-1 rounded-xl gap-1">
            <button
              onClick={() => setActiveTab('notes')}
              aria-current={activeTab === 'notes' ? 'page' : undefined}
              style={
                activeTab === 'notes'
                  ? {
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-primary)',
                    }
                  : undefined
              }
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'notes'
                  ? 'shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Notes</span>
            </button>
            <button
              onClick={() => setActiveTab('agent')}
              aria-current={activeTab === 'agent' ? 'page' : undefined}
              style={
                activeTab === 'agent'
                  ? {
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-primary)',
                    }
                  : undefined
              }
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'agent'
                  ? 'shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>Agent System</span>
            </button>
            <button
              onClick={() => setActiveTab('assets')}
              aria-current={activeTab === 'assets' ? 'page' : undefined}
              style={
                activeTab === 'assets'
                  ? {
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-primary)',
                    }
                  : undefined
              }
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                activeTab === 'assets'
                  ? 'shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              <span>Assets</span>
            </button>
            {/* Settings Tab: Icon Only (Requirement 4) */}
            <button
              onClick={() => setActiveTab('settings')}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              title="Settings"
              aria-label="Settings"
              data-header-settings
              style={
                activeTab === 'settings'
                  ? {
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-primary)',
                    }
                  : undefined
              }
              className={`flex items-center justify-center p-2 rounded-lg text-sm font-medium transition ${
                activeTab === 'settings'
                  ? 'shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span className="mobile-nav-label">Settings</span>
            </button>
          </nav>
        </div>

        {/* Center / Right: Search & Actions */}
        <div className="header-actions flex items-center gap-3 flex-1 min-w-0 max-w-2xl justify-end">
          <div className="header-account">{accountControls}</div>
          {activeTab === 'notes' && (
            <div className="header-note-actions flex items-center gap-3 flex-1 min-w-0 justify-end">
              <button aria-label="Notebooks and filters" aria-expanded={filtersOpen} aria-controls="notebook-panel" onClick={onToggleFilters} className="mobile-only items-center justify-center rounded-lg border" style={{ borderColor: 'var(--color-border)' }}><PanelLeft className="w-5 h-5" /></button>
              {/* Search Bar */}
              <div className="header-search relative w-full min-w-0 max-w-xs">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  aria-label="Search notes"
                  placeholder="Search notes, tags, content..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-1.5 bg-black/5 dark:bg-white/5 border border-slate-200/80 dark:border-slate-700/80 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                  style={{ backgroundColor: 'var(--color-bg)' }}
                />
              </div>

              {/* View Switcher */}
              <Select aria-label="Note view" value={viewMode} onValueChange={value => setViewMode(value as ViewMode)} options={['list','card','kanban'].map(value => ({value,label:value[0].toUpperCase()+value.slice(1)}))} className="mobile-only note-view-select min-w-0 rounded-lg border bg-transparent px-1" />
              <div className="desktop-views flex items-center bg-black/5 dark:bg-white/5 p-1 rounded-lg gap-1 shrink-0">
                <button
                  onClick={() => setViewMode('list')}
                  title="List View"
                  style={
                    viewMode === 'list'
                      ? {
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-primary)',
                        }
                      : undefined
                  }
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'list'
                      ? 'shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <LayoutList className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('card')}
                  title="Card View"
                  style={
                    viewMode === 'card'
                      ? {
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-primary)',
                        }
                      : undefined
                  }
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'card'
                      ? 'shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('kanban')}
                  title="Kanban View"
                  style={
                    viewMode === 'kanban'
                      ? {
                          backgroundColor: 'var(--color-surface)',
                          color: 'var(--color-primary)',
                        }
                      : undefined
                  }
                  className={`p-1.5 rounded-md transition ${
                    viewMode === 'kanban'
                      ? 'shadow-xs'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Kanban className="w-4 h-4" />
                </button>
              </div>

              {/* New Note Button */}
              {!readOnly && (<button
                aria-label="New Note"
                onClick={onOpenNewNoteModal}
                style={{ backgroundColor: 'var(--color-primary)' }}
                className="header-new-note flex items-center gap-1.5 px-3.5 py-1.5 text-white rounded-lg text-sm font-medium shadow-sm transition hover:opacity-90 active:scale-95 shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>New Note</span>
              </button>)}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
