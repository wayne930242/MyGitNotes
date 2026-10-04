// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readSidebarSections, SIDEBAR_SECTIONS_KEY, useSidebarSections } from './sidebar-sections.js';

afterEach(() => localStorage.clear());

describe('sidebar sections', () => {
  it('opens every section when nothing is stored or the stored value is damaged', () => {
    expect(readSidebarSections()).toEqual({});
    for (const raw of ['not json', '[]', 'null', '{"status":"no","tags":1}']) {
      localStorage.setItem(SIDEBAR_SECTIONS_KEY, raw);
      expect(readSidebarSections()).toEqual({});
    }
    const { result } = renderHook(() => useSidebarSections());
    expect(['notebooks', 'status', 'tags'].map(section => result.current.isOpen(section as 'notebooks'))).toEqual([true, true, true]);
  });

  it('remembers a collapsed section in localStorage and restores it', () => {
    const { result, unmount } = renderHook(() => useSidebarSections());
    act(() => result.current.setOpen('status', false));
    expect(result.current.isOpen('status')).toBe(false);
    expect(result.current.isOpen('tags')).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY)!)).toEqual({ status: false });
    unmount();
    expect(renderHook(() => useSidebarSections()).result.current.isOpen('status')).toBe(false);
  });
});
