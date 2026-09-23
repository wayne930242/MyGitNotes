export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Splits `text` around case-insensitive occurrences of `query`; a blank query returns `text` as one unmatched segment. */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (!needle) return [{ text, match: false }];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (let index = lowerText.indexOf(lowerNeedle); index !== -1; index = lowerText.indexOf(lowerNeedle, cursor)) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (!segments.length) return [{ text, match: false }];
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
