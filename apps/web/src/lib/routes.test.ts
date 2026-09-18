import { describe, expect, it } from 'vitest';
import { legacyAllNotebooksRoute, screenLaneRoute, noteRoute, notebookRoute, noteReturnRoute, parseWorkspaceRoute } from './routes.js';
describe('workspace URLs', () => {
  it('returns editors to their original workspace and preserves filters', () => {
    for (const origin of ['/graph?notebook=example', '/screen?notebook=work', '/notebooks/example/folders/projects?view=graph&tag=demo&q=hello']) {
      const search = '?' + new URLSearchParams({ returnTo: origin });
      expect(noteReturnRoute(search, 'other')).toBe(origin);
    }
    expect(noteReturnRoute('?returnTo=screen', 'work')).toBe('/screen?notebook=work');
    expect(noteReturnRoute('?returnTo=graph', 'work')).toBe('/graph?notebook=work');
    expect(noteReturnRoute('?folder=projects&view=card', 'work', 'projects')).toBe('/notebooks/work/folders/projects?view=card');
  });
  it('falls back to the notebook for invalid or recursive editor origins', () => {
    for (const returnTo of ['https://example.com', '//example.com', '/missing', '/notebooks/work/notes/note.md', '/graph?returnTo=/screen']) {
      expect(noteReturnRoute('?' + new URLSearchParams({ returnTo }), 'work')).toBe('/notebooks/work');
    }
  });
  it('defaults to flat while preserving explicit view links', () => {
    for (const pathname of ['/', '/notes', '/notebooks/example', '/notebooks/example/folders/projects']) {
      expect(parseWorkspaceRoute(pathname, '').view).toBe('flat');
      expect(parseWorkspaceRoute(pathname, '?view=unknown').view).toBe('flat');
      for (const view of ['flat', 'list', 'card', 'kanban', 'graph']) {
        expect(parseWorkspaceRoute(pathname, `?view=${view}`).view).toBe(view);
      }
    }
  });
  it('roundtrips nested notes and reserved filename characters', () => {
    for (const path of ['projects/week/note.md', '研究/百分比 100% #?+.md', 'literal%2F.md']) {
      expect(parseWorkspaceRoute(noteRoute('example',path),'').note).toBe(path);
    }
    expect(parseWorkspaceRoute(notebookRoute('example','projects/week'),'?view=kanban&status=inbox')).toMatchObject({ valid:true,folder:'projects/week',view:'kanban',status:'inbox' });
    expect(parseWorkspaceRoute(notebookRoute('example','projects'),'?view=flat')).toMatchObject({ folder:'projects', view:'flat' });
  });
  it('restores pages, notebook and filters from URLs', () => {
    expect(parseWorkspaceRoute('/', '')).toMatchObject({ valid: true, tab: 'notes' });
    expect(parseWorkspaceRoute('/index.html', '')).toMatchObject({ valid: true, tab: 'notes' });
    expect(parseWorkspaceRoute('/notebooks', '')).toMatchObject({ valid: true, tab: 'notes' });
    expect(parseWorkspaceRoute('/notebooks/', '')).toMatchObject({ valid: true, tab: 'notes' });
    expect(parseWorkspaceRoute('/notes', '?showHidden=true').showHidden).toBe(true);
    expect(parseWorkspaceRoute('/notes', '').showHidden).toBe(false);
    expect(parseWorkspaceRoute('/notes', '?folder=').valid).toBe(true);
    for (const tab of ['settings','assets','agent','screen','graph']) for (const suffix of ['', '/']) expect(parseWorkspaceRoute('/'+tab+suffix,'?notebook=work').tab).toBe(tab);
    expect(parseWorkspaceRoute(noteRoute('work','note.md'),'?folder=projects&q=hello&tag=demo')).toMatchObject({ notebook:'work',folder:'projects',q:'hello',tag:'demo' });
  });
  it('rejects unknown pages, traversal and malformed URLs', () => {
    for(const route of ['/missing','/notebooks/work/notes/../secret.md','/notebooks/work/notes/%00.md','/notebooks/work/notes/%zz']) expect(parseWorkspaceRoute(route,'').valid).toBe(false);
  });
});

it('opens a dedicated lane and preserves it as the editor return route', () => {
  const origin = screenLaneRoute('review-1') + '?notebook=work';
  expect(parseWorkspaceRoute('/screen/lanes/review-1/', '?notebook=work')).toMatchObject({ valid: true, tab: 'screen', lane: 'review-1', notebook: 'work' });
  expect(noteReturnRoute('?' + new URLSearchParams({ returnTo: origin }), 'work')).toBe(origin);
  expect(parseWorkspaceRoute('/screen', '').lane).toBeNull();
  for (const invalid of ['/screen/lanes/a/b', '/screen/lanes/%00', '/screen/lanes/' + 'a'.repeat(65)]) expect(parseWorkspaceRoute(invalid, '').valid).toBe(false);
});

describe('focus parameter', () => {
  it('accepts current or a valid id, otherwise reads as null without invalidating the route', () => {
    expect(parseWorkspaceRoute('/notebooks/work', '?focus=current')).toMatchObject({ valid: true, focus: 'current' });
    expect(parseWorkspaceRoute('/notebooks/work', '?focus=focus-1')).toMatchObject({ valid: true, focus: 'focus-1' });
    expect(parseWorkspaceRoute('/notebooks/work', '')).toMatchObject({ focus: null });
    for (const bad of ['', 'has space', 'a/b', 'a'.repeat(65)]) {
      expect(parseWorkspaceRoute('/notebooks/work', '?focus=' + encodeURIComponent(bad))).toMatchObject({ valid: true, focus: null });
    }
  });
  it('round-trips through noteReturnRoute alongside the rest of the query', () => {
    for (const origin of ['/notebooks/example/folders/projects?focus=current', '/notebooks/example?focus=focus-1&view=list']) {
      const search = '?' + new URLSearchParams({ returnTo: origin });
      expect(noteReturnRoute(search, 'other')).toBe(origin);
    }
  });
});

describe('all-notebooks scope', () => {
  it('reads the toggle from the URL', () => {
    expect(parseWorkspaceRoute('/notebooks/work', '?allNotebooks=true')).toMatchObject({ notebook: 'work', allNotebooks: true, legacyAllNotebooks: false });
    expect(parseWorkspaceRoute('/graph', '?notebook=work')).toMatchObject({ notebook: 'work', allNotebooks: false });
    expect(legacyAllNotebooksRoute('/graph', '?notebook=work&allNotebooks=true', 'rules')).toBeNull();
  });
  it('opens former all-notebooks URLs in the default notebook', () => {
    expect(parseWorkspaceRoute('/notebooks/all', '')).toMatchObject({ valid: true, tab: 'notes', notebook: null, allNotebooks: true, legacyAllNotebooks: true });
    expect(legacyAllNotebooksRoute('/notebooks/all', '?q=hello', 'rules')).toBe('/notebooks/rules?q=hello&notebook=rules&allNotebooks=true');
    expect(legacyAllNotebooksRoute('/notebooks/work', '?notebook=all', 'rules')).toBe('/notebooks/rules?notebook=rules&allNotebooks=true');
    expect(legacyAllNotebooksRoute('/graph', '?notebook=all&tag=demo', 'rules')).toBe('/graph?notebook=rules&tag=demo&allNotebooks=true');
    for (const page of ['/screen', '/files', '/agent', '/settings']) {
      expect(parseWorkspaceRoute(page, '?notebook=all').allNotebooks).toBe(false);
      expect(legacyAllNotebooksRoute(page, '?notebook=all', 'rules')).toBe(`${page}?notebook=rules`);
    }
  });
});
