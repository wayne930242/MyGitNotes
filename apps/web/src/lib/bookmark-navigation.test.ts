import { expect, it } from 'vitest';
import { bookmarkQueryRoute, captureBookmarkQuery } from './bookmark-navigation.js';
import { readFilterQuery } from './filter-query.js';
import { parseWorkspaceRoute } from './routes.js';
const notebook = { id: 'books', root: 'notes/books' };
it('captures typed query, sort and graph scope without transient route state', () => {
  const filters = readFilterQuery('?q=hello&tag=b&tag=a&folders=notes/books/chapter&view=graph&neighbors=true');
  const query = captureBookmarkQuery(filters, { field: 'title', order: 'desc' }, notebook);
  expect(query.folders).toEqual(['chapter']);
  const route = bookmarkQueryRoute(notebook, query), [pathname, search] = route.split('?');
  expect(pathname).toBe('/graph');
  expect(parseWorkspaceRoute(pathname, search)).toMatchObject({ notebook: 'books', folders: ['notes/books/chapter'], q: 'hello', neighbors: true, sortField: 'title', sortOrder: 'desc', allNotebooks: false });
  expect(route).not.toContain('focus=');
});
it('rejects global or foreign filters instead of silently narrowing', () => {
  const sort = { field: 'updated' as const, order: 'desc' as const };
  expect(() => captureBookmarkQuery(readFilterQuery('?allNotebooks=true'), sort, notebook)).toThrow();
  expect(() => captureBookmarkQuery(readFilterQuery('?folders=notes/other'), sort, notebook)).toThrow();
});
