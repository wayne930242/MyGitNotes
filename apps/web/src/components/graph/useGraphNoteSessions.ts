import { useRef, useState } from 'react';
import { insertNoteLink } from '@mygitnotes/core/note-graph';
import { useNoteEditing } from '../../lib/note-editing.js';
import type { I18nContextValue } from '../../lib/i18n/index.js';
import type { NoteEditorHandle, NoteEditorSession } from '../NoteEditor.js';

/** Expanded cards host the notes' editors; their sessions drive the pending edges and link insertion. */
export function useGraphNoteSessions({ t, onNotice }: { t: I18nContextValue['t']; onNotice: (message: string) => void; }) {
  const editing = useNoteEditing();
  const [sessions, setSessions] = useState(() => new Map<string, NoteEditorSession>());
  const updateSession = (path: string, session: NoteEditorSession | null) =>
    setSessions(previous => {
      const next = new Map(previous);
      if (session) next.set(path, session);
      else next.delete(path);
      return next;
    });
  const handles = useRef(new Map<string, NoteEditorHandle>()), editorRefs = useRef(new Map<string, (handle: NoteEditorHandle | null) => void>());
  const editorRef = (path: string) => {
    let ref = editorRefs.current.get(path);
    if (!ref) {
      ref = handle => {
        if (handle) handles.current.set(path, handle);
        else handles.current.delete(path);
      };
      editorRefs.current.set(path, ref);
    }
    return ref;
  };
  const carets = useRef(new Map<string, number>());
  const link = (source: string, target: { path: string; title: string; }) => {
    const session = sessions.get(source), handle = handles.current.get(source);
    if (!session || session.locked || !handle) return;
    const result = insertNoteLink(session.content, source, target.path, target.title, carets.current.get(source));
    if (result.content === session.content) {
      onNotice(t('graph.linkExists'));
      return;
    }
    const at = result.position - (result.content.length - session.content.length);
    handle.insert(result.content.slice(at, result.position), at);
    carets.current.set(source, result.position);
    onNotice(t('graph.linkAdded'));
  };
  return { editing, sessions, updateSession, editorRef, carets, link };
}
