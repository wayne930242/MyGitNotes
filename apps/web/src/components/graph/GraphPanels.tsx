import { Maximize2 } from 'lucide-react';
import { GraphControls } from './GraphControls.js';
import { GraphFilters } from '../GraphFilters.js';
import { GraphLanePanel } from './GraphLanePanel.js';
import { GraphSelectionToolbar } from './GraphSelectionToolbar.js';
import { GraphTool } from './GraphTool.js';
import { ScreenEditRow } from '../ScreenDialogs.js';
import type { useGraphController } from './useGraphController.js';
export function GraphPanels({ model }: { model: ReturnType<typeof useGraphController>; }) {
  const { notebooks, filters, screen, lane, folders, t, params, setParams, laneIds, activeLane, showOutside, lanePanel, setLanePanel, editLane, setEditLane, rows, laneRows, selectLane, setSaveLayoutRequested, controls, selected, only, setOnly, showOrphans, setShowOrphans, boxMode, setBoxMode, setSaveOpen, setName, notice, setNotice, pickerOpen, setPickerOpen, appearance, appearanceError, matching, laneMembers, graphData, colors, changeAppearance, currentLayout, persistLayout, freeze, reflow, setExpanded, select, fitView, visibleSelected, changeMembership, openFullGraph, saveNotebook } = model;
  const filtersElement = filters
    ? (
      <GraphFilters {...filters} count={matching.length} showOrphans={showOrphans} onToggleOrphans={() => setShowOrphans(v => !v)} extraCount={laneIds.length}>
        <fieldset>
          <legend>{t('graph.lanes')}</legend>
          {[...new Set([...laneRows.map(row => row.id), ...laneIds])].map(id => (
            <label className='filter-check' key={id}>
              <input
                type='checkbox'
                checked={laneIds.includes(id)}
                onChange={() => {
                  const next = new URLSearchParams(params);
                  next.delete('lanes');
                  (laneIds.includes(id)
                    ? laneIds.filter(v => v !== id)
                    : [...laneIds, id]).forEach(value => next.append('lanes', value));
                  setParams(next);
                }}
              />
              {rows.find(row => row.id === id)?.name || t('screen.laneMissing')}
            </label>
          ))}
        </fieldset>
      </GraphFilters>
    )
    : null;

  return (
    <>
      {!lane && <GraphControls controlsRef={controls} filterPanel={filtersElement} appearance={appearance} onAppearanceChange={changeAppearance} visibleColorGroups={colors} appearanceSaveError={appearanceError} />}
      {!lane && (
        <GraphSelectionToolbar
          t={t}
          boxMode={boxMode}
          onToggleBoxMode={() => setBoxMode(v => !v)}
          pickerOpen={pickerOpen}
          onTogglePicker={() => {
            setPickerOpen(v => !v);
            setLanePanel(false);
          }}
          visibleSelected={visibleSelected}
          onExpand={setExpanded}
          only={only}
          onOnly={setOnly}
          saveNotebook={saveNotebook}
          screenWritable={screen?.writable}
          onSaveLane={() => {
            setName('');
            setSaveOpen(true);
          }}
          onArrange={() => {
            freeze();
            const arranged = reflow(currentLayout(), true);
            persistLayout(arranged);
            requestAnimationFrame(() => fitView(arranged));
          }}
          lanePanel={lanePanel}
          onToggleLanePanel={() => {
            setLanePanel(v => !v);
            setPickerOpen(false);
          }}
          activeLane={activeLane}
          onEditLane={() => setEditLane(true)}
        />
      )}
      {lane && (
        <div className='graph-fullscreen-tool'>
          <GraphTool label={t('graph.openLaneGraph')} onClick={() => void openFullGraph()}>
            <Maximize2 size={18} />
          </GraphTool>
        </div>
      )}
      {!lane && lanePanel && (
        <GraphLanePanel
          t={t}
          activeLane={activeLane}
          onClose={() => setLanePanel(false)}
          laneRows={laneRows}
          onSelectLane={selectLane}
          showOutside={showOutside}
          onToggleShowOutside={checked => {
            const next = new URLSearchParams(params);
            if (checked) next.set('laneScope', 'all');
            else next.delete('laneScope');
            setParams(next);
          }}
          screen={screen}
          onEditLane={() => setEditLane(true)}
          onSaveCurrentLane={() => {
            freeze();
            persistLayout(currentLayout());
            setSaveLayoutRequested(true);
          }}
          laneMembers={laneMembers}
          visibleSelected={visibleSelected}
          onChangeMembership={changeMembership}
        />
      )}
      {!lane && !lanePanel && activeLane && (
        <button
          type='button'
          className='graph-lane-label'
          aria-expanded={false}
          title={t('graph.chooseLane')}
          onClick={() => {
            setLanePanel(true);
            setPickerOpen(false);
          }}
        >
          {activeLane.name}
        </button>
      )}
      {editLane && activeLane && screen && (
        <ScreenEditRow
          row={activeLane}
          notebooks={notebooks}
          assets={[]}
          folders={folders}
          selectedNotebookId={filters?.value.notebookId === 'all' ? notebooks[0]?.id || '' : filters?.value.notebookId || notebooks[0]?.id || ''}
          disabled={!screen.writable}
          onClose={() => setEditLane(false)}
          onApply={row => screen.change({ ...screen.page, rows: screen.page.rows.map(value => value.id === row.id ? row : value) })}
          onRemove={() => {
            screen.change({ ...screen.page, rows: screen.page.rows.filter(row => row.id !== activeLane.id) });
            selectLane('');
          }}
        />
      )}
      {pickerOpen && (
        <div className='graph-note-selector' style={activeLane ? { top: 'calc(var(--graph-tools-top) + 44px)' } : undefined}>
          {graphData.nodes.map(node => (
            <label key={node.id}>
              <input
                type='checkbox'
                checked={selected.includes(node.id)}
                onChange={() => select(node.id, { shiftKey: true })}
              />
              {node.title}
            </label>
          ))}
        </div>
      )}
      {notice && <div role='status' className='graph-notice' onClick={() => setNotice('')}>{notice}</div>}
    </>
  );
}
