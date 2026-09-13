import type { ScreenItem, ScreenRow } from '@github-notes/core/screen-page';
import { isNoteHidden } from '@github-notes/core/note-status';
import type { AssetItem, NoteItem, NotebookConfig, FolderItem } from './types.js';

export function screenFolderOptions(notebook: NotebookConfig | undefined, folders: FolderItem[], assets: (AssetItem & { notebookId: string })[]) {
  if (!notebook) return [];
  const options = new Map([[notebook.root, notebook.title]]);
  for (const folder of folders.filter(folder => folder.notebookId === notebook.id)) options.set(`${notebook.root}/${folder.path}`, folder.title);
  options.set(`${notebook.root}/${notebook.assets || 'assets'}`, notebook.assets || 'assets');
  for (const asset of assets.filter(asset => asset.notebookId === notebook.id && asset.path.startsWith(`${notebook.root}/`))) {
    const segments = asset.path.slice(notebook.root.length + 1).split('/').slice(0, -1);
    for (let index = 1; index <= segments.length; index++) {
      const relative = segments.slice(0, index).join('/');
      if (!options.has(`${notebook.root}/${relative}`)) options.set(`${notebook.root}/${relative}`, relative);
    }
  }
  return [...options].map(([path, title]) => ({ path, title }));
}

export function screenRowItems(row: ScreenRow, notes: NoteItem[], assets: (AssetItem & { notebookId: string })[]): ScreenItem[] {
  if (row.kind === 'custom') return row.items;
  const source = row.source;
  const within = (file: string) => file.startsWith(`${source.kind === 'folder' ? source.path : ''}/`)
    && (source.kind !== 'folder' || source.recursive || !file.slice(source.path.length + 1).includes('/'));
  const selectedNotes = notes.filter(note => !isNoteHidden({ ...note.metadata, status: note.status })
    && (!source.notebookId || note.notebookId === source.notebookId)
    && (source.kind === 'tag' ? note.tags.includes(source.tag) : within(note.path)));
  const selectedAssets = source.kind === 'folder' ? assets.filter(asset => asset.notebookId === source.notebookId && within(asset.path)) : [];
  return [
    ...selectedNotes.sort((a,b) => a.title.localeCompare(b.title)).map(note => ({ id: `dynamic:${row.id}:${note.path}`, kind: 'note' as const, notebookId: note.notebookId, path: note.path })),
    ...selectedAssets.sort((a,b) => a.name.localeCompare(b.name)).map(asset => ({ id: `dynamic:${row.id}:${asset.path}`, kind: 'asset' as const, notebookId: asset.notebookId, path: asset.path })),
  ];
}

export function noteSummary(content: string): string {
  return content.replace(/^#{1,6}\s+.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
