import { GraphPanels } from './graph/GraphPanels.js';
import { GraphCanvas } from './graph/GraphCanvas.js';
import { GraphCards } from './graph/GraphCards.js';
import { GraphGestureLayer } from './graph/GraphGestureLayer.js';
import { GraphSaveDialog } from './graph/GraphSaveDialog.js';
import { useGraphController } from './graph/useGraphController.js';
import type { GraphPageProps } from './graph/types.js';
import './graph/graph-editing.css';
export type { GraphPageProps } from './graph/types.js';
export function GraphPage(props: GraphPageProps) {
  const model = useGraphController(props);
  const { lane, t, container, graphSource, matchingPaths, visiblePaths, lanePaths, matching, graphData, resetView, laneViewport, minimap, graphLoading, visibleSelected, onDoubleClickCapture, onKeyDown, onWheelCapture, onPointerDownCapture } = model;
  return (
    <div ref={container} style={lane ? { height: laneViewport.height } : undefined} data-selected-count={visibleSelected.length} tabIndex={0} aria-label={t('graph.canvasHelp')} className={`graph-page-container graph-editing-surface ${lane ? 'graph-in-lane' : ''}`} onDoubleClickCapture={onDoubleClickCapture} onKeyDown={onKeyDown} onWheelCapture={onWheelCapture} onPointerDownCapture={onPointerDownCapture}>
      <GraphPanels model={model} />
      <GraphCanvas model={model} />
      <GraphCards model={model} />
      <GraphGestureLayer model={model} />
      {(graphSource.error || matchingPaths.error || visiblePaths.error || lanePaths.error) && <div role='alert' className='graph-notice'>{graphSource.error || matchingPaths.error || visiblePaths.error || lanePaths.error}</div>}
      {graphLoading && <p className='graph-empty' role='status'>{t('notes.loading')}</p>}
      {!graphLoading && !graphData.nodes.length && <p className='graph-empty' role='status'>{t('filters.graphEmpty')}</p>}
      <div className='graph-minimap-panel'>
        <div className='graph-stats' role='status' data-filter-results={matching.length} data-graph-nodes={graphData.nodes.length} data-graph-links={graphData.links.length}>
          <button className='ui-icon-button' aria-label={t('graph.resetZoom')} title={t('graph.resetZoom')} onClick={resetView}>↺</button>
          <span>{graphData.nodes.length}{' ●'}</span>
          <span>{graphData.links.length}{' ↗'}</span>
        </div>
        {minimap}
      </div>
      <GraphSaveDialog model={model} />
    </div>
  );
}
