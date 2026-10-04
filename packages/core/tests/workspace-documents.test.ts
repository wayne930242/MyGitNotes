import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { relocateWorkspaceDocuments, validateWorkspaceDocument, WORKSPACE_DOCUMENTS, workspaceDocument } from '../src/workspace-documents.js';
import { planFolderChange } from '../src/folder-plan.js';
import { createStudyNote, STUDY_FILE } from '../src/study.js';
import { FOCUS_PAGE_FILE } from '../src/focus-page.js';

const notebooks = [{ id: 'a', title: 'A', root: 'notes/a' }, { id: 'b', title: 'B', root: 'notes/b' }];
const move = (file: string) => file.startsWith('notes/a/one/') ? 'notes/a/two/' + file.slice('notes/a/one/'.length) : file;
function documents() {
  const study = createStudyNote({ notebookId: 'a', path: 'notes/a/one/note.md', title: 'Note', content: '# Note', metadata: {} });
  const other = createStudyNote({ notebookId: 'b', path: 'notes/a/one/note.md', title: 'Same path, other notebook', content: '# Other', metadata: {} });
  return new Map([[STUDY_FILE, YAML.stringify({ version: 1, notes: [study, other], events: [] })], [FOCUS_PAGE_FILE, YAML.stringify({ version: 1, focuses: [{ id: 'weekly', notebookId: 'a', name: 'Weekly', division: 'columns-2', panes: [{ tabs: [{ kind: 'note', path: 'notes/a/one/note.md' }] }, { tabs: [{ kind: 'note', path: 'notes/a/one/reading.compilation.yml' }] }] }, { id: 'other', notebookId: 'b', name: 'Other', division: 'single', panes: [{ tabs: [{ kind: 'note', path: 'notes/a/one/note.md' }] }] }] })]]);
}

describe('workspace documents', () => {
  it('registers study and Focus with their commit scopes', () => {
    expect(WORKSPACE_DOCUMENTS.map(document => document.file)).toEqual([STUDY_FILE, FOCUS_PAGE_FILE]);
    expect(workspaceDocument(FOCUS_PAGE_FILE)?.scopes).toEqual(['focus', 'folders', 'files']);
    expect(workspaceDocument('.github-notes-screen.yaml')).toBeUndefined();
    expect(workspaceDocument('notes/a/note.md')).toBeUndefined();
  });
  it('validates size, YAML and every accepted stored version', () => {
    const focus = workspaceDocument(FOCUS_PAGE_FILE)!;
    expect(() => validateWorkspaceDocument(focus, 'version: 1\nfocuses: []\n')).not.toThrow();
    expect(() => validateWorkspaceDocument(focus, 'version: 2\nfocuses: []\n')).toThrow('Invalid Focus YAML.');
    expect(() => validateWorkspaceDocument(focus, 'x'.repeat(focus.maxBytes + 1))).toThrow('Focus YAML is required.');
    expect(() => validateWorkspaceDocument(focus, undefined)).toThrow('Focus YAML is required.');
  });
  it('relocates one notebook across every document and leaves unchanged files untouched', () => {
    const files = documents();
    relocateWorkspaceDocuments(files, 'a', move);
    const study = YAML.parse(files.get(STUDY_FILE)!), focus = YAML.parse(files.get(FOCUS_PAGE_FILE)!);
    expect(study.notes.map((note: { path: string; }) => note.path)).toEqual(['notes/a/two/note.md', 'notes/a/one/note.md']);
    expect(focus.focuses.map((entry: { panes: { tabs: { path?: string; }[]; }[]; }) => entry.panes[0].tabs[0].path)).toEqual(['notes/a/two/note.md', 'notes/a/one/note.md']);
    const unchanged = documents(), original = new Map(unchanged);
    relocateWorkspaceDocuments(unchanged, 'b', file => file);
    expect(unchanged).toEqual(original);
  });
  it('updates study and Focus references when a folder moves', () => {
    const files = documents();
    files.set('notes/a/one/note.md', '# Note\n');
    const after = planFolderChange({ notebooks, directories: ['notes/a', 'notes/a/one', 'notes/a/two', 'notes/b'], protectedPaths: [], files }, { kind: 'move', notebookId: 'a', path: 'one', parent: 'two' });
    expect(YAML.parse(after.files.get(STUDY_FILE)!).notes[0].path).toBe('notes/a/two/one/note.md');
    expect(YAML.parse(after.files.get(FOCUS_PAGE_FILE)!).focuses[0].panes[0].tabs[0].path).toBe('notes/a/two/one/note.md');
  });
});
