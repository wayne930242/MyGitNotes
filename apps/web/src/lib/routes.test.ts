import { describe, expect, it } from 'vitest';
import { noteRoute, notebookRoute, noteReturnRoute, parseWorkspaceRoute } from './routes.js';
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
