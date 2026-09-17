import { describe, it, expect, vi } from 'vitest';
import {
  getImmediateSubfolders,
  getBreadcrumbs,
  resolveFolderClick,
  resolveAllNotebooksFolderSelect,
  resolveEnterTouchMultiSelect,
  buildFolderTree,
  expandedPathsForFolder,
} from './folder-tree.js';
import { FolderItem } from './types.js';

describe('folder-tree', () => {
  it('keeps folder cards in the persisted sidebar order', () => {
    const ordered = [{ notebookId:'n', path:'a', title:'A', order:1 }, { notebookId:'n', path:'z', title:'Z', order:0 }];
    expect(getImmediateSubfolders({}, ordered, 'n', 'notes/n', null).map(folder => folder.path)).toEqual(['z','a']);
  });
  // Facet directory counts: repo-relative directory to the notes directly inside it.
  const directories: Record<string, number> = {
    'notes': 1,
    'notes/projects': 1,
    'notes/projects/web': 1,
    'notes/projects/backend': 1,
    'notes/personal': 1,
  };

  const folders: FolderItem[] = [
    { notebookId: 'nb1', path: 'projects', title: 'Projects', order: 1 },
    { notebookId: 'nb1', path: 'projects/web', title: 'Web App Dev', order: 2 },
    { notebookId: 'nb1', path: 'personal', title: 'Personal Notes', order: 3 },
  ];

  it('lists immediate subfolders under All folders (null)', () => {
    const subfolders = getImmediateSubfolders(directories, folders, 'nb1', 'notes', null);
    expect(subfolders.map((s) => s.path)).toEqual(['projects', 'personal']);
    expect(subfolders.find((s) => s.path === 'projects')?.noteCount).toBe(3); // proj-overview, web/app, backend/api
    expect(subfolders.find((s) => s.path === 'personal')?.noteCount).toBe(1); // diary
  });

  it('lists immediate subfolders under a specific folder (projects)', () => {
    const subfolders = getImmediateSubfolders(directories, folders, 'nb1', 'notes', 'projects');
    expect(subfolders.map((s) => s.path)).toEqual(['projects/backend', 'projects/web']);
    expect(subfolders.find((s) => s.path === 'projects/backend')?.noteCount).toBe(1);
    expect(subfolders.find((s) => s.path === 'projects/web')?.title).toBe('Web App Dev');
  });

  it('sums a subfolder\'s own notes and every note below it', () => {
    const nested = getImmediateSubfolders({ 'notes/projects': 2, 'notes/projects/web/deep': 3 }, folders, 'nb1', 'notes', null);
    expect(nested.find(folder => folder.path === 'projects')?.noteCount).toBe(5);
  });

  it('generates breadcrumb segments accurately', () => {
    const rootBreadcrumbs = getBreadcrumbs(null, folders, 'nb1');
    expect(rootBreadcrumbs).toEqual([{ name: 'All folders', path: null }]);

    const nestedBreadcrumbs = getBreadcrumbs('projects/web', folders, 'nb1');
    expect(nestedBreadcrumbs).toEqual([
      { name: 'All folders', path: null },
      { name: 'Projects', path: 'projects' },
      { name: 'Web App Dev', path: 'projects/web' },
    ]);
  });

  it('resolves a plain click to the single-select callback', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: false }, onSelect, onFilterFolder)('projects');
    expect(onSelect).toHaveBeenCalledWith('projects');
    expect(onFilterFolder).not.toHaveBeenCalled();
  });

  it('resolves a shift+click to the multi-select toggle callback', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: true }, onSelect, onFilterFolder)('projects');
    expect(onFilterFolder).toHaveBeenCalledWith('projects');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('resolves a plain tap to the multi-select toggle callback while touch multi-select is active', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: false }, onSelect, onFilterFolder, true)('projects');
    expect(onFilterFolder).toHaveBeenCalledWith('projects');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('resolves a plain tap to the single-select callback when touch multi-select is not active', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: false }, onSelect, onFilterFolder, false)('projects');
    expect(onSelect).toHaveBeenCalledWith('projects');
    expect(onFilterFolder).not.toHaveBeenCalled();
  });

  it('falls back to the single-select callback when no multi-select handler is given', () => {
    const onSelect = vi.fn();
    resolveFolderClick({ shiftKey: true }, onSelect)('projects');
    expect(onSelect).toHaveBeenCalledWith('projects');
  });

  it('resolves a ctrl+click to the multi-select toggle callback', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: false, ctrlKey: true }, onSelect, onFilterFolder)('projects');
    expect(onFilterFolder).toHaveBeenCalledWith('projects');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('resolves a cmd(meta)+click to the multi-select toggle callback', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: false, metaKey: true }, onSelect, onFilterFolder)('projects');
    expect(onFilterFolder).toHaveBeenCalledWith('projects');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('resolves a plain click to null when only one notebook is shown, deferring to the caller', () => {
    expect(resolveAllNotebooksFolderSelect('nb1', 'notes/nb1', 'projects')).toBeNull();
  });

  it('scopes a plain click in the "all notebooks" view to that folder\'s own notebook path', () => {
    expect(resolveAllNotebooksFolderSelect('all', 'notes/nb1', 'projects')).toEqual(['notes/nb1/projects']);
  });

  it('clears the filter when switching to "All folders" in the "all notebooks" view', () => {
    expect(resolveAllNotebooksFolderSelect('all', 'notes/nb1', null)).toEqual([]);
  });

  it('keeps an already-selected folder selected when entering touch multi-select', () => {
    // 3.1: Long-pressing an already-selected folder must not deselect it
    expect(resolveEnterTouchMultiSelect(['notes/nb1/projects'], 'notes/nb1', 'projects')).toEqual(['notes/nb1/projects']);
    expect(resolveEnterTouchMultiSelect([], 'notes/nb1', 'projects')).toEqual(['notes/nb1/projects']);
    expect(resolveEnterTouchMultiSelect(['notes/nb1/personal'], 'notes/nb1', 'projects')).toEqual([
      'notes/nb1/personal',
      'notes/nb1/projects',
    ]);
  });

  it('resolves a plain mouse click to single-select even when touch multi-select is active on hybrid devices', () => {
    // 3.5: Hybrid mouse+touch devices should keep plain mouse clicks as folder switch
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: false, pointerType: 'mouse' }, onSelect, onFilterFolder, true)('projects');
    expect(onSelect).toHaveBeenCalledWith('projects');
    expect(onFilterFolder).not.toHaveBeenCalled();
  });

  it('resolves a modified mouse click to multi-select toggle on hybrid devices', () => {
    const onSelect = vi.fn();
    const onFilterFolder = vi.fn();
    resolveFolderClick({ shiftKey: true, pointerType: 'mouse' }, onSelect, onFilterFolder, true)('projects');
    expect(onFilterFolder).toHaveBeenCalledWith('projects');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('builds a nested tree with accurate depth and synthesized parent nodes', () => {
    const rawFolders: FolderItem[] = [
      { notebookId: 'nb1', path: 'tech/web/react', title: 'React', order: 1 },
      { notebookId: 'nb1', path: 'tech', title: 'Technology', order: 0 },
      { notebookId: 'nb2', path: 'other', title: 'Other Notebook', order: 0 },
    ];
    const tree = buildFolderTree(rawFolders, 'nb1');
    expect(tree).toHaveLength(1);
    expect(tree[0].path).toBe('tech');
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children).toHaveLength(1);
    const webNode = tree[0].children[0];
    expect(webNode.path).toBe('tech/web');
    expect(webNode.depth).toBe(1);
    expect(webNode.children).toHaveLength(1);
    expect(webNode.children[0].path).toBe('tech/web/react');
    expect(webNode.children[0].depth).toBe(2);
  });

  it('computes expanded ancestors for a folder path', () => {
    expect(expandedPathsForFolder('a/b/c')).toEqual(['a', 'a/b']);
    expect(expandedPathsForFolder('root')).toEqual([]);
    expect(expandedPathsForFolder(null)).toEqual([]);
  });
});
