import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Network } from 'lucide-react';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { NotebookConfig } from '../lib/types.js';
import { createLaneNoteContext, screenViewTabs } from './ScreenPage.js';
import { KeyboardShortcuts } from './KeyboardShortcuts.js';

describe('createLaneNoteContext', () => {
  const notebooks: NotebookConfig[] = [
    { id: 'nb-1', title: 'Main Notebook', root: 'notes/main' },
    { id: 'nb-2', title: 'Second Notebook', root: 'notes/secondary' },
  ];

  it('extracts tag context for tag dynamic lanes with notebookId', () => {
    const row: ScreenRow = {
      id: 'r1',
      name: 'Clues',
      view: 'small',
      notebookId: 'nb-1',
      kind: 'dynamic',
      source: { kind: 'tag', tag: 'clue', notebookId: 'nb-1' },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      tag: 'clue',
      notebookId: 'nb-1',
    });
  });

  it('extracts relative folder context for nested folder dynamic lanes', () => {
    const row: ScreenRow = {
      id: 'r3',
      name: 'Deep Folder',
      view: 'medium',
      notebookId: 'nb-1',
      kind: 'dynamic',
      source: { kind: 'folder', notebookId: 'nb-1', path: 'notes/main/campaign/sessions', recursive: true },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      notebookId: 'nb-1',
      folder: 'campaign/sessions',
    });
  });

  it('extracts empty string folder context when folder is at notebook root', () => {
    const row: ScreenRow = {
      id: 'r4',
      name: 'Root Folder',
      view: 'thumbnail',
      notebookId: 'nb-2',
      kind: 'dynamic',
      source: { kind: 'folder', notebookId: 'nb-2', path: 'notes/secondary', recursive: false },
    };
    expect(createLaneNoteContext(row, notebooks)).toEqual({
      notebookId: 'nb-2',
      folder: '',
    });
  });

  it('returns null for custom lanes', () => {
    const row: ScreenRow = {
      id: 'r5',
      name: 'Pinned',
      view: 'small',
      notebookId: 'nb-1',
      kind: 'custom',
      items: [],
    };
    expect(createLaneNoteContext(row, notebooks)).toBeNull();
  });
});

describe('Screen view icons', () => {
  it('uses the same network icon for a lane graph as the main Graph navigation', () => {
    expect(screenViewTabs.find(item => item.value === 'graph')?.icon).toBe(Network);
  });
});

describe('Screen sidebar keyboard shortcuts', () => {
  it('renders toggle-screen-sidebar enabled when on screen tab', () => {
    const html = renderToStaticMarkup(createElement(KeyboardShortcuts, {
      mode: 'palette',
      onModeChange: () => {},
      activeTab: 'screen',
      canCreateNote: true,
      onNavigate: () => {},
      onCreateNote: () => {},
      onFocusSearch: () => {},
    }));
    expect(html).toContain('data-command-id="toggle-screen-sidebar"');
    expect(html).toContain('<kbd>[</kbd>');
  });

  it('renders toggle-screen-sidebar disabled when on other tab', () => {
    const html = renderToStaticMarkup(createElement(KeyboardShortcuts, {
      mode: 'palette',
      onModeChange: () => {},
      activeTab: 'notes',
      canCreateNote: true,
      onNavigate: () => {},
      onCreateNote: () => {},
      onFocusSearch: () => {},
    }));
    expect(html).toContain('data-command-id="toggle-screen-sidebar"');
    expect(html).toContain('aria-disabled="true"');
  });
});
