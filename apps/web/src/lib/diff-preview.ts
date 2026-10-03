export interface DiffLine {
  text: string;
  kind: 'header' | 'range' | 'context' | 'added' | 'removed';
  oldLine?: number;
  newLine?: number;
}

export function parseDiffPreview(diff: string) {
  let oldLine = 0, newLine = 0, inHunk = false, added = 0, removed = 0;
  const lines: DiffLine[] = diff.replace(/\n$/, '').split('\n').map(text => {
    const range = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (range) {
      oldLine = Number(range[1]);
      newLine = Number(range[2]);
      inHunk = true;
      return { text, kind: 'range' };
    }
    if (text.startsWith('diff ') || text.startsWith('--- ') && !inHunk) inHunk = false;
    if (inHunk && text.startsWith('+')) {
      added++;
      return { text, kind: 'added', newLine: newLine++ };
    }
    if (inHunk && text.startsWith('-')) {
      removed++;
      return { text, kind: 'removed', oldLine: oldLine++ };
    }
    if (inHunk && text.startsWith(' ')) return { text, kind: 'context', oldLine: oldLine++, newLine: newLine++ };
    return { text, kind: 'header' };
  });
  const notice = /^Binary (?:files? |file added\.)/m.test(diff) ? 'binary' : diff === 'File exceeds the 1 MiB preview limit.' ? 'tooLarge' : undefined;
  return { lines, added, removed, notice };
}

export interface DiffStats {
  added: number;
  removed: number;
}

/** Added and removed line counts of a unified diff; null when it is empty or has no line preview (binary or too large). */
export function diffStats(diff: string): DiffStats | null {
  if (!diff) return null;
  const { added, removed, notice } = parseDiffPreview(diff);
  return notice ? null : { added, removed };
}
