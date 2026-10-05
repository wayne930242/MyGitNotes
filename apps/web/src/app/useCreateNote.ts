import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

interface UseCreateNoteParams {
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
  onError: (message: string) => void;
}

export interface NewNoteOptions {
  status?: string;
  /** A compilation lane's source folder, so the note joins that lane; otherwise the note starts at the notebook root. */
  folder?: string;
  tag?: string;
  tags?: string[];
  notebookId?: string;
  kind?: 'note' | 'outline';
  templateId?: string;
  initialLink?: Pick<NoteItem, 'notebookId' | 'path' | 'title'>;
}

/** The stem every new note starts from; the editor's Rename gives it a name. */
export const UNTITLED_STEM = 'untitled';
/** How many numbered names are looked up at once before creation gives up. */
const CANDIDATES = 20;

/** `untitled<suffix>`, then `untitled-2<suffix>` … in `directory`. */
export function untitledCandidates(directory: string, suffix: string, count = CANDIDATES): string[] {
  return Array.from({ length: count }, (_, index) => `${directory}/${UNTITLED_STEM}${index ? `-${index + 1}` : ''}${suffix}`);
}

/** Creates a note, outline or templated note at once, with default values, and opens it. */
export function useCreateNote({ config, selectedNotebookId, setSelectedNotebookId, folders, remote, canWrite, readDraft, queryClient, queryScope, stageWorkingNote, revisionFor, invalidateNotes, setGitStatus, newNoteStatuses, sourceId, t, onCreated, onError }: UseCreateNoteParams) {
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

  const pending = useRef<NewNoteOptions | null>(null);
  const createNote = async (options?: string | NewNoteOptions) => {
    const opts: NewNoteOptions = typeof options === 'string' ? { status: options } : { ...options };
    // Creating in another notebook switches to it first; the note is made once that notebook is the selected one.
    if (opts.notebookId && opts.notebookId !== selectedNotebookId) {
      if (!config?.notebooks.some(n => n.id === opts.notebookId)) return onError(t('outline.changed'));
      pending.current = opts;
      setSelectedNotebookId(opts.notebookId);
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setCreating(true);
    const request = ++generation.current;
    const currentRequest = () => request === generation.current && latest.current.sourceId === sourceId && latest.current.selectedNotebookId === selectedNotebookId && latest.current.queryScope.repositories[selectedNotebookId] === queryScope.repositories[selectedNotebookId] && latest.current.config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root === config?.notebooks.find(nb => nb.id === selectedNotebookId)?.root;
    try {
      onError('');
      if (!canWrite) throw new Error('This workspace is read-only.');
      const kind = opts.kind ?? 'note';
      const notebook = config?.notebooks.find(n => n.id === selectedNotebookId);
      if (!notebook) throw new Error(t('outline.changed'));
      const folder = (opts.folder ?? '').trim().replace(/^\/+|\/+$/g, '');
      if (folder && !folders.some(item => item.notebookId === notebook.id && item.path === folder)) throw new Error(t('createNote.invalidFolder'));
      const directory = [notebook.root.replace(/\/$/, ''), folder].filter(Boolean).join('/');
      const candidates = untitledCandidates(directory, kind === 'outline' ? OUTLINE_SUFFIX : '.md');
      const existing = new Set((await queryClient.fetchQuery(noteLookupOptions(queryScope, candidates.map(path => ({ notebookId: notebook.id, path })), false))).notes.map(note => note.path));
      const notePath = candidates.find(path => !existing.has(path) && !(remote && readDraft(notebook.id, path)));
      if (!notePath) throw new Error(t('createNote.tooManyUntitled'));
      const slug = notePath.slice(notePath.lastIndexOf('/') + 1).replace(kind === 'outline' ? OUTLINE_SUFFIX : '.md', '');
      const title = t('createNote.untitled');
      const status = opts.status || newNoteStatuses[0];
      const tags = opts.tags || (opts.tag ? [opts.tag] : []);
      const template = kind === 'note' && opts.templateId ? await renderNoteTemplate({ notebookId: notebook.id, templateId: opts.templateId, title }) : undefined;
      const draft = buildNewNoteDraft({ slug, title, tags, status, template });
      if (opts.initialLink && opts.initialLink.notebookId !== notebook.id) throw new Error(t('outline.changed'));
      const content = kind === 'outline' ? `- ${opts.initialLink ? noteMarkdownLink(notePath, opts.initialLink.path, opts.initialLink.title) : ''}` : draft.content;
      // A note takes its title from its heading, so editing the heading renames it; an outline has no heading to read.
      const { title: _title, ...untitled } = draft.metadata;
      const metadata = withNoteStatus(kind === 'outline' || template ? draft.metadata : untitled, draft.status);

      if (!currentRequest()) return;
      if (!latest.current.canWrite) throw new Error(t('outline.readOnly'));
      const res = remote ? { note: stageWorkingNote({ ...(kind === 'outline' ? { kind: 'outline' as const } : {}), id: slug, path: notePath, notebookId: notebook.id, title, content, metadata, status: draft.status, tags: Array.isArray(metadata.tags) ? metadata.tags.map(String) : [], revision: revisionFor(notebook.id) }, null) } : await saveNote({ path: notePath, notebookId: notebook.id, createOnly: true, content, metadata, noCommit: true });
      if (!remote) invalidateNotes();
      if (!currentRequest()) return;
      onCreated(res.note);
      // Creation has already succeeded; a status refresh failure must not invite a duplicate retry.
      void fetchGitStatus().then(statusRes => {
        if (currentRequest()) setGitStatus(statusRes.status);
      }).catch(() => {});
    } catch (error) {
      if (currentRequest()) onError((error as Error).message);
    } finally {
      submitting.current = false;
      setCreating(false);
    }
  };

  useEffect(() => {
    if (pending.current?.notebookId !== selectedNotebookId) return;
    const opts = pending.current;
    pending.current = null;
    void createNote(opts);
  });

  return { creating, createNote };
}
