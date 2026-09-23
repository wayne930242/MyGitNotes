// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Network } from 'lucide-react';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { NotebookConfig } from '../lib/types.js';
import { createLaneNoteContext, screenViewTabs } from './ScreenPage.js';
import { KeyboardShortcuts } from './KeyboardShortcuts.js';

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => cleanup());

const queryClientWrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

describe('createLaneNoteContext', () => {
  const notebooks: NotebookConfig[] = [{ id: 'nb-1', title: 'Main Notebook', root: 'notes/main' }, { id: 'nb-2', title: 'Second Notebook', root: 'notes/secondary' }];

  it('extracts tag context for tag dynamic lanes with notebookId', () => {
    const row: ScreenRow = { id: 'r1', name: 'Clues', view: 'small', notebookId: 'nb-1', kind: 'dynamic', source: { kind: 'tag', tag: 'clue', notebookId: 'nb-1' } };
    expect(createLaneNoteContext(row, notebooks)).toEqual({ tag: 'clue', notebookId: 'nb-1' });
  });

  it('extracts relative folder context for nested folder dynamic lanes', () => {
    const row: ScreenRow = { id: 'r3', name: 'Deep Folder', view: 'medium', notebookId: 'nb-1', kind: 'dynamic', source: { kind: 'folder', notebookId: 'nb-1', path: 'notes/main/campaign/sessions', recursive: true } };
    expect(createLaneNoteContext(row, notebooks)).toEqual({ notebookId: 'nb-1', folder: 'campaign/sessions' });
  });

  it('extracts empty string folder context when folder is at notebook root', () => {
    const row: ScreenRow = { id: 'r4', name: 'Root Folder', view: 'thumbnail', notebookId: 'nb-2', kind: 'dynamic', source: { kind: 'folder', notebookId: 'nb-2', path: 'notes/secondary', recursive: false } };
    expect(createLaneNoteContext(row, notebooks)).toEqual({ notebookId: 'nb-2', folder: '' });
  });

  it('returns null for custom lanes', () => {
    const row: ScreenRow = { id: 'r5', name: 'Pinned', view: 'small', notebookId: 'nb-1', kind: 'custom', items: [] };
    expect(createLaneNoteContext(row, notebooks)).toBeNull();
  });
});

describe('Screen view icons', () => {
  it('uses the same network icon for a lane graph as the main Graph navigation', () => {
    expect(screenViewTabs.find(item => item.value === 'graph')?.icon).toBe(Network);
  });
});

describe('Screen sidebar keyboard shortcuts', () => {
  const props = { onModeChange: () => {}, activeTab: 'screen' as const, canCreateNote: true, selectedNotebookId: 'nb-1', onNavigate: () => {}, onCreateNote: () => {}, onFocusSearch: () => {}, onOpenNote: () => {} };

  it('keeps the Screen action keyless in the palette and shows its real shortcut in help', async () => {
    // A leading '>' reaches the unchanged command list; the id contains "screen" so the filter finds it without typing its full label.
    const { container: paletteContainer } = render(createElement(KeyboardShortcuts, { ...props, mode: 'palette' }), { wrapper: queryClientWrapper });
    fireEvent.change(paletteContainer.querySelector('input')!, { target: { value: '>screen' } });
    await waitFor(() => expect(paletteContainer.innerHTML).toContain('data-command-id="toggle-screen-sidebar"'));
    expect(paletteContainer.innerHTML).not.toContain('<kbd>[');

    const { container: helpContainer } = render(createElement(KeyboardShortcuts, { ...props, mode: 'help' }), { wrapper: queryClientWrapper });
    expect(helpContainer.innerHTML).toContain('data-command-id="toggle-screen-sidebar" data-shortcut-key="["');
    expect(helpContainer.innerHTML).toContain('<kbd>[</kbd>');
  });

  it('renders toggle-screen-sidebar disabled when on other tab', async () => {
    const { container } = render(createElement(KeyboardShortcuts, { ...props, mode: 'palette', activeTab: 'notes' }), { wrapper: queryClientWrapper });
    fireEvent.change(container.querySelector('input')!, { target: { value: '>screen' } });
    await waitFor(() => expect(container.innerHTML).toContain('data-command-id="toggle-screen-sidebar"'));
    expect(container.innerHTML).toContain('aria-disabled="true"');
    expect(container.innerHTML).toContain('Open Screen to use');
  });
});
