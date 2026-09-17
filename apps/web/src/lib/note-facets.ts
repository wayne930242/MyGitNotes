import type { NotebookFacets } from '@mygitnotes/core/note-query';

export const emptyNotebookFacets = (): NotebookFacets => ({ total: 0, hidden: 0, statuses: {}, tags: {}, directories: {} });

/** Adds up notebook facets, for a view scoped to several notebooks ("all notebooks"). */
export function mergeNotebookFacets(facets: NotebookFacets[]): NotebookFacets {
  const result = emptyNotebookFacets();
  const add = (target: Record<string, number>, source: Record<string, number>) => {
    for (const [name, count] of Object.entries(source)) target[name] = (target[name] || 0) + count;
  };
  for (const item of facets) {
    result.total += item.total;
    result.hidden += item.hidden;
    add(result.statuses, item.statuses);
    add(result.tags, item.tags);
    add(result.directories, item.directories);
  }
  return result;
}
