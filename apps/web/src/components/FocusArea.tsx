import './focus.css';
import React, { useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { FocusDivision } from '@mygitnotes/core/focus-page';
import { displayedPanes, type DisplayedPane } from '../lib/focus-view.js';
import { useIsDesktop } from './WorkspaceChrome.js';
import { FocusPane, type FocusPaneContext } from './FocusPane.js';

/** A division as nested splits: a leaf is a displayed pane's position, a split lays its children out along one axis. */
type Split = number | { orientation: 'horizontal' | 'vertical'; children: Split[] };
const row = (...children: Split[]): Split => ({ orientation: 'horizontal', children });
const column = (...children: Split[]): Split => ({ orientation: 'vertical', children });
const SPLITS: Record<FocusDivision, Split> = {
  single: 0,
  'columns-2': row(0, 1),
  'rows-2': column(0, 1),
  'major-left': row(0, column(1, 2)),
  'major-top': column(0, row(1, 2)),
  'columns-3': row(0, 1, 2),
  'grid-2x2': column(row(0, 1), row(2, 3)),
};

/** How many panes fit: four on desktop, two on tablets, one on phones. */
export function usePaneCapacity(): 1 | 2 | 4 {
  const desktop = useIsDesktop();
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setPhone(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return desktop ? 4 : phone ? 1 : 2;
}

/** The displayed Focus: its panes laid out by division, with draggable splits whose ratios are kept per Focus. */
export const FocusArea: React.FC<FocusPaneContext & { capacity: 1 | 2 | 4 }> = ({ capacity, ...context }) => {
  const { focus } = context;
  if (!focus.layout || !focus.entry) return null;
  const display = displayedPanes(focus.entry, focus.layout, capacity);
  const ratios = focus.entry.ratios;

  const render = (split: Split, id: string): React.ReactNode => {
    if (typeof split === 'number') return <FocusPane {...context} displayed={display.panes[split] as DisplayedPane} />;
    const panelId = (index: number) => `${id}.${index}`;
    const stored = ratios[id];
    const defaultLayout = stored?.length === split.children.length
      ? Object.fromEntries(split.children.map((_, index) => [panelId(index), stored[index]])) : undefined;
    return (
      <Group key={id} id={id} orientation={split.orientation} className="focus-split" defaultLayout={defaultLayout}
        onLayoutChanged={(layout, meta) => {
          if (meta.isUserInteraction) focus.setRatios(id, split.children.map((_, index) => layout[panelId(index)]));
        }}>
        {split.children.flatMap((child, index) => [
          ...(index > 0 ? [<Separator key={`separator-${index}`} className="focus-splitter" data-axis={split.orientation} />] : []),
          <Panel key={panelId(index)} id={panelId(index)} minSize="10%" className="focus-split-panel">{render(child, panelId(index))}</Panel>,
        ])}
      </Group>
    );
  };

  return <div className="focus-area" data-division={display.division}>{render(SPLITS[display.division], display.division)}</div>;
};
