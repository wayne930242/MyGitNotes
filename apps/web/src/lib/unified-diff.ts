import { diffIndices, type IDiffIndicesResult } from 'node-diff3';

export interface UnifiedDiffOptions {
  context?: number;
}

interface DiffHunk {
  changes: IDiffIndicesResult<string>[];
  oldStart: number;
  oldEnd: number;
}

/**
 * Generates a unified diff string between old and new text.
 * Returns an empty string if there are no differences.
 */
export function createUnifiedDiff(oldPath: string, newPath: string, oldStr: string | null | undefined, newStr: string | null | undefined, options?: UnifiedDiffOptions): string {
  if (oldStr === newStr) return '';
  // Retain terminators so a final-newline change is compared as part of its line.
  const splitLines = (text: string | null | undefined) => text?.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const oldLines = splitLines(oldStr);
  const newLines = splitLines(newStr);
  const context = options?.context ?? 3;
  if (!Number.isInteger(context) || context < 0) {
    throw new RangeError('Diff context must be a non-negative integer.');
  }

  const rawChanges = diffIndices(oldLines, newLines);
  if (rawChanges.length === 0) return '';

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (const change of rawChanges) {
    const s1 = change.buffer1[0];
    const len1 = change.buffer1[1];

    if (!currentHunk) {
      currentHunk = { changes: [change], oldStart: Math.max(0, s1 - context), oldEnd: Math.min(oldLines.length, s1 + len1 + context) };
    } else {
      const nextOldStart = Math.max(0, s1 - context);
      if (nextOldStart <= currentHunk.oldEnd) {
        currentHunk.changes.push(change);
        currentHunk.oldEnd = Math.min(oldLines.length, s1 + len1 + context);
      } else {
        hunks.push(currentHunk);
        currentHunk = { changes: [change], oldStart: Math.max(0, s1 - context), oldEnd: Math.min(oldLines.length, s1 + len1 + context) };
      }
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  const fileHeader = `--- ${oldStr == null ? '/dev/null' : oldPath}\n+++ ${newStr == null ? '/dev/null' : newPath}`;
  const hunkTexts = hunks.map(hunk => {
    const firstChange = hunk.changes[0];
    const lastChange = hunk.changes[hunk.changes.length - 1];
    const leadContext = firstChange.buffer1[0] - hunk.oldStart;
    const trailContext = hunk.oldEnd - (lastChange.buffer1[0] + lastChange.buffer1[1]);

    const newStart = firstChange.buffer2[0] - leadContext;
    const newEnd = (lastChange.buffer2[0] + lastChange.buffer2[1]) + trailContext;

    const lines: string[] = [];
    const appendLine = (prefix: string, line: string) => {
      if (line.endsWith('\n')) lines.push(prefix + line.slice(0, -1));
      else lines.push(prefix + line, '\\ No newline at end of file');
    };
    let curOld = hunk.oldStart;
    let curNew = newStart;

    for (const change of hunk.changes) {
      while (curOld < change.buffer1[0]) {
        appendLine(' ', oldLines[curOld]);
        curOld++;
        curNew++;
      }
      for (let i = 0; i < change.buffer1[1]; i++) {
        appendLine('-', oldLines[curOld]);
        curOld++;
      }
      for (let i = 0; i < change.buffer2[1]; i++) {
        appendLine('+', newLines[curNew]);
        curNew++;
      }
    }
    while (curOld < hunk.oldEnd) {
      appendLine(' ', oldLines[curOld]);
      curOld++;
      curNew++;
    }

    const oldCount = hunk.oldEnd - hunk.oldStart;
    const newCount = newEnd - newStart;
    const oldHunkStart = oldCount === 0 ? hunk.oldStart : hunk.oldStart + 1;
    const newHunkStart = newCount === 0 ? newStart : newStart + 1;
    const hunkHeader = `@@ -${oldHunkStart},${oldCount} +${newHunkStart},${newCount} @@`;
    return `${hunkHeader}\n${lines.join('\n')}`;
  });

  return `${fileHeader}\n${hunkTexts.join('\n')}\n`;
}
