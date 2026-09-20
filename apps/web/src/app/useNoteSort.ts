import { useState } from 'react';
import { getSavedSort, saveSort, SortField, SortOrder } from '../lib/note-sort.js';

export function useNoteSort() {
  const [sortField, setSortField] = useState<SortField>(() => getSavedSort().field);
  const [sortOrder, setSortOrder] = useState<SortOrder>(() => getSavedSort().order);

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
  };

  return { sortField, sortOrder, handleSortChange };
}
