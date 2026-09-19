import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { relocateWorkspaceDocuments, validateWorkspaceDocument, WORKSPACE_DOCUMENTS, workspaceDocument } from '../src/workspace-documents.js';
import { planFolderChange } from '../src/folder-plan.js';
import { SCREEN_PAGE_FILE } from '../src/screen-page.js';
import { createStudyNote, STUDY_FILE } from '../src/study.js';
import { FOCUS_PAGE_FILE } from '../src/focus-page.js';

const notebooks = [{ id: 'a', title: 'A', root: 'notes/a' }, { id: 'b', title: 'B', root: 'notes/b' }];
const config = { notebooks, workspace: { default_notebook: 'a' } };
const move = (file: string) => file.startsWith('notes/a/one/') ? 'notes/a/two/' + file.slice('notes/a/one/'.length) : file;
function documents() {
  const study = createStudyNote({ notebookId: 'a', path: 'notes/a/one/note.md', title: 'Note', content: '# Note', metadata: {} });
  const other = createStudyNote({ notebookId: 'b', path: 'notes/a/one/note.md', title: 'Same path, other notebook', content: '# Other', metadata: {} });
  return new Map([[SCREEN_PAGE_FILE, YAML.stringify({ version: 2, rows: [{ id: 'row', notebookId: 'a', kind: 'custom', name: 'Row', view: 'graph', items: [{ id: 'note', kind: 'note', notebookId: 'a', path: 'notes/a/one/note.md' }], graph: { nodes: [{ path: 'notes/a/one/note.md', x: 0, y: 0 }] } }, { id: 'folder', notebookId: 'a', kind: 'dynamic', name: 'Folder', view: 'small', source: { kind: 'folder', notebookId: 'a', path: 'notes/a/one', recursive: true } }] })], [STUDY_FILE, YAML.stringify({ version: 1, notes: [study, other], events: [] })], [FOCUS_PAGE_FILE, YAML.stringify({ version: 1, focuses: [{ id: 'weekly', notebookId: 'a', name: 'Weekly', division: 'columns-2', panes: [{ tabs: [{ kind: 'note', path: 'notes/a/one/note.md' }] }, { tabs: [{ kind: 'lane', id: 'row' }] }] }, { id: 'other', notebookId: 'b', name: 'Other', division: 'single', panes: [{ tabs: [{ kind: 'note', path: 'notes/a/one/note.md' }] }] }] })]]);
}

describe('workspace documents', () => {
  it('registers Screen, study and Focus with their commit scopes', () => {
    expect(WORKSPACE_DOCUMENTS.map(document => document.file)).toEqual([SCREEN_PAGE_FILE, STUDY_FILE, FOCUS_PAGE_FILE]);
    expect(workspaceDocument(FOCUS_PAGE_FILE)?.scopes).toEqual(['focus', 'folders', 'files']);
    expect(workspaceDocument(SCREEN_PAGE_FILE)?.scopes).not.toContain('focus');
    expect(workspaceDocument('notes/a/note.md')).toBeUndefined();
  });
  it('validates size, YAML and every accepted stored version', () => {
    const focus = workspaceDocument(FOCUS_PAGE_FILE)!, screen = workspaceDocument(SCREEN_PAGE_FILE)!;
    expect(() => validateWorkspaceDocument(focus, 'version: 1\nfocuses: []\n')).not.toThrow();
    expect(() => validateWorkspaceDocument(focus, 'version: 2\nfocuses: []\n')).toThrow('Invalid Focus YAML.');
    expect(() => validateWorkspaceDocument(focus, 'x'.repeat(focus.maxBytes + 1))).toThrow('Focus YAML is required.');
    expect(() => validateWorkspaceDocument(focus, undefined)).toThrow('Focus YAML is required.');
    expect(() => validateWorkspaceDocument(screen, 'version: 1\nrows: []\n')).not.toThrow();
  });
  it('relocates one notebook across every document and leaves unchanged files untouched', () => {
    const files = documents();
    relocateWorkspaceDocuments(files, config, 'a', move);
    const screen = YAML.parse(files.get(SCREEN_PAGE_FILE)!), study = YAML.parse(files.get(STUDY_FILE)!), focus = YAML.parse(files.get(FOCUS_PAGE_FILE)!);
    expect(screen.rows[0].items[0].path).toBe('notes/a/two/note.md');
    expect(screen.rows[0].graph.nodes[0].path).toBe('notes/a/two/note.md');
    expect(screen.rows[1].source.path).toBe('notes/a/one');
    expect(study.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/a/two/note.md', 'notes/a/one/note.md']);
    expect(focus.focuses.map((entry: { panes: { tabs: { path?: string; }[]; }[]; }) => entry.panes[0].tabs[0].path)).toEqual(['notes/a/two/note.md', 'notes/a/one/note.md']);
    const unchanged = documents(), original = new Map(unchanged);
    relocateWorkspaceDocuments(unchanged, config, 'b', file => file);
    expect(unchanged).toEqual(original);
  });
  it('updates study and Focus references when a folder moves', () => {
    const files = documents();
    files.set('notes/a/one/note.md', '# Note\n');
    const after = planFolderChange({ notebooks, directories: ['notes/a', 'notes/a/one', 'notes/a/two', 'notes/b'], protectedPaths: [], files }, { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' });
    expect(YAML.parse(after.files.get(STUDY_FILE)!).notes[0].path).toBe('notes/a/two/one/note.md');
    expect(YAML.parse(after.files.get(FOCUS_PAGE_FILE)!).focuses[0].panes[0].tabs[0].path).toBe('notes/a/two/one/note.md');
    expect(YAML.parse(after.files.get(SCREEN_PAGE_FILE)!).rows[1].source.path).toBe('notes/a/two/one');
  });
});
