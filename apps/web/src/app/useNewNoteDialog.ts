import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { OUTLINE_SUFFIX } from '@mygitnotes/core/outline';
import { noteMarkdownLink } from '@mygitnotes/core/workspace-links';
import type { QueryClient } from '@tanstack/react-query';
import { fetchGitStatus, renderNoteTemplate, saveNote } from '../lib/api.js';
import { buildNewNoteDraft } from '../lib/new-note.js';
import { withNoteStatus } from '@mygitnotes/core/note-status';
import { noteLookupOptions, type NoteQueryScope } from '../lib/use-note-queries.js';
import type { FolderItem, GitStatus, NotebookConfig, NoteItem } from '../lib/types.js';
import type { I18nContextValue } from '../lib/i18n/index.js';
import type { WorkspaceState } from './workspace-state.js';

interface UseNewNoteDialogParams {
  config: { notebooks: NotebookConfig[]; } | null;
  selectedNotebookId: string;
  setSelectedNotebookId: (id: string) => void;
  folders: FolderItem[];
  remote: boolean;
  canWrite: boolean;
  readDraft: WorkspaceState['readDraft'];
  queryClient: QueryClient;
  queryScope: NoteQueryScope;
  stageWorkingNote: (note: NoteItem, base: NoteItem | null) => NoteItem;
  revisionFor: WorkspaceState['revisionFor'];
  invalidateNotes: () => void;
  setGitStatus: (status: GitStatus) => void;
  newNoteStatuses: string[];
  sourceId: string;
  t: I18nContextValue['t'];
  onCreated: (note: NoteItem) => void;
}

export interface NewNoteOptions {
  status?: string;
  folder?: string;
  tag?: string;
  tags?: string[];
  notebookId?: string;
  kind?: 'note' | 'outline';
  initialLink?: Pick<NoteItem, 'notebookId' | 'path' | 'title'>;
}

/** Create New Note dialog: its form state, and the handlers that render or persist a new note draft. */
export function useNewNoteDialog({ config, selectedNotebookId, setSelectedNotebookId, folders, remote, canWrite, readDraft, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, newNoteStatuses, sourceId, t, onCreated }: UseNewNoteDialogParams) {
  const [createError, setCreateError] = useState('');
  const [creation, setCreation] = useState<NewNoteOptions>({});
  const [creating, setCreating] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  useLayoutEffect(() => () => {
    generation.current++;
  }, []);
  const latest = useRef({ sourceId, selectedNotebookId, canWrite, config, queryScope });
  const scopeKey = JSON.stringify([sourceId, selectedNotebookId, canWrite, queryScope.repositories[selectedNotebookId], config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root]);
  const requestScope = useRef(scopeKey);
  useLayoutEffect(() => {
    if (requestScope.current !== scopeKey) generation.current++;
    requestScope.current = scopeKey;
    latest.current = { sourceId, selectedNotebookId, canWrite, config, queryScope };
  }, [scopeKey, sourceId, selectedNotebookId, canWrite, config, queryScope]);
  const newNoteKind = creation.kind ?? 'note';
  const [isNewNoteOpen, setIsNewNoteOpen] = useState<boolean>(false);
  const [previousSourceId, setPreviousSourceId] = useState(sourceId);
  if (previousSourceId !== sourceId) {
    setPreviousSourceId(sourceId);
    setIsNewNoteOpen(false);
  }
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
  const openNewNote = (options?: string | NewNoteOptions) => {
    generation.current++;
    const opts = typeof options === 'string' ? { status: options } : { ...options };
    if (opts.notebookId && opts.notebookId !== selectedNotebookId && config?.notebooks.some(n => n.id === opts.notebookId)) {
      setSelectedNotebookId(opts.notebookId);
    }
    setCreation({ ...opts, notebookId: opts.notebookId ?? selectedNotebookId });
    setNewNoteTitle('');
    setNewNoteStatus(opts.status || newNoteStatuses[0]);
    setNewNoteFolder(opts.folder || '');
    setNewNoteTags(opts.tags || (opts.tag ? [opts.tag] : []));
    setNewNoteTemplateId('');
    setCreateError('');
    setIsNewNoteOpen(true);
  };

  const cancelNewNote = () => {
    generation.current++;
    setIsNewNoteOpen(false);
  };
  const handleCreateNewNote = async (statusOverride?: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setCreating(true);
    const request = generation.current;
    const currentRequest = () => request === generation.current && latest.current.sourceId === sourceId && latest.current.selectedNotebookId === selectedNotebookId && latest.current.queryScope.repositories[selectedNotebookId] === queryScope.repositories[selectedNotebookId] && latest.current.config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root === config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root;
    try {
      setCreateError('');
      if (!canWrite) throw new Error('This workspace is read-only.');
      if (creation.notebookId && creation.notebookId !== selectedNotebookId) throw new Error(t('outline.changed'));
      const title = newNoteTitle.trim() || 'Untitled Note';
      const slug = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'untitled';

      const currentNotebook = config?.notebooks.find((n) => n.id === selectedNotebookId);
      if (!currentNotebook) throw new Error(t('outline.changed'));
      const root = currentNotebook.root;
      const folder = newNoteFolder.trim().replace(/^\/+|\/+$/g, '');
      if (folder && !newNoteFolders.includes(folder)) throw new Error(t('createNote.invalidFolder'));
      const notePath = [root, folder, `${slug}${newNoteKind === 'outline' ? OUTLINE_SUFFIX : '.md'}`].filter(Boolean).join('/');
      const taken = Boolean(remote && readDraft(currentNotebook.id, notePath)) || (await queryClient.fetchQuery(noteLookupOptions(queryScope, [{ notebookId: currentNotebook.id, path: notePath }], false))).notes.length > 0;
      if (taken) throw new Error('A note with this filename already exists in this folder. Choose another title.');

      const status = statusOverride || newNoteStatus;
      const template = newNoteKind === 'note' && newNoteTemplateId ? await renderNoteTemplate({ notebookId: currentNotebook.id, templateId: newNoteTemplateId, title }) : undefined;
      const draft = buildNewNoteDraft({ slug, title, tags: newNoteTags, status, template });
      if (creation.initialLink && creation.initialLink.notebookId !== currentNotebook.id) throw new Error(t('outline.changed'));
      const initialContent = newNoteKind === 'outline' ? `- ${creation.initialLink ? noteMarkdownLink(notePath, creation.initialLink.path, creation.initialLink.title) : ''}` : draft.content;
      const finalStatus = draft.status;
      const initialMetadata = withNoteStatus(draft.metadata, finalStatus);

      if (!currentRequest()) return;
      if (!latest.current.canWrite) throw new Error(t('outline.readOnly'));
      const res = remote ? { note: stageWorkingNote({ ...(newNoteKind === 'outline' ? { kind: 'outline' as const } : {}), id: slug, path: notePath, notebookId: currentNotebook.id, title, content: initialContent, metadata: initialMetadata, status: finalStatus, tags: Array.isArray(initialMetadata.tags) ? initialMetadata.tags.map(String) : [], revision: revisionFor(currentNotebook.id) }, null) } : await saveNote({ path: notePath, notebookId: currentNotebook.id, createOnly: true, content: initialContent, metadata: initialMetadata, noCommit: true });
      if (!remote) invalidateNotes();
      if (!currentRequest()) return;

      setIsNewNoteOpen(false);
      setNewNoteTitle('');
      setNewNoteFolder('');
      setNewNoteTags([]);
      setNewNoteTemplateId('');
      setNewNoteStatus(newNoteStatuses[0]);
      onCreated(res.note);
      // Creation has already succeeded; a status refresh failure must not invite a duplicate retry.
      void fetchGitStatus().then(statusRes => {
        if (currentRequest()) setGitStatus(statusRes.status);
      }).catch(() => {});
    } catch (error) {
      if (currentRequest()) setCreateError((error as Error).message);
    } finally {
      submitting.current = false;
      setCreating(false);
    }
  };

  return { newNoteKind, creating, cancelNewNote, createError, setCreateError, isNewNoteOpen, setIsNewNoteOpen, newNoteTitle, setNewNoteTitle, newNoteStatus, setNewNoteStatus, newNoteTags, setNewNoteTags, newNoteTemplateId, setNewNoteTemplateId, newNoteTemplates, handleTemplateChange, openNewNote, handleCreateNewNote };
}
