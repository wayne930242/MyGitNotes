// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceSidebarDrawer } from './WorkspaceChrome.js';

const context = vi.hoisted(() => ({ value: null as null | { open: boolean; setOpen: () => void; } }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(), useContext: () => context.value }));
afterEach(() => {
  cleanup();
  context.value = null;
});

it('keeps later hook state stable when a sidebar context becomes available', () => {
  const view = renderHook(() => {
    const drawer = useWorkspaceSidebarDrawer();
    const [sentinel] = useState('stable');
    return { drawer, sentinel };
  });
  context.value = { open: true, setOpen: vi.fn() };
  view.rerender();
  expect(view.result.current.drawer.open).toBe(true);
  expect(view.result.current.sentinel).toBe('stable');
});
