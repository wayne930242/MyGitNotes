export type R2PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'file';

const PREVIEW_TYPES: Record<string, [R2PreviewKind, string]> = { pdf: ['pdf', 'application/pdf'], png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], avif: ['image', 'image/avif'], mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'], mov: ['video', 'video/quicktime'], mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], ogg: ['audio', 'audio/ogg'], wav: ['audio', 'audio/wav'], flac: ['audio', 'audio/flac'] };

/** Rejects keys that could escape the configured bucket: absolute paths and `.`/`..`/empty segments. */
export function isValidR2Key(key: string): boolean {
  if (!key || key.startsWith('/')) return false;
  return key.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

/** Returns the R2 object key of an `r2:` reference, or null for any other href or an unsafe key. */
export function parseR2Reference(href: string): string | null {
  const match = /^r2:(.+)$/i.exec(href.trim());
  if (!match) return null;
  let key: string;
  try {
    key = decodeURIComponent(match[1]);
  } catch {
    key = match[1];
  }
  return isValidR2Key(key) ? key : null;
}

const INLINE_REFERENCE = /\]\(\s*(?:<(r2:[^>\n]+)>|(r2:[^\s)]+))/gi;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:\s*(?:<(r2:[^>\n]+)>|(r2:\S+))/gim;
const HTML_ATTRIBUTE = /(?:src|href)\s*=\s*(?:"(r2:[^"\n]+)"|'(r2:[^'\n]+)')/gi;

/**
 * Lists the R2 keys referenced by a note's Markdown, matching every form the renderer turns
 * into a `/r2-assets/...` request: inline links/images, reference-style link definitions, and
 * raw HTML `src`/`href` attributes.
 */
export function r2ReferenceKeys(markdown: string): string[] {
  const keys = new Set<string>();
  for (const pattern of PATTERNS()) {
    for (const match of markdown.matchAll(pattern)) {
      for (const group of match.slice(1)) {
        if (!group) continue;
        const key = parseR2Reference(group);
        if (key) keys.add(key);
      }
    }
  }
  return [...keys];
}

const PATTERNS = () => [INLINE_REFERENCE, REFERENCE_DEFINITION, HTML_ATTRIBUTE];

/** Bucket prefix that holds a notebook's managed R2 objects. */
export function r2NotebookPrefix(notebookId: string): string {
  return `${notebookId}/`;
}

/** True when `key` is a safe object key inside the notebook's managed prefix. */
export function isNotebookR2Key(key: string, notebookId: string): boolean {
  return isValidR2Key(key) && key.startsWith(r2NotebookPrefix(notebookId)) && key.length > r2NotebookPrefix(notebookId).length;
}

/**
 * Rewrites `r2:` references whose key appears in `moves` to the mapped key, covering the same
 * forms as `r2ReferenceKeys`. Angle-bracket and HTML forms keep raw keys; bare forms stay percent-encoded.
 */
export function rewriteR2References(markdown: string, moves: Record<string, string>): string {
  let next = markdown;
  for (const pattern of PATTERNS()) {
    next = next.replace(pattern, (all: string, ...groups: unknown[]) => {
      const [first, second] = groups as (string | undefined)[];
      const reference = first ?? second;
      const key = reference ? parseR2Reference(reference) : null;
      if (!reference || key === null || !(key in moves)) return all;
      const bare = pattern !== HTML_ATTRIBUTE && first === undefined;
      const target = bare ? moves[key].split('/').map(part => encodeURIComponent(part).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/') : moves[key].replace(/[<>"']/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      return all.replace(reference, `r2:${target}`);
    });
  }
  return next;
}

export function r2PreviewType(key: string): { kind: R2PreviewKind; contentType: string; } {
  const [kind, contentType] = PREVIEW_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? ['file', 'application/octet-stream'];
  return { kind, contentType };
}

/** Markdown that embeds a previewable object or links any other one, angle-bracketed so spaces survive. */
export function r2Reference(key: string): string {
  const label = (key.split('/').pop() || key).replace(/[\\[\]]/g, '\\$&');
  return `${r2PreviewType(key).kind === 'file' ? '' : '!'}[${label}](<r2:${key}>)`;
}

/** Same-origin URL that authorizes the reference against its note before redirecting to the object. */
export function r2AssetUrl(key: string, notePath: string): string {
  return `/r2-assets/${key.split('/').map(encodeURIComponent).join('/')}?note=${encodeURIComponent(notePath)}`;
}
