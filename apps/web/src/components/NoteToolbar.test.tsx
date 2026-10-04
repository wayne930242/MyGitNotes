// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { I18nProvider } from '../lib/i18n/index.js';
import { NoteToolbar } from './NoteToolbar.js';

beforeEach(() => {
  window.matchMedia = ((query: string) => ({ matches: !query.includes('max-width: 767px'), media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  const slot = document.createElement('span');
  slot.id = 'workspace-sidebar-toggle-slot';
  document.body.appendChild(slot);
  window.localStorage.setItem('github-notes:language', 'zh-TW');
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

const baseProps = { showHidden: false, descendants: false, hiddenNoteCount: 0, onShowHiddenChange: () => {}, onDescendantsChange: () => {}, sortField: 'updated' as const, sortOrder: 'desc' as const, onSortChange: () => {}, readOnly: false, viewMode: 'flat' as const, setViewMode: () => {}, onOpenNewNoteModal: () => {}, onOpenNewCompilation: () => {}, query: '', onQueryChange: () => {}, filtersOpen: false, onToggleFilters: () => {} };

it('labels the notebook-panel toggle and view switcher in Traditional Chinese under the zh-TW locale', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, baseProps)));
  expect(screen.getByRole('button', { name: '筆記本與篩選' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '筆記檢視' })).toBeInTheDocument();
});

it('offers native outline creation in the New menu and hides creation for read-only notebooks', async () => {
  const create = vi.fn();
  const view = render(
    <I18nProvider>
      <NoteToolbar {...baseProps} onOpenNewOutline={create} />
    </I18nProvider>,
  );
  const trigger = screen.getByRole('button', { name: '新增選單' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '新增大綱' }));
  expect(create).toHaveBeenCalledOnce();
  view.rerender(
    <I18nProvider>
      <NoteToolbar {...baseProps} readOnly onOpenNewOutline={create} />
    </I18nProvider>,
  );
  expect(screen.queryByRole('button', { name: '新增選單' })).not.toBeInTheDocument();
});

it('keeps import/export reachable from the native menu on read-only notebooks without retired Save view', async () => {
  const open = vi.fn();
  render(
    <I18nProvider>
      <NoteToolbar {...baseProps} readOnly onImportLegacy={open} />
    </I18nProvider>,
  );
  const menu = screen.getByRole('button', { name: '新增選單' });
  menu.focus();
  fireEvent.keyDown(menu, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: '匯入舊書籤' }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByText('保存目前檢視')).toBeNull();
  expect(screen.queryByRole('button', { name: '新增筆記' })).toBeNull();
});

it('puts the note search in the toolbar and reports each keystroke as the query', () => {
  const changes: string[] = [];
  render(createElement(I18nProvider, null, createElement(NoteToolbar, { ...baseProps, query: 'dragon', onQueryChange: value => changes.push(value) })));
  const field = screen.getByRole('searchbox', { name: '搜尋筆記、標籤、內文...' });
  expect(field).toHaveValue('dragon');
  fireEvent.change(field, { target: { value: 'dragons' } });
  expect(changes).toEqual(['dragons']);
});

it('keeps the field behind a button on phones: the button opens it over the toolbar and close hides it', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, baseProps)));
  const toggle = screen.getByRole('button', { name: '搜尋筆記、標籤、內文...' });
  const search = document.getElementById('note-toolbar-search')!;
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(search).not.toHaveAttribute('data-open');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(search).toHaveAttribute('data-open');
  fireEvent.click(screen.getByRole('button', { name: '關閉' }));
  expect(search).not.toHaveAttribute('data-open');
});
