import { findStudyNote, matchesStudyFilter, studyDue, type StudyWorkspace } from '@mygitnotes/core/study';
import { screenRowNotes, type ScreenItem, type ScreenRow } from '@mygitnotes/core/screen-page';
import { resolveNoteStatuses } from '@mygitnotes/core/note-status';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { AssetItem, NotebookConfig, FolderItem } from './types.js';
import { sortNotes } from './note-sort.js';

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

export function screenRowItems(row: ScreenRow, notes: NoteListItem[], assets: (AssetItem & { notebookId: string })[], notebooks: NotebookConfig[] = []): ScreenItem[] {
  if (row.kind === 'custom') return row.items;
  const source = row.source;
  const within = (file: string) => file.startsWith(`${source.kind === 'folder' ? source.path : ''}/`)
    && (source.kind !== 'folder' || source.recursive || !file.slice(source.path.length + 1).includes('/'));
  // Membership is judged again on the loaded rows so a staged draft lands in the right lane.
  const selectedNotes: NoteListItem[] = screenRowNotes({ ...row, study: undefined }, notes.map(note => ({ ...note, content: note.content ?? '' })));
  const selectedAssets = source.kind === 'folder' ? assets.filter(asset => asset.notebookId === row.notebookId && within(asset.path)) : [];
  if (row.sort) {
    const entries = [
      ...selectedNotes.map(note => ({ note, kind: 'note' as const })),
      // Assets have no creation metadata; use their modification time as in Notes.
      ...selectedAssets.map(asset => ({ kind: 'asset' as const, note: {
        id: asset.path, path: asset.path, notebookId: asset.notebookId, title: asset.name,
        mtime: asset.mtime, metadata: {}, tags: [], content: '',
      } as NoteListItem })),
    ];
    const items = new Map<string, ScreenItem>();
    const sortable = entries.map(({note, kind}) => {
      const id = `dynamic:${row.id}:${note.path}`;
      items.set(id, {id, kind, notebookId: note.notebookId, path: note.path});
      return {...note, id};
    });
    const applicable = notebooks.filter(notebook => notebook.id === row.notebookId);
    const statuses = [...new Set((applicable.length ? applicable.flatMap(notebook => resolveNoteStatuses(notebook)) : resolveNoteStatuses())
      .map(status => status.trim().toLowerCase()))];
    return sortNotes(sortable, row.sort.field, row.sort.order, statuses).map(note => items.get(note.id)!);
  }
  // Preserve the original note-first order until the user chooses a sort.
  return [
    ...selectedNotes.sort((a,b) => a.title.localeCompare(b.title)).map(note => ({ id: `dynamic:${row.id}:${note.path}`, kind: 'note' as const, notebookId: note.notebookId, path: note.path })),
    ...selectedAssets.sort((a,b) => a.name.localeCompare(b.name)).map(asset => ({ id: `dynamic:${row.id}:${asset.path}`, kind: 'asset' as const, notebookId: asset.notebookId, path: asset.path })),
  ];
}

export function noteSummary(content: string): string {
  return content.replace(/^#{1,6}\s+.*$/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function studyRowItems(items: ScreenItem[], row: ScreenRow, notes: NoteListItem[], study: StudyWorkspace, now = new Date()): ScreenItem[] {
  if (!row.study) return items;
  const sources = new Map(notes.map(note => [JSON.stringify([note.notebookId, note.path]), note]));
  const lookup = (item: ScreenItem) => item.kind === 'note' ? sources.get(JSON.stringify([item.notebookId, item.path])) : undefined;
  const entries = items.map(item => { const note = lookup(item); return { item, note, study: note ? findStudyNote(study, { ...note, content: note.content ?? '' }) : undefined }; })
    .filter(entry => (!row.study!.status || entry.note?.status === row.study!.status)
      && matchesStudyFilter(entry.study, row.study!.filter, now));
  if (row.study.dueFirst) entries.sort((a, b) => (a.study ? studyDue(a.study) || '~' : '~').localeCompare(b.study ? studyDue(b.study) || '~' : '~'));
  return entries.map(entry => entry.item);
}
