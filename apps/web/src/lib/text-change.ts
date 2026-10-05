/**
 * The smallest single replacement that turns `before` into `after`: the span between their common prefix and
 * common suffix. An editor that applies only this span keeps its scroll position, caret and selection, which a
 * whole-document replacement would reset.
 */
export function textChange(before: string, after: string): { from: number; to: number; insert: string; } | null {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  // Never split a surrogate pair: back off to the start of a pair the prefix would cut.
  if (start > 0 && (isLowSurrogate(before.charCodeAt(start)) || isLowSurrogate(after.charCodeAt(start)))) start--;
  let end = 0;
  while (end < limit - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;
