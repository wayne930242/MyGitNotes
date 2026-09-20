import { useQueryStates } from 'nuqs';
import { filterParsers } from '../lib/filter-query.js';
import { useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';

export function useFilterSidebar() {
  const [folderReorder, setFolderReorder] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const location = useLocation();
  const [queryState, setFilterQuery] = useQueryStates(filterParsers, { history: 'push', shallow: false });
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setFiltersOpen(false);
    /* eslint-enable react/set-state-in-effect */
  }, [location.pathname]);
  useEffect(() => {
    if (!filtersOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [filtersOpen]);

  return { folderReorder, setFolderReorder, filtersOpen, setFiltersOpen, location, queryState, setFilterQuery };
}
