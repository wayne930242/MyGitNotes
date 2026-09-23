// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
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

const baseProps = { showHidden: false, descendants: false, hiddenNoteCount: 0, onShowHiddenChange: () => {}, onDescendantsChange: () => {}, sortField: 'updated' as const, sortOrder: 'desc' as const, onSortChange: () => {}, readOnly: false, viewMode: 'flat' as const, setViewMode: () => {}, onOpenNewNoteModal: () => {}, filtersOpen: false, onToggleFilters: () => {} };

it('labels the notebook-panel toggle and view switcher in Traditional Chinese under the zh-TW locale', () => {
  render(createElement(I18nProvider, null, createElement(NoteToolbar, baseProps)));
  expect(screen.getByRole('button', { name: '筆記本與篩選' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '筆記檢視' })).toBeInTheDocument();
});
