import { Focus, LayoutGrid, ListChecks, PanelsTopLeft, PanelTopClose, PanelTopOpen, Pencil, Save, Scan } from 'lucide-react';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { I18nContextValue } from '../../lib/i18n/index.js';
import { GraphTool } from './GraphTool.js';

interface GraphSelectionToolbarProps {
  t: I18nContextValue['t'];
  boxMode: boolean;
  onToggleBoxMode: () => void;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  visibleSelected: string[];
  onExpand: (paths: string[], value: boolean) => void;
  only: string[] | null;
  onOnly: (value: string[] | null) => void;
  saveNotebook: string | undefined;
  screenWritable: boolean | undefined;
  onSaveLane: () => void;
  onArrange: () => void;
  lanePanel: boolean;
  onToggleLanePanel: () => void;
  activeLane: ScreenRow | undefined;
  onEditLane: () => void;
}

/** The selection/arrange/save toolbar shown above the canvas when the graph is not scoped to a single lane. */
export function GraphSelectionToolbar({ t, boxMode, onToggleBoxMode, pickerOpen, onTogglePicker, visibleSelected, onExpand, only, onOnly, saveNotebook, screenWritable, onSaveLane, onArrange, lanePanel, onToggleLanePanel, activeLane, onEditLane }: GraphSelectionToolbarProps) {
  return (
    <div className='graph-selection-toolbar' role='toolbar' aria-label={t('graph.tools')}>
      <GraphTool label={t('graph.boxSelect')} pressed={boxMode} onClick={onToggleBoxMode}>
        <Scan size={18} />
      </GraphTool>
      <GraphTool label={`${t('graph.selectNotes')} (${visibleSelected.length})`} pressed={pickerOpen} onClick={onTogglePicker}>
        <ListChecks size={18} />
        <small>{visibleSelected.length || ''}</small>
      </GraphTool>
      <GraphTool label={t('graph.expand')} disabled={!visibleSelected.length} onClick={() => onExpand(visibleSelected, true)}>
        <PanelTopOpen size={18} />
      </GraphTool>
      <GraphTool label={t('graph.collapse')} disabled={!visibleSelected.length} onClick={() => onExpand(visibleSelected, false)}>
        <PanelTopClose size={18} />
      </GraphTool>
      <GraphTool label={t(only ? 'graph.showAll' : 'graph.onlySelected')} pressed={Boolean(only)} disabled={!visibleSelected.length && !only} onClick={() => onOnly(only ? null : visibleSelected)}>
        <Focus size={18} />
      </GraphTool>
      <GraphTool label={t('graph.saveLane')} disabled={!saveNotebook || !screenWritable} onClick={onSaveLane}>
        <Save size={18} />
      </GraphTool>
      <GraphTool label={t('graph.arrange')} onClick={onArrange}>
        <LayoutGrid size={18} />
      </GraphTool>
      <GraphTool label={t('graph.chooseLane')} pressed={lanePanel || Boolean(activeLane)} onClick={onToggleLanePanel}>
        <PanelsTopLeft size={18} />
      </GraphTool>
      {activeLane && (
        <GraphTool label={t('screen.editRow')} disabled={!screenWritable} onClick={onEditLane}>
          <Pencil size={18} />
        </GraphTool>
      )}
    </div>
  );
}
