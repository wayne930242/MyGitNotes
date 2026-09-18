// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  SidebarProvider,
  WorkspaceSidebarPortal,
  WorkspaceSplitLayout,
  useWorkspaceSidebarDrawer,
  getSavedSidebarWidth,
  saveSidebarWidth,
  getSavedRightPanelWidth,
  saveRightPanelWidth,
  persistWidthOnUserInteraction,
  scheduleRightPanelResize,
  RIGHT_PANEL_RAIL_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  RIGHT_PANEL_WIDTH_STORAGE_KEY,
  MIN_RIGHT_PANEL_WIDTH,
  MAX_RIGHT_PANEL_WIDTH,
} from './WorkspaceChrome.js';

afterEach(cleanup);

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe('Sidebar width persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default width (256) when localStorage is empty', () => {
    expect(getSavedSidebarWidth()).toBe(256);
  });

  it('reads valid persisted width from localStorage', () => {
    localStorage.setItem('mygitnotes:sidebar-width', '320');
    expect(getSavedSidebarWidth()).toBe(320);
  });

  it('clamps width within minimum (180) and maximum (500)', () => {
    localStorage.setItem('mygitnotes:sidebar-width', '100');
    expect(getSavedSidebarWidth()).toBe(180);

    localStorage.setItem('mygitnotes:sidebar-width', '800');
    expect(getSavedSidebarWidth()).toBe(500);
  });

  it('returns default width when stored value is invalid', () => {
    localStorage.setItem('mygitnotes:sidebar-width', 'invalid');
    expect(getSavedSidebarWidth()).toBe(256);
  });

  it('saves clamped width to localStorage', () => {
    saveSidebarWidth(350);
    expect(localStorage.getItem('mygitnotes:sidebar-width')).toBe('350');

    saveSidebarWidth(50);
    expect(localStorage.getItem('mygitnotes:sidebar-width')).toBe('180');

    saveSidebarWidth(999);
    expect(localStorage.getItem('mygitnotes:sidebar-width')).toBe('500');
  });
});

describe('Right panel width persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default width (320) when localStorage is empty', () => {
    expect(getSavedRightPanelWidth()).toBe(320);
  });

  it('reads valid persisted width from localStorage', () => {
    localStorage.setItem('mygitnotes:right-panel-width', '400');
    expect(getSavedRightPanelWidth()).toBe(400);
  });

  it('clamps width within minimum (260) and maximum (480)', () => {
    localStorage.setItem('mygitnotes:right-panel-width', '100');
    expect(getSavedRightPanelWidth()).toBe(260);

    localStorage.setItem('mygitnotes:right-panel-width', '800');
    expect(getSavedRightPanelWidth()).toBe(480);
  });

  it('returns default width when stored value is invalid', () => {
    localStorage.setItem('mygitnotes:right-panel-width', 'invalid');
    expect(getSavedRightPanelWidth()).toBe(320);
  });

  it('saves clamped width to localStorage', () => {
    saveRightPanelWidth(350);
    expect(localStorage.getItem('mygitnotes:right-panel-width')).toBe('350');

    saveRightPanelWidth(50);
    expect(localStorage.getItem('mygitnotes:right-panel-width')).toBe('260');

    saveRightPanelWidth(999);
    expect(localStorage.getItem('mygitnotes:right-panel-width')).toBe('480');
  });
});

describe('persistWidthOnUserInteraction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function fakePanelRef(inPixels: number) {
    return {
      current: {
        getSize: () => ({ inPixels, asPercentage: 0 }),
        collapse: () => {},
        expand: () => {},
        isCollapsed: () => false,
        resize: () => {},
      },
    };
  }

  it('does not persist a layout change that was not caused by direct user interaction', () => {
    persistWidthOnUserInteraction({ isUserInteraction: false }, fakePanelRef(300), 0, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, saveSidebarWidth);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
  });

  it('persists a layout change caused by direct user interaction', () => {
    persistWidthOnUserInteraction({ isUserInteraction: true }, fakePanelRef(300), 0, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, saveSidebarWidth);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe('300');
  });

  it('subtracts the rail offset before clamping and persisting a right-panel width', () => {
    persistWidthOnUserInteraction(
      { isUserInteraction: true },
      fakePanelRef(RIGHT_PANEL_RAIL_WIDTH + 400),
      RIGHT_PANEL_RAIL_WIDTH,
      MIN_RIGHT_PANEL_WIDTH,
      MAX_RIGHT_PANEL_WIDTH,
      saveRightPanelWidth
    );
    expect(localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY)).toBe('400');
  });
});

describe('scheduleRightPanelResize', () => {
  // react-resizable-panels registers a Panel's updated minSize/maxSize constraints
  // asynchronously after the render that changes them. Calling resize() synchronously,
  // in the same commit as the constraint change (e.g. reopening the panel right after it
  // was collapsed to the rail), can still see the *previous* constraints and clamp the
  // target size down to their minimum — reproduced live: reopening a panel persisted at a
  // non-default width snapped to MIN_RIGHT_PANEL_WIDTH instead. Deferring the call by a
  // frame lets those constraints land first.
  it('does not call resize synchronously', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const resize = vi.fn();

    scheduleRightPanelResize(379, resize);

    expect(resize).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('calls resize with the target width once the deferred frame runs', () => {
    let rafCallback: FrameRequestCallback | undefined;
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 1;
    });
    const resize = vi.fn();

    scheduleRightPanelResize(379, resize);
    rafCallback?.(0);

    expect(resize).toHaveBeenCalledWith(379);
    rafSpy.mockRestore();
  });

  it('cancels the pending frame when the returned cleanup runs', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const resize = vi.fn();

    const cancel = scheduleRightPanelResize(379, resize);
    cancel();

    expect(cafSpy).toHaveBeenCalledWith(42);
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });
});

describe('SidebarProvider and useWorkspaceSidebarDrawer', () => {
  function TestConsumer() {
    const { open, setOpen } = useWorkspaceSidebarDrawer();
    return (
      <div>
        <span data-testid="drawer-status">{open ? 'open' : 'closed'}</span>
        <button onClick={() => setOpen(true)}>Open</button>
        <button onClick={() => setOpen(false)}>Close</button>
        <button onClick={() => setOpen((prev) => !prev)}>Toggle</button>
      </div>
    );
  }

  it('provides open state and controls', () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );

    expect(screen.getByTestId('drawer-status')).toHaveTextContent('closed');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('drawer-status')).toHaveTextContent('open');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByTestId('drawer-status')).toHaveTextContent('closed');
  });

  it('closes on Escape key when open', () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('drawer-status')).toHaveTextContent('open');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('drawer-status')).toHaveTextContent('closed');
  });
});

describe('WorkspaceSplitLayout and WorkspaceSidebarPortal', () => {
  beforeEach(() => {
    // Mock matchMedia for desktop (min-width: 768px matches true)
    window.matchMedia = ((query: string) => ({
      matches: !query.includes('max-width: 767px'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('renders only main content when hasSidebar is false', () => {
    const { container } = render(
      <SidebarProvider>
        <WorkspaceSplitLayout hasSidebar={false}>
          <div data-testid="main-content">Main Page Content</div>
        </WorkspaceSplitLayout>
      </SidebarProvider>
    );

    expect(screen.getByTestId('main-content')).toBeInTheDocument();
    expect(container.querySelector('.workspace-splitter')).toBeNull();
    expect(container.querySelector('.workspace-split-sidebar-panel')).toBeNull();
  });

  it('renders split layout with splitter and portaled sidebar when hasSidebar is true', () => {
    const { container } = render(
      <SidebarProvider>
        <WorkspaceSplitLayout hasSidebar={true} sidebarDomId="custom-sidebar-panel">
          <WorkspaceSidebarPortal>
            <div data-testid="sidebar-content">Navigation Tree</div>
          </WorkspaceSidebarPortal>
          <div data-testid="main-content">Main Notes Content</div>
        </WorkspaceSplitLayout>
      </SidebarProvider>
    );

    expect(screen.getByTestId('main-content')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-content')).toBeInTheDocument();
    expect(container.querySelector('#custom-sidebar-panel')).toBeInTheDocument();
    expect(container.querySelector('.workspace-splitter')).toBeInTheDocument();
  });

  it('does not render a right panel splitter when rightPanel is omitted', () => {
    const { container } = render(
      <SidebarProvider>
        <WorkspaceSplitLayout hasSidebar={false}>
          <div data-testid="main-content">Main Page Content</div>
        </WorkspaceSplitLayout>
      </SidebarProvider>
    );

    expect(container.querySelector('.workspace-split-right-panel')).toBeNull();
    expect(container.querySelector('.workspace-splitter')).toBeNull();
  });

  it('keeps the right panel mounted but visually collapsed while rightPanelWidth is 0 (hidden)', () => {
    const { container } = render(
      <SidebarProvider>
        <WorkspaceSplitLayout hasSidebar={false} rightPanelWidth={0} rightPanel={<div data-testid="right-content">Right</div>}>
          <div data-testid="main-content">Main Page Content</div>
        </WorkspaceSplitLayout>
      </SidebarProvider>
    );

    // Mounted (not unmounted) so it can keep reporting its own width via onWidthChange —
    // an unmounted RightPanel could never report a width again and would stay hidden forever.
    expect(screen.getByTestId('right-content')).toBeInTheDocument();
    expect(container.querySelector('.workspace-split-right-panel')).toBeInTheDocument();
    expect(container.querySelector('.workspace-splitter.workspace-splitter-hidden')).toBeInTheDocument();
  });

  it('renders the right panel inside a resizable splitter panel when rightPanelWidth > 0', () => {
    const { container } = render(
      <SidebarProvider>
        <WorkspaceSplitLayout hasSidebar={false} rightPanelWidth={RIGHT_PANEL_RAIL_WIDTH + 320} rightPanel={<div data-testid="right-content">Right</div>}>
          <div data-testid="main-content">Main Page Content</div>
        </WorkspaceSplitLayout>
      </SidebarProvider>
    );

    expect(screen.getByTestId('right-content')).toBeInTheDocument();
    expect(container.querySelector('.workspace-split-right-panel')).toBeInTheDocument();
    expect(container.querySelector('.workspace-splitter')).toBeInTheDocument();
  });

  it('renders the right panel as a plain sibling (no Group) below the desktop breakpoint', () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const { container } = render(
      <SidebarProvider>
        <WorkspaceSplitLayout hasSidebar={false} rightPanelWidth={RIGHT_PANEL_RAIL_WIDTH + 320} rightPanel={<div data-testid="right-content">Right</div>}>
          <div data-testid="main-content">Main Page Content</div>
        </WorkspaceSplitLayout>
      </SidebarProvider>
    );

    expect(screen.getByTestId('right-content')).toBeInTheDocument();
    expect(container.querySelector('.workspace-split-right-panel')).toBeNull();
    expect(container.querySelector('.workspace-splitter')).toBeNull();
  });
});
