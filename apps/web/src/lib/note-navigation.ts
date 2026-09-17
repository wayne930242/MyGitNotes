export interface TextMatch {
  from: number;
  to: number;
}

export interface OutlineHeading {
  depth: number;
  label: string;
  line: number;
  from: number;
}

export function findOutlineIndexForLine(outline: OutlineHeading[], line: number): number {
  if (outline.length === 0) return 0;
  let active = 0;
  for (let index = 0; index < outline.length; index += 1) {
    if (outline[index].line > line) break;
    active = index;
  }
  return active;
}

export function findTextMatches(content: string, query: string): TextMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const haystack = content.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  for (let from = 0; from <= haystack.length - normalizedNeedle.length;) {
    const match = haystack.indexOf(normalizedNeedle, from);
    if (match < 0) break;
    matches.push({ from: match, to: match + normalizedNeedle.length });
    from = match + normalizedNeedle.length;
  }
  return matches;
}

function headingLabel(source: string) {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*{}\[\]()#+.!_>-])/g, '$1')
    .trim();
}

export function parseMarkdownOutline(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = content.split('\n');
  let offset = 0;
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      offset += line.length + (index < lines.length - 1 ? 1 : 0);
      continue;
    }

    if (!fence) {
      const atx = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (atx) {
        const label = headingLabel(atx[2]);
        if (label) headings.push({ depth: atx[1].length, label, line: index + 1, from: offset });
      } else if (index + 1 < lines.length && line.trim()) {
        const setext = lines[index + 1].match(/^\s{0,3}(=+|-+)\s*$/);
        if (setext) {
          const label = headingLabel(line.trim());
          if (label) headings.push({ depth: setext[1][0] === '=' ? 1 : 2, label, line: index + 1, from: offset });
        }
      }
    }

    offset += line.length + (index < lines.length - 1 ? 1 : 0);
  }
  return headings;
}

export interface OutlineSelectionResult {
  heading: OutlineHeading;
  line: number;
  shouldClosePanel: boolean;
  focusEditor: boolean;
}

export function chooseOutlineHeading(
  outline: OutlineHeading[],
  index: number,
  options: { closeAfter?: boolean; focusEditor?: boolean } = {},
): OutlineSelectionResult | null {
  const heading = outline[index];
  if (!heading) return null;
  return {
    heading,
    line: heading.line,
    shouldClosePanel: options.closeAfter ?? false,
    focusEditor: options.focusEditor ?? false,
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  return typeof Element !== 'undefined'
    && target instanceof Element
    && Boolean(target.closest('input, textarea, select, [role="combobox"], [contenteditable="true"], .cm-content'));
}

