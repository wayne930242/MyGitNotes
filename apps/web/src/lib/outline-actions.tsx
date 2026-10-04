import { createContext, type RefObject, useContext, useEffect } from 'react';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import type { NoteItem } from './types.js';
import type { MarkdownEditorHandle } from '../components/MarkdownEditor.js';
import type { NoteEditorSessionState } from '../components/note-editor/useNoteEditorSession.js';
import { outlineLinkInsertion } from './outline-insertion.js';
import { useTranslation } from './i18n/index.js';

export interface OutlineInsertionRequest {
  id: number;
  destination: NoteRef;
  source: NoteRef & { title: string; };
}

export interface OutlineActions {
  add: (source: NoteItem) => void;
  canAdd: (notebookId: string) => boolean;
  pending: OutlineInsertionRequest | null;
  /** Synchronously claims the request, checking its live repository and route identity. */
  consume: (id: number) => boolean;
  cancel: () => void;
  error: (message: string) => void;
}

const Context = createContext<OutlineActions | null>(null);
export const OutlineActionsProvider = Context.Provider;
export const useOutlineActions = () => useContext(Context);

/** Only the mounted, initialized owner can edit the current body, including recovered drafts. */
export function useOutlineInsertion(note: NoteItem, session: NoteEditorSessionState, editor: RefObject<MarkdownEditorHandle | null>) {
  const actions = useOutlineActions();
  const { t } = useTranslation();
  const pending = actions?.pending;
  const matches = pending && noteRefKey(pending.destination) === noteRefKey(note);
  useEffect(() => {
    if (!actions || !pending || !matches || !session.ready || session.recoveredDraft) return;
    if (session.locked) {
      if (actions.consume(pending.id)) actions.error(t('outline.readOnly'));
      return;
    }
    let frame = 0;
    const insert = () => {
      // Live Markdown is lazy-loaded; wait for its actual imperative editor, not a placeholder.
      if (!editor.current?.ready()) {
        frame = requestAnimationFrame(insert);
        return;
      }
      const change = outlineLinkInsertion(session.content, note.path, pending.source);
      if (!actions.consume(pending.id)) return;
      if (!change) {
        actions.error(t('outline.unsafeEnd'));
        return;
      }
      editor.current.insert(change.text, change.at);
    };
    frame = requestAnimationFrame(insert);
    return () => cancelAnimationFrame(frame);
  }, [actions, pending, matches, session.ready, session.recoveredDraft, session.locked, session.content, note.path, editor, t]);
  return Boolean(matches && session.recoveredDraft);
}
