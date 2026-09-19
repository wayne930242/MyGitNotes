import { useEffect, useMemo, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { fetchGitStatus, renderNoteTemplate, saveNote } from '../lib/api.js';
import { buildNewNoteDraft } from '../lib/new-note.js';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import { noteLookupOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import { readWorkingNotes } from '../lib/working-notes.js';
import type { FolderItem, GitStatus, NotebookConfig, NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';

interface UseNewNoteDialogParams {
  config: { notebooks: NotebookConfig[]; } | null;
  selectedNotebookId: string;
  setSelectedNotebookId: (id: string) => void;
  folders: FolderItem[];
  remote: boolean;
  canWrite: boolean;
  workingScope: string;
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null) => NoteItem;
  revision: string;
  invalidateNotes: () => void;
  setGitStatus: (status: GitStatus) => void;
  newNoteStatuses: string[];
  sourceId: string;
  t: I18nContextValue['t'];
  onCreated: (note: NoteItem) => void;
}

/** Create New Note dialog: its form state, and the handlers that render or persist a new note draft. */
export function useNewNoteDialog({ config, selectedNotebookId, setSelectedNotebookId, folders, remote, canWrite, workingScope, queryClient, queryScope, stageWorkingNote, revision, invalidateNotes, setGitStatus, newNoteStatuses, sourceId, t, onCreated }: UseNewNoteDialogParams) {
  const [createError, setCreateError] = useState('');
  const [isNewNoteOpen, setIsNewNoteOpen] = useState<boolean>(false);
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect -- Route and source transitions reset transient UI and load the newly selected document. */
    setIsNewNoteOpen(false);
    /* eslint-enable react/set-state-in-effect */
  }, [sourceId]);
  const [newNoteTitle, setNewNoteTitle] = useState<string>('');
  const [newNoteStatus, setNewNoteStatus] = useState<string>('inbox');
  const [newNoteFolder, setNewNoteFolder] = useState<string>('');
  const [newNoteTags, setNewNoteTags] = useState<string[]>([]);
  const [newNoteTemplateId, setNewNoteTemplateId] = useState<string>('');
  const newNoteFolders = useMemo(() => folders.filter(folder => folder.notebookId === selectedNotebookId).map(folder => folder.path).sort(), [folders, selectedNotebookId]);
  const newNoteTemplates = useMemo(() => config?.notebooks.find(n => n.id === selectedNotebookId)?.templates || [], [config, selectedNotebookId]);
  const handleTemplateChange = async (templateId: string) => {
    setNewNoteTemplateId(templateId);
    if (!templateId) return;
    const currentNotebook = config?.notebooks.find((n) => n.id === selectedNotebookId) || config?.notebooks[0];
    if (!currentNotebook) return;
    try {
      const rendered = await renderNoteTemplate({ notebookId: currentNotebook.id, templateId, title: newNoteTitle || 'Untitled' });
      if (typeof rendered.metadata.status === 'string' && newNoteStatuses.includes(rendered.metadata.status)) {
        setNewNoteStatus(rendered.metadata.status);
      }
      if (Array.isArray(rendered.metadata.tags)) {
        setNewNoteTags(rendered.metadata.tags.map(String));
      }
    } catch {
      // Ignore template preview error
    }
  };
  const openNewNote = (options?: string | { status?: string; folder?: string; tag?: string; tags?: string[]; notebookId?: string; }) => {
    const opts = typeof options === 'string' ? { status: options } : { ...options };
    if (opts.notebookId && opts.notebookId !== selectedNotebookId && config?.notebooks.some(n => n.id === opts.notebookId)) {
      setSelectedNotebookId(opts.notebookId);
    }
    setNewNoteStatus(opts.status || newNoteStatuses[0]);
    setNewNoteFolder(opts.folder || '');
    setNewNoteTags(opts.tags || (opts.tag ? [opts.tag] : []));
    setNewNoteTemplateId('');
    setCreateError('');
    setIsNewNoteOpen(true);
  };

  const handleCreateNewNote = async (statusOverride?: string) => {
    try {
      setCreateError('');
      if (!canWrite) throw new Error('This workspace is read-only.');
      const title = newNoteTitle.trim() || 'Untitled Note';
      const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'untitled';

      const currentNotebook = config?.notebooks.find((n) => n.id === selectedNotebookId) || config?.notebooks[0];
      const root = currentNotebook?.root || 'notes/example';
      const folder = newNoteFolder.trim().replace(/^\/+|\/+$/g, '');
      if (folder && !newNoteFolders.includes(folder)) throw new Error(t('createNote.invalidFolder'));
      const notePath = [root, folder, `${slug}.md`].filter(Boolean).join('/');
      const taken = Boolean(remote && readWorkingNotes(workingScope)[notePath]) || (await queryClient.fetchQuery(noteLookupOptions(queryScope, [notePath], false))).notes.length > 0;
      if (taken) throw new Error('A note with this filename already exists in this folder. Choose another title.');

      const status = statusOverride || newNoteStatus;
      const template = newNoteTemplateId ? await renderNoteTemplate({ notebookId: currentNotebook!.id, templateId: newNoteTemplateId, title }) : undefined;
      const draft = buildNewNoteDraft({ slug, title, tags: newNoteTags, status, template });
      const initialContent = draft.content;
      const finalStatus = draft.status;
      const initialMetadata = withNoteStatus(draft.metadata, finalStatus);

      const res = remote ? { note: stageWorkingNote({ id: slug, path: notePath, notebookId: currentNotebook!.id, title, content: initialContent, metadata: initialMetadata, status: finalStatus, tags: Array.isArray(initialMetadata.tags) ? initialMetadata.tags.map(String) : [], revision }, null) } : await saveNote({ path: notePath, notebookId: currentNotebook?.id, createOnly: true, content: initialContent, metadata: initialMetadata, noCommit: true });
      if (!remote) invalidateNotes();

      setIsNewNoteOpen(false);
      setNewNoteTitle('');
      setNewNoteFolder('');
      setNewNoteTags([]);
      setNewNoteTemplateId('');
      setNewNoteStatus(newNoteStatuses[0]);
      const statusRes = await fetchGitStatus();
      setGitStatus(statusRes.status);
      onCreated(res.note);
    } catch (error) {
      setCreateError((error as Error).message);
    }
  };

  return { createError, setCreateError, isNewNoteOpen, setIsNewNoteOpen, newNoteTitle, setNewNoteTitle, newNoteStatus, setNewNoteStatus, newNoteFolder, setNewNoteFolder, newNoteTags, setNewNoteTags, newNoteTemplateId, setNewNoteTemplateId, newNoteFolders, newNoteTemplates, handleTemplateChange, openNewNote, handleCreateNewNote };
}
