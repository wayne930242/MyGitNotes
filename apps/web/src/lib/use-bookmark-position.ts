import { type RefObject, useEffect, useRef } from 'react';
import { resolveTextAnchor } from '@mygitnotes/core/bookmark-anchor';
import type { MarkdownEditorHandle } from '../components/MarkdownEditor.js';
import type { NoteItem } from './types.js';
import { useBookmarkActionsContext } from './bookmark-context.js';

/** Consumes only the request for this mounted owner, rematching its actual session body. */
export function useBookmarkPosition(note: NoteItem, content: string, editor: RefObject<MarkdownEditorHandle>) {
  const actions = useBookmarkActionsContext();
  const latest = useRef(actions);
  /* eslint-disable react/refs -- The reveal request retains a stable effect identity while its callback sees the live controller. */
  latest.current = actions;
  /* eslint-enable react/refs */
  const request = actions?.position;
  useEffect(() => {
    if (!request || request.notebookId !== note.notebookId || request.path !== note.path) return;
    let frame = 0;
    const deadline = performance.now() + 5000;
    const reveal = () => {
      if (latest.current?.position?.id !== request.id) return;
      if (!editor.current?.ready()) {
        if (performance.now() < deadline) {
          frame = requestAnimationFrame(reveal);
          return;
        }
        latest.current.consumePosition(request.id, false);
        return;
      }
      const result = resolveTextAnchor(content, request.anchor);
      if (result.state === 'resolved') editor.current.revealRange(result.range.from, result.range.to, true);
      latest.current.consumePosition(request.id, result.state === 'resolved');
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [request, note.notebookId, note.path, content, editor]);
}
