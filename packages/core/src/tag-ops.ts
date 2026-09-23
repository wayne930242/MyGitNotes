/** The minimal shape a plan function needs from a note; matches `NoteItem` structurally. */
export interface TaggedNote {
  path: string;
  notebookId: string;
  tags: string[];
}

export interface TagOperationEntry {
  path: string;
  notebookId: string;
  previousTags: string[];
  nextTags: string[];
}

export interface TagOperationPlan {
  affected: TagOperationEntry[];
}

/** Remove `from` and ensure `to` is present exactly once, at `from`'s original position. */
export function retagList(tags: string[], from: string, to: string): string[] {
  if (!tags.includes(from)) return tags;
  const withoutFrom = tags.filter(tag => tag !== from);
  if (withoutFrom.includes(to)) return withoutFrom;
  const insertAt = tags.indexOf(from);
  const result = withoutFrom.slice();
  result.splice(insertAt, 0, to);
  return result;
}

function planRetag(notes: TaggedNote[], from: string, to: string): TagOperationPlan {
  if (from === to) throw new Error('The source and target tag must be different.');
  const affected: TagOperationEntry[] = [];
  for (const note of notes) {
    if (!note.tags.includes(from)) continue;
    affected.push({ path: note.path, notebookId: note.notebookId, previousTags: note.tags, nextTags: retagList(note.tags, from, to) });
  }
  return { affected };
}

/** Rename `from` to `to` across every note that carries `from`. */
export function planTagRename(notes: TaggedNote[], from: string, to: string): TagOperationPlan {
  return planRetag(notes, from, to);
}

/** Merge `from` into `into`: every note with `from` loses it and gains `into` exactly once. */
export function planTagMerge(notes: TaggedNote[], from: string, into: string): TagOperationPlan {
  return planRetag(notes, from, into);
}

/** Add `tag` to every note that doesn't already carry it. */
export function planTagAdd(notes: TaggedNote[], tag: string): TagOperationPlan {
  const affected: TagOperationEntry[] = [];
  for (const note of notes) {
    if (note.tags.includes(tag)) continue;
    affected.push({ path: note.path, notebookId: note.notebookId, previousTags: note.tags, nextTags: [...note.tags, tag] });
  }
  return { affected };
}

/** Remove `tag` from every note in the given list that carries it. */
export function planTagDelete(notes: TaggedNote[], tag: string): TagOperationPlan {
  const affected: TagOperationEntry[] = [];
  for (const note of notes) {
    if (!note.tags.includes(tag)) continue;
    affected.push({ path: note.path, notebookId: note.notebookId, previousTags: note.tags, nextTags: note.tags.filter(t => t !== tag) });
  }
  return { affected };
}

/** Swap previous/next per entry, to undo a plan already applied. */
export function invertTagOperationPlan(plan: TagOperationPlan): TagOperationPlan {
  return { affected: plan.affected.map(entry => ({ ...entry, previousTags: entry.nextTags, nextTags: entry.previousTags })) };
}
