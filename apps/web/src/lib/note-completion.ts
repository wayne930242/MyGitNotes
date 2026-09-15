import type { NoteItem } from './types.js';
import { isNoteHidden } from '@mygitnotes/core/note-status';

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
export function noteCandidates(notes: NoteItem[], query: string, source: string) {
  const needle = query.trim().toLocaleLowerCase();
  return notes.filter(note => note.path !== source && !isNoteHidden({ ...note.metadata, status: note.status }) && `${note.title} ${note.path} ${note.notebookId}`.toLocaleLowerCase().includes(needle)).slice(0, 12);
}
