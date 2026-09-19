// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyFocusPage, FOCUS_MAX_TABS, FocusError, type FocusLayout } from '@mygitnotes/core/focus-page';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import { useNoteFocus } from './use-note-focus.js';
import { CURRENT_FOCUS } from './focus-view.js';
import type { FocusPageController } from './use-focus-page.js';

const SCOPE = 'use-note-focus-test', NOTEBOOK = 'life';
const storageKey = `github-notes:focus-view:${SCOPE}:${NOTEBOOK}`;

function fakeController(): FocusPageController {
  return {
    file: '.github-notes-focus.yaml',
    page: emptyFocusPage(),
    change: () => {},
    save: async () => {},
    reload: async () => {},
    refresh: async () => {},
    loading: false,
    saving: false,
    dirty: false,
    error: '',
    writable: true,
    setError: () => {},
    prepareCommit: () => {
      throw new Error('unused');
    },
    diff: '',
  };
}
const lane = (id: string): ScreenRow => ({ id, notebookId: NOTEBOOK, kind: 'custom', name: id, view: 'small', items: [] });

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode; }) => createElement(QueryClientProvider, { client }, children);

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

    const { result } = renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, lanes, flushEditors: async () => true }), { wrapper });
    await waitFor(() => expect(result.current.layout?.panes[0]?.tabs.length).toBe(FOCUS_MAX_TABS));

    const attempt = result.current.place(CURRENT_FOCUS, { kind: 'lane', id: 'lane-new' }, 0);
    await expect(attempt).rejects.toBeInstanceOf(FocusError);
    await expect(attempt.catch(caught => caught)).resolves.toMatchObject({ code: 'tab-limit' });
    // The rejection is the caller's only signal; the layout is unchanged.
    expect(result.current.layout?.panes[0]?.tabs.length).toBe(FOCUS_MAX_TABS);
  });

  it('still resolves true when the Focus has room', async () => {
    const { result } = renderHook(() => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, scope: SCOPE, focusKey: CURRENT_FOCUS, writable: true, lanes: [lane('lane-a')], flushEditors: async () => true }), { wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    await expect(result.current.place(CURRENT_FOCUS, { kind: 'lane', id: 'lane-a' }, 0)).resolves.toBe(true);
    await waitFor(() => expect(result.current.layout?.panes[0]?.tabs).toHaveLength(1));
  });
});

describe('useNoteFocus mutationError', () => {
  const fullLayout = (count: number): FocusLayout => ({ division: 'single', panes: [{ tabs: Array.from({ length: count }, (_, index) => ({ kind: 'lane', id: `lane-${index}` })) }] });
  const lanesFor = (count: number) => Array.from({ length: count }, (_, index) => lane(`lane-${index}`));

  it('records a failed change, and clears it on dismiss and when another Focus is shown', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ current: fullLayout(FOCUS_MAX_TABS), entries: {}, last: null }));
    const lanes = lanesFor(FOCUS_MAX_TABS + 1);
    const { result, rerender } = renderHook(({ focusKey }: { focusKey: string | null; }) => useNoteFocus({ page: fakeController(), notebookId: NOTEBOOK, scope: SCOPE, focusKey, writable: true, lanes, flushEditors: async () => true }), { wrapper, initialProps: { focusKey: CURRENT_FOCUS as string | null } });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    const fail = () => result.current.place(CURRENT_FOCUS, { kind: 'lane', id: `lane-${FOCUS_MAX_TABS}` }, 0).catch(() => {});
    await act(fail);
    expect(result.current.mutationError).toMatchObject({ code: 'tab-limit' });
    act(() => result.current.dismissMutationError());
    expect(result.current.mutationError).toBeNull();

    await act(fail);
    expect(result.current.mutationError).not.toBeNull();
    rerender({ focusKey: null });
    await waitFor(() => expect(result.current.mutationError).toBeNull());
  });

  it('reports a note that no longer fits only as full, without a leftover error', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ current: fullLayout(FOCUS_MAX_TABS - 1), entries: {}, last: null }));
    const lanes = lanesFor(FOCUS_MAX_TABS);
    let raced = false;
    const { result } = renderHook(() =>
      useNoteFocus({
        page: fakeController(),
        notebookId: NOTEBOOK,
        scope: SCOPE,
        focusKey: CURRENT_FOCUS,
        writable: true,
        lanes,
        // While the editors flush, another tab takes the last free slot.
        flushEditors: async () => {
          if (!raced) {
            raced = true;
            await result.current.place(CURRENT_FOCUS, { kind: 'lane', id: `lane-${FOCUS_MAX_TABS - 1}` }, 0);
          }
          return true;
        },
      }), { wrapper });
    await waitFor(() => expect(result.current.layout).not.toBeNull());

    let opened: string | undefined;
    await act(async () => {
      opened = await result.current.openNote('notes/a.md');
    });
    expect(opened).toBe('full');
    expect(result.current.mutationError).toBeNull();
  });
});
