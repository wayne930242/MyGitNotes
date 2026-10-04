import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readFilterQuery } from '../lib/filter-query.js';
import { getSavedSort, saveSort, SortField, SortOrder } from '../lib/note-sort.js';

export function useNoteSort() {
  const location = useLocation(), navigate = useNavigate();
  const route = readFilterQuery(location.search);
  const [savedField, setSortField] = useState<SortField>(() => getSavedSort().field);
  const [savedOrder, setSortOrder] = useState<SortOrder>(() => getSavedSort().order);
  const sortField = route.sortField ?? savedField, sortOrder = route.sortOrder ?? savedOrder;

  const handleSortChange = (field: SortField, order?: SortOrder) => {
    let newOrder: SortOrder;
    if (order) {
      newOrder = order;
    } else if (field === sortField) {
      newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      newOrder = field === 'title' || field === 'status' ? 'asc' : 'desc';
    }
    setSortField(field);
    setSortOrder(newOrder);
    saveSort(field, newOrder);
    const query = new URLSearchParams(location.search);
    query.set('sortField', field);
    query.set('sortOrder', newOrder);
    navigate({ pathname: location.pathname, search: query.toString() });
  };

  return { sortField, sortOrder, handleSortChange };
}
