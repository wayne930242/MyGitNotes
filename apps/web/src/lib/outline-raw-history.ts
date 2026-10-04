export interface OutlineRawSnapshot {
  content: string;
  anchor: number;
  head: number;
}
interface Entry {
  before: OutlineRawSnapshot;
  after: OutlineRawSnapshot;
}

/** Textareas do not put controlled value assignments on their native undo stack. Scoped to outline raw mode. */
export class OutlineRawHistory {
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];

  record(before: OutlineRawSnapshot, after: OutlineRawSnapshot): void {
    if (before.content === after.content) return;
    if (this.undoEntries.length && this.undoEntries.at(-1)!.after.content !== before.content) this.undoEntries = [];
    this.undoEntries.push({ before, after });
    if (this.undoEntries.length > 100) this.undoEntries.shift();
    this.redoEntries = [];
  }

  undo(content: string): OutlineRawSnapshot | null {
    const entry = this.undoEntries.at(-1);
    if (!entry || entry.after.content !== content) return null;
    this.undoEntries.pop();
    this.redoEntries.push(entry);
    return entry.before;
  }

  redo(content: string): OutlineRawSnapshot | null {
    const entry = this.redoEntries.at(-1);
    if (!entry || entry.before.content !== content) return null;
    this.redoEntries.pop();
    this.undoEntries.push(entry);
    return entry.after;
  }
}
