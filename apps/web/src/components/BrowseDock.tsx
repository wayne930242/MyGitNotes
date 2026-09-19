import React, { type ReactNode, useEffect, useRef, useState } from 'react';
import { Group, Panel, type PanelSize, Separator } from 'react-resizable-panels';
import { PanelLeftClose, PanelTopClose } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import './browse-dock.css';

export type BrowseDockPlacement = 'left' | 'top';

export interface BrowseDockProps {
  placement: BrowseDockPlacement;
  /** Left dock width or top dock height, in px. */
  size: number;
  onSizeChange: (size: number) => void;
  collapsed: boolean;
  /** ≤767px: only one of browse region / Focus is shown, full screen. */
  narrow: boolean;
  narrowView: 'browse' | 'focus';
  /** The browse region content; BrowseDock wraps it in its own scroll container. */
  browse: ReactNode | ((height: number) => ReactNode);
  /** The Focus area. */
  children: ReactNode;
}

/**
 * Two rows of the browse-region card grid, used to decide when a docked CardView
 * should leave its single-row `strip` layout and go back to a grid. Derived from
 * CardView.tsx's card markup: p-5 padding (40px) + one-line title row (~28px) +
 * mb-2 (8px) + 3-line leading-relaxed excerpt (~58px) + mb-4 (16px) + footer
 * (pt-3 + content, ~36px) ≈ 190px per card, times two rows plus the grid's gap-4
 * (16px) row gap.
 */
export const CARD_TWO_ROW_HEIGHT = 396;

const MIN_LEFT_WIDTH = 220;
const MAX_LEFT_RATIO = 0.6;
const MIN_TOP_HEIGHT = 120;
const MAX_TOP_RATIO = 0.7;

/** Measures the content box of the returned element with a ResizeObserver. */
function useMeasuredHeight(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setHeight(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, height];
}

/** Collapses and reopens the browse region from the Notes toolbar's left end. */
export function BrowseDockToggle({ placement, collapsed, onCollapsedChange }: { placement: BrowseDockPlacement; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; }): JSX.Element {
  const { t } = useTranslation();
  // The browse region sits left of or above the Focus; browse-dock.css turns the icon's arrow as it collapses.
  const Icon = placement === 'left' ? PanelLeftClose : PanelTopClose;
  const label = t(collapsed ? 'focus.expandBrowse' : 'focus.collapseBrowse');
  return (
    <button type='button' className='ui-icon-button browse-dock-toggle' data-collapsed={collapsed || undefined} aria-label={label} title={label} onClick={() => onCollapsedChange(!collapsed)}>
      <Icon size={16} />
    </button>
  );
}

export function BrowseDock({ placement, size, onSizeChange, collapsed, narrow, narrowView, browse, children }: BrowseDockProps): JSX.Element {
  const [scrollRef, height] = useMeasuredHeight();
  const browseContent = typeof browse === 'function' ? browse(height) : browse;
  // Reported continuously while dragging; onSizeChange only fires once the drag settles.
  const lastResizePx = useRef(size);

  if (narrow) {
    return <div className='browse-dock' data-placement={placement} data-narrow='true'>{narrowView === 'browse' ? <div ref={scrollRef} className='workspace-scroll browse-dock-scroll'>{browseContent}</div> : <div className='browse-dock-focus'>{children}</div>}</div>;
  }

  if (collapsed) {
    return (
      <div className='browse-dock' data-placement={placement} data-collapsed='true'>
        <div className='browse-dock-focus'>{children}</div>
      </div>
    );
  }

  const orientation = placement === 'left' ? 'horizontal' : 'vertical';
  const minSize = placement === 'left' ? MIN_LEFT_WIDTH : MIN_TOP_HEIGHT;
  const maxRatio = placement === 'left' ? MAX_LEFT_RATIO : MAX_TOP_RATIO;
  // Stable per placement, so switching placement (left <-> top) remounts the Group cleanly.
  const groupId = `browse-dock-${placement}`;

  return (
    <div className='browse-dock' data-placement={placement}>
      <Group
        key={groupId}
        id={groupId}
        orientation={orientation}
        className='browse-dock-group'
        onLayoutChanged={(_layout, meta) => {
          if (meta.isUserInteraction) onSizeChange(lastResizePx.current);
        }}
      >
        <Panel
          id={`${groupId}-browse`}
          defaultSize={`${size}px`}
          minSize={`${minSize}px`}
          maxSize={`${Math.round(maxRatio * 100)}%`}
          groupResizeBehavior='preserve-pixel-size'
          onResize={(panelSize: PanelSize) => {
            if (panelSize?.inPixels) lastResizePx.current = Math.round(panelSize.inPixels);
          }}
          className='browse-dock-panel'
        >
          <div className='browse-dock-panel-content'>
            <div ref={scrollRef} className='workspace-scroll browse-dock-scroll'>{browseContent}</div>
          </div>
        </Panel>
        <Separator className='workspace-splitter browse-dock-splitter' />
        <Panel id={`${groupId}-focus`} groupResizeBehavior='preserve-relative-size' className='browse-dock-focus-panel'>
          <div className='browse-dock-focus'>{children}</div>
        </Panel>
      </Group>
    </div>
  );
}
