import { describe, expect, it } from 'vitest';
import { noteRoute, notebookRoute, parseWorkspaceRoute } from './routes.js';
describe('workspace URLs', () => {
  it('roundtrips nested notes and reserved filename characters', () => {
    for (const path of ['projects/week/note.md', '研究/百分比 100% #?+.md', 'literal%2F.md']) {
      expect(parseWorkspaceRoute(noteRoute('example',path),'').note).toBe(path);
    }
    expect(parseWorkspaceRoute(notebookRoute('example','projects/week'),'?view=kanban&status=inbox')).toMatchObject({ valid:true,folder:'projects/week',view:'kanban',status:'inbox' });
  });
  it('restores pages, notebook and filters from URLs', () => {
    expect(parseWorkspaceRoute('/notes', '?showHidden=true').showHidden).toBe(true);
    expect(parseWorkspaceRoute('/notes', '').showHidden).toBe(false);
    for (const tab of ['settings','assets','agent']) for (const suffix of ['', '/']) expect(parseWorkspaceRoute('/'+tab+suffix,'?notebook=work').tab).toBe(tab);
    expect(parseWorkspaceRoute(noteRoute('work','note.md'),'?folder=projects&q=hello&tag=demo')).toMatchObject({ notebook:'work',folder:'projects',q:'hello',tag:'demo' });
  });
  it('rejects unknown pages, traversal and malformed URLs', () => {
    for(const route of ['/missing','/notebooks/work/notes/../secret.md','/notebooks/work/notes/%00.md','/notebooks/work/notes/%zz']) expect(parseWorkspaceRoute(route,'').valid).toBe(false);
  });
});
