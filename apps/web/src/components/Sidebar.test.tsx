// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { NoteFilters } from '@mygitnotes/core/note-filters';
import type { NotebookFacets } from '@mygitnotes/core/note-query';
import type { FilterControls } from '../lib/filter-controls.js';
import { SIDEBAR_SECTIONS_KEY } from '../lib/sidebar-sections.js';
import { I18nProvider } from '../lib/i18n/index.js';
import { Sidebar } from './Sidebar.js';

const kind = { total: 0, statuses: {}, tags: {} };
const facets: Record<string, NotebookFacets> = { life: { total: 7, hidden: 0, statuses: { todo: 3, done: 4 }, tags: { work: 2 }, directories: {}, compilations: { total: 3, statuses: {}, tags: {} } }, work: { total: 1, hidden: 0, statuses: {}, tags: {}, directories: {}, compilations: kind } };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('github-notes:language', 'en');
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function controls(value: Partial<NoteFilters> = {}, onChange: FilterControls['onChange'] = () => {}): FilterControls {
  return {
    value: { kind: 'note', notebookId: 'life', folders: [], descendants: true, tags: [], tagMode: 'any', q: '', status: null, showHidden: false, ...value },
    neighbors: false,
    notebooks: [{ id: 'life', title: 'Life', root: 'notes/life', statuses: ['todo', 'done'] }, { id: 'work', title: 'Work', root: 'notes/work' }],
    folders: [],
    tags: ['work'],
    statuses: ['todo', 'done'],
    count: 7,
    onChange,
    allNotebooks: false,
    onAllNotebooksChange: () => {},
    onClear: () => {},
  };
}

const sidebar = (filters: FilterControls, onSelectFolder = vi.fn()) =>
  render(createElement(I18nProvider, null, createElement(Sidebar, { filters, facets, folders: [], selectedNotebookId: 'life', onManageFiles: () => {}, reorder: false, onToggleReorder: () => {}, onSelectFolder, workspaceTagNames: ['work'], changeCount: 0 })));

it('has three collapsible sections, Notebooks, Status and Tags, and no search field', () => {
  sidebar(controls());
  const summaries = [...document.querySelectorAll('details.sidebar-filter-section > summary')].map(summary => summary.textContent);
  expect(summaries).toEqual(['Notebooks', 'Status', 'Tags']);
  expect(screen.queryByRole('searchbox', { name: /search notes/i })).not.toBeInTheDocument();
});

it('remembers a collapsed section in localStorage for this browser', () => {
  const first = sidebar(controls());
  const status = [...document.querySelectorAll('details.sidebar-filter-section')][1] as HTMLDetailsElement;
  expect(status.open).toBe(true);
  status.open = false;
  fireEvent(status, new Event('toggle'));
  expect(JSON.parse(window.localStorage.getItem(SIDEBAR_SECTIONS_KEY)!)).toEqual({ status: false });
  first.unmount();
  sidebar(controls());
  const reopened = [...document.querySelectorAll('details.sidebar-filter-section')] as HTMLDetailsElement[];
  expect(reopened.map(section => section.open)).toEqual([true, false, true]);
});

it('gives each notebook a Compilations entry with its count that lists compilations', () => {
  const onChange = vi.fn();
  sidebar(controls({}, onChange));
  const entry = screen.getByRole('button', { name: /Compilations/ });
  expect(within(entry.closest('.nav-tree-row') as HTMLElement).getByText('3')).toBeInTheDocument();
  fireEvent.click(entry);
  expect(onChange).toHaveBeenCalledWith({ kind: 'compilation', folders: [] });
});

it('marks Compilations as the selected entry, not the notebook, while the list shows compilations', () => {
  sidebar(controls({ kind: 'compilation' }));
  const rows = [...document.querySelectorAll('.nav-tree-row')];
  expect(rows.filter(row => row.classList.contains('is-selected')).map(row => row.textContent)).toEqual([expect.stringContaining('Compilations')]);
});
