import { useCallback, useState } from 'react';

export const SIDEBAR_SECTIONS_KEY = 'mgn:sidebar-sections';
export type SidebarSection = 'notebooks' | 'status' | 'tags';

/** Which sections the user collapsed; a section absent from storage is open. A damaged value reads as all open. */
export function readSidebarSections(storage: Pick<Storage, 'getItem'> = localStorage): Partial<Record<SidebarSection, boolean>> {
  try {
    const value = JSON.parse(storage.getItem(SIDEBAR_SECTIONS_KEY) ?? '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const open: Partial<Record<SidebarSection, boolean>> = {};
    for (const section of ['notebooks', 'status', 'tags'] as const) if (typeof value[section] === 'boolean') open[section] = value[section];
    return open;
  } catch {
    return {};
  }
}

/** The open state of the left pane's sections, kept in `localStorage` for this browser. */
export function useSidebarSections() {
  const [open, setOpenState] = useState(() => readSidebarSections());
  const isOpen = (section: SidebarSection) => open[section] ?? true;
  const setOpen = useCallback((section: SidebarSection, value: boolean) => {
    setOpenState(previous => {
      const next = { ...previous, [section]: value };
      try {
        localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(next));
      } catch { /* A full or blocked storage only costs the remembered state. */ }
      return next;
    });
  }, []);
  return { isOpen, setOpen };
}
