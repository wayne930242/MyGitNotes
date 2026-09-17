import type { QueryClient } from '@tanstack/react-query';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import { notePageOptions, useNoteList, type NoteQueryScope } from './use-note-queries.js';
import { overlayDraftRows } from './draft-overlay.js';
import { noteQueryInput } from './use-note-queries.js';
import { useDebounced } from './use-debounced.js';

/** How many link candidates the editors offer. */
export const NOTE_COMPLETION_LIMIT = 12;

export function noteCompletionAt(text: string, position: number) {
  const before = text.slice(0, position), lines = before.split('\n');
  let fence = '';
  for (const line of lines.slice(0, -1)) { const mark = line.match(/^\s*(`{3,}|~{3,})/); if (mark) { if (!fence) fence = mark[1][0]; else if (mark[1][0] === fence) fence = ''; } }
  if (fence) return null;
  const line = lines.at(-1) || '';
  const match = line.match(/(^|[^!])\[(?:\\.|[^\]\\])*\]\(([^)\n]*)$/);
  if (!match) return null;
  const prefix = line.slice(0, (match.index || 0) + match[1].length);
  if ((prefix.match(/`/g) || []).length % 2) return null;
  return { from: before.length - match[2].length, to: before.length, query: match[2] };
}
const candidateQuery = (query: string, source: string) => ({
  notebookId: 'all', q: query, match: 'title' as const, showHidden: false, exclude: [source],
});

/** Link candidates for an editor that completes outside React rendering (CodeMirror). */
export async function fetchNoteCandidates(client: QueryClient, scope: NoteQueryScope, query: string, source: string): Promise<NoteListItem[]> {
  const input = noteQueryInput(candidateQuery(query, source));
  const page = await client.fetchQuery(notePageOptions(scope, input, { limit: NOTE_COMPLETION_LIMIT }));
  const overlay = overlayDraftRows(page.notes, input, scope.drafts);
  return [...overlay.uncommitted, ...overlay.notes].slice(0, NOTE_COMPLETION_LIMIT);
}

/** Link candidates for `query`, matched by the server against title, path and notebook. */
export function useNoteCandidates(query: string | null, source: string): NoteListItem[] {
  const settled = useDebounced(query ?? '');
  const result = useNoteList(query === null ? null : candidateQuery(settled, source), { limit: NOTE_COMPLETION_LIMIT });
  // A note staged but not committed is still a link target.
  return [...result.uncommitted, ...result.notes].slice(0, NOTE_COMPLETION_LIMIT);
}
