import { describe, expect, it } from 'vitest';
import { noteRoute, notebookRoute, parseWorkspaceRoute } from './routes.js';
describe('workspace URLs', () => {
  it('defaults to flat while preserving explicit view links', () => {
    for (const pathname of ['/', '/notes', '/notebooks/example', '/notebooks/example/folders/projects']) {
      expect(parseWorkspaceRoute(pathname, '').view).toBe('flat');
      expect(parseWorkspaceRoute(pathname, '?view=unknown').view).toBe('flat');
      for (const view of ['flat', 'list', 'card', 'kanban']) {
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
    for (const tab of ['settings','assets','agent','screen']) for (const suffix of ['', '/']) expect(parseWorkspaceRoute('/'+tab+suffix,'?notebook=work').tab).toBe(tab);
    expect(parseWorkspaceRoute(noteRoute('work','note.md'),'?folder=projects&q=hello&tag=demo')).toMatchObject({ notebook:'work',folder:'projects',q:'hello',tag:'demo' });
  });
  it('rejects unknown pages, traversal and malformed URLs', () => {
    for(const route of ['/missing','/notebooks/work/notes/../secret.md','/notebooks/work/notes/%00.md','/notebooks/work/notes/%zz']) expect(parseWorkspaceRoute(route,'').valid).toBe(false);
  });
});
