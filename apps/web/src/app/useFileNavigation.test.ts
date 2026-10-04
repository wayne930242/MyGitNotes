// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFileNavigation } from './useFileNavigation.js';
import { parseWorkspaceRoute } from '../lib/routes.js';

afterEach(cleanup);
type Params = Parameters<typeof useFileNavigation>[0];
function fixture(overrides: Partial<Params> = {}) {
  const params: Params = { editorRegistry: { register: vi.fn(() => () => {}), flushEditors: vi.fn().mockResolvedValue(true) }, hasPendingDrafts: vi.fn(() => false), documents: [], t: key => key, config: { schema_version: 3, workspace: { title: 'Test', default_notebook: 'a' }, notebooks: [{ id: 'a', root: 'notes/a', title: 'A' }] }, setFileDialog: vi.fn(), setActionError: vi.fn(), refreshWorkspace: vi.fn().mockResolvedValue(undefined), refreshDocuments: vi.fn().mockResolvedValue(undefined), editorRoute: parseWorkspaceRoute('/notebooks/a', ''), editorNotebookId: 'a', setEditingNote: vi.fn(), navigate: vi.fn(), location: { pathname: '/notebooks/a', search: '', hash: '', key: 'test', state: null }, returnTo: '/notebooks/a', setFileEditorRevision: vi.fn(), selectedFolder: 'one/nested', folderRoot: 'notes/a', changeFilters: vi.fn(), handleOpenFolderIndex: vi.fn().mockResolvedValue(undefined), ...overrides };
  const { result } = renderHook(() => useFileNavigation(params));
  return { params, model: result.current };
}
it.each(['browse', 'move', 'delete'] as const)('maps nested folder %s requests to workspace paths and scoped document browsing', action => {
  const { params, model } = fixture();
  model.openFileManager('a', 'one/nested', action);
  expect(params.setFileDialog).toHaveBeenCalledWith({ notebookId: 'a', path: 'notes/a/one/nested', showDocuments: true, initialOperation: action === 'delete' ? 'remove-directory' : action === 'move' ? 'move' : undefined });
});
it('refuses file changes when an editor cannot flush, even before draft state catches up', async () => {
  const { params, model } = fixture();
  vi.mocked(params.editorRegistry.flushEditors).mockResolvedValue(false);
  await expect(model.beforeFileChange()).rejects.toThrow('folder.draftsHint');
});
it('clears deleted folder filters and exits a deleted open note after refreshing workspace state', async () => {
  const { params, model } = fixture({ editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a', pathMap: {}, deletedPaths: ['notes/a/one/nested', 'notes/a/one/nested/note.md'] });
  expect(params.refreshWorkspace).toHaveBeenCalledWith(true);
  expect(params.refreshDocuments).toHaveBeenCalledOnce();
  expect(params.setEditingNote).toHaveBeenCalledWith(null);
  expect(params.navigate).toHaveBeenCalledWith('/notebooks/a', { replace: true });
  expect(params.changeFilters).toHaveBeenCalledWith({ folders: [] });
});
it('repairs selected folder and open-note routes when preserving contents moves them out', async () => {
  const { params, model } = fixture({ editorRoute: parseWorkspaceRoute('/notebooks/a/notes/one/nested/note.md', '') });
  await model.onFilesChanged({ revision: 'r2', selectedPath: 'notes/a/two', pathMap: { 'notes/a/one/nested': 'notes/a/two', 'notes/a/one/nested/note.md': 'notes/a/two/note.md' }, deletedPaths: ['notes/a/one/nested', 'notes/a/one/nested/note.md'] });
  expect(params.navigate).toHaveBeenCalledWith('/notebooks/a/notes/two/note.md', { replace: true });
  expect(params.changeFilters).toHaveBeenCalledWith({ folders: ['notes/a/two'] });
});
