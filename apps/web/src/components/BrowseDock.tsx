import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, type PanelSize } from 'react-resizable-panels';
import { PanelLeftClose, PanelLeftOpen, PanelBottomClose, PanelBottomOpen } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import './browse-dock.css';

export type BrowseDockPlacement = 'left' | 'bottom';

export interface BrowseDockProps {
  placement: BrowseDockPlacement;
  /** Left dock width or bottom dock height, in px. */
  size: number;
  onSizeChange: (size: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
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
const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_RATIO = 0.7;

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

export function BrowseDock({
  placement,
  size,
  onSizeChange,
  collapsed,
  onCollapsedChange,
  narrow,
  narrowView,
  browse,
  children,
}: BrowseDockProps): JSX.Element {
  const { t } = useTranslation();
  const [scrollRef, height] = useMeasuredHeight();
  const browseContent = typeof browse === 'function' ? browse(height) : browse;
  // Reported continuously while dragging; onSizeChange only fires once the drag settles.
  const lastResizePx = useRef(size);

  if (narrow) {
    return (
      <div className="browse-dock" data-placement={placement} data-narrow="true">
        {narrowView === 'browse' ? (
          <div ref={scrollRef} className="workspace-scroll browse-dock-scroll">{browseContent}</div>
        ) : (
          <div className="browse-dock-focus">{children}</div>
        )}
      </div>
    );
  }

  if (collapsed) {
    const ExpandIcon = placement === 'left' ? PanelLeftOpen : PanelBottomOpen;
    return (
      <div className="browse-dock" data-placement={placement} data-collapsed="true">
        <button
          type="button"
          className="ui-icon-button browse-dock-expand"
          aria-label={t('focus.expandBrowse')}
          title={t('focus.expandBrowse')}
          onClick={() => onCollapsedChange(false)}
        >
          <ExpandIcon size={16} />
        </button>
        <div className="browse-dock-focus">{children}</div>
      </div>
    );
  }

  const orientation = placement === 'left' ? 'horizontal' : 'vertical';
  const minSize = placement === 'left' ? MIN_LEFT_WIDTH : MIN_BOTTOM_HEIGHT;
  const maxRatio = placement === 'left' ? MAX_LEFT_RATIO : MAX_BOTTOM_RATIO;
  const CollapseIcon = placement === 'left' ? PanelLeftClose : PanelBottomClose;
  // Stable per placement, so switching placement (left <-> bottom) remounts the Group cleanly.
  const groupId = `browse-dock-${placement}`;

  return (
    <div className="browse-dock" data-placement={placement}>
      <Group
        key={groupId}
        id={groupId}
        orientation={orientation}
        className="browse-dock-group"
        onLayoutChanged={(_layout, meta) => {
          if (meta.isUserInteraction) onSizeChange(lastResizePx.current);
        }}
      >
        <Panel
          id={`${groupId}-browse`}
          defaultSize={`${size}px`}
          minSize={`${minSize}px`}
          maxSize={`${Math.round(maxRatio * 100)}%`}
          groupResizeBehavior="preserve-pixel-size"
          onResize={(panelSize: PanelSize) => {
            if (panelSize?.inPixels) lastResizePx.current = Math.round(panelSize.inPixels);
          }}
          className="browse-dock-panel"
        >
          <div className="browse-dock-panel-content">
            <button
              type="button"
              className="ui-icon-button browse-dock-collapse"
              aria-label={t('focus.collapseBrowse')}
              title={t('focus.collapseBrowse')}
              onClick={() => onCollapsedChange(true)}
            >
              <CollapseIcon size={16} />
            </button>
            <div ref={scrollRef} className="workspace-scroll browse-dock-scroll">{browseContent}</div>
          </div>
        </Panel>
        <Separator className="workspace-splitter browse-dock-splitter" />
        <Panel
          id={`${groupId}-focus`}
          groupResizeBehavior="preserve-relative-size"
          className="browse-dock-focus-panel"
        >
          <div className="browse-dock-focus">{children}</div>
        </Panel>
      </Group>
    </div>
  );
}
