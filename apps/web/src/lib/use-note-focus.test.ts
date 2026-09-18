// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FocusError, emptyFocusPage, FOCUS_MAX_TABS, type FocusLayout } from '@mygitnotes/core/focus-page';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import { useNoteFocus } from './use-note-focus.js';
import { CURRENT_FOCUS } from './focus-view.js';
import type { FocusPageController } from './use-focus-page.js';

const SCOPE = 'use-note-focus-test', NOTEBOOK = 'life';
const storageKey = `github-notes:focus-view:${SCOPE}:${NOTEBOOK}`;

function fakeController(): FocusPageController {
  return {
    file: '.github-notes-focus.yaml', page: emptyFocusPage(), change: () => {}, save: async () => {},
    reload: async () => {}, refresh: async () => {}, loading: false, saving: false, dirty: false,
    error: '', writable: true, setError: () => {}, prepareCommit: () => { throw new Error('unused'); }, diff: '',
  };
}
const lane = (id: string): ScreenRow => ({ id, notebookId: NOTEBOOK, kind: 'custom', name: id, view: 'small', items: [] });

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => localStorage.clear());

describe('useNoteFocus place', () => {
  it('rejects with the FocusError instead of only resolving false when the Focus is already full', async () => {
    const lanes = Array.from({ length: FOCUS_MAX_TABS }, (_, index) => lane(`lane-${index}`));
    const layout: FocusLayout = { division: 'single', panes: [{ tabs: lanes.map(row => ({ kind: 'lane', id: row.id })) }] };
    localStorage.setItem(storageKey, JSON.stringify({ current: layout, entries: {}, last: null, dock: { left: 320, bottom: 280, collapsed: false } }));

    const { result } = renderHook(() => useNoteFocus({
      page: fakeController(), notebookId: NOTEBOOK, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, lanes, flushEditors: async () => true,
    }), { wrapper });
    await waitFor(() => expect(result.current.layout?.panes[0]?.tabs.length).toBe(FOCUS_MAX_TABS));

    const attempt = result.current.place(CURRENT_FOCUS, { kind: 'lane', id: 'lane-new' }, 0);
    await expect(attempt).rejects.toBeInstanceOf(FocusError);
    await expect(attempt.catch(caught => caught)).resolves.toMatchObject({ code: 'tab-limit' });
    // The rejection is the caller's only signal; the layout is unchanged.
    expect(result.current.layout?.panes[0]?.tabs.length).toBe(FOCUS_MAX_TABS);
  });

  it('still resolves true when the Focus has room', async () => {
    const { result } = renderHook(() => useNoteFocus({
      page: fakeController(), notebookId: NOTEBOOK, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, lanes: [lane('lane-a')], flushEditors: async () => true,
    }), { wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    await expect(result.current.place(CURRENT_FOCUS, { kind: 'lane', id: 'lane-a' }, 0)).resolves.toBe(true);
    await waitFor(() => expect(result.current.layout?.panes[0]?.tabs).toHaveLength(1));
  });
});
