import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ScreenRow } from '@mygitnotes/core/screen-page';
import type { FilterControls } from '../../lib/filter-controls.js';
import type { ScreenController } from '../../lib/use-screen-page.js';

/** Which lane(s) the graph shows, driven by the `lanes`/`laneScope`/`notebook` URL params, and lane UI toggles. */
export function useLaneSelection({ lane, screen, filters }: { lane?: ScreenRow; screen?: ScreenController; filters?: FilterControls; }) {
  const [params, setParams] = useSearchParams();
  const laneIds = lane ? [lane.id] : params.getAll('lanes');
  const laneKey = laneIds.join(',');
  const activeLane = lane || (laneIds.length === 1 ? screen?.page.rows.find(row => row.id === laneIds[0]) : undefined);
  const showOutside = !lane && params.get('laneScope') === 'all';
  const [lanePanel, setLanePanel] = useState(false), [editLane, setEditLane] = useState(false);
  const rows = screen?.page.rows || [];
  const graphNotebook = filters?.value.notebookId;
  const laneRows = graphNotebook && graphNotebook !== 'all' ? rows.filter(row => row.notebookId === graphNotebook) : rows;
  const selectLane = (id: string) => {
    const next = new URLSearchParams(params);
    next.delete('lanes');
    next.delete('laneScope');
    if (id) next.set('lanes', id);
    setParams(next);
  };
  // A lane belongs to one notebook, so the graph showing it follows that notebook.
  /* eslint-disable react-hooks/exhaustive-deps -- Explicit lane, filter, viewport and layout keys control canvas work; object identity alone must not reset it. */
  useEffect(() => {
    if (lane || !activeLane || !filters || graphNotebook === activeLane.notebookId) return;
    const next = new URLSearchParams(params);
    next.set('notebook', activeLane.notebookId);
    setParams(next, { replace: true });
  }, [lane, activeLane?.notebookId, graphNotebook]);
  /* eslint-enable react-hooks/exhaustive-deps */
  return { params, setParams, laneIds, laneKey, activeLane, showOutside, lanePanel, setLanePanel, editLane, setEditLane, rows, graphNotebook, laneRows, selectLane };
}
