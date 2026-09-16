export type R2PreviewKind = 'pdf' | 'image' | 'video' | 'audio' | 'file';

const PREVIEW_TYPES: Record<string, [R2PreviewKind, string]> = {
  pdf: ['pdf', 'application/pdf'],
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'],
  webp: ['image', 'image/webp'], avif: ['image', 'image/avif'],
  mp4: ['video', 'video/mp4'], webm: ['video', 'video/webm'], mov: ['video', 'video/quicktime'],
  mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], ogg: ['audio', 'audio/ogg'], wav: ['audio', 'audio/wav'], flac: ['audio', 'audio/flac']
};

/** Returns the R2 object key of an `r2:` reference, or null for any other href. */
export function parseR2Reference(href: string): string | null {
  const match = /^r2:(.+)$/i.exec(href.trim());
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** Lists the R2 keys referenced by Markdown links and images, e.g. `![x](r2:a/b.pdf)` or `[x](<r2:a b.pdf>)`. */
export function r2ReferenceKeys(markdown: string): string[] {
  const keys = new Set<string>();
  for (const match of markdown.matchAll(/\]\(\s*(?:<(r2:[^>\n]+)>|(r2:[^\s)]+))/gi)) {
    const key = parseR2Reference(match[1] ?? match[2]);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function r2PreviewType(key: string): { kind: R2PreviewKind; contentType: string } {
  const [kind, contentType] = PREVIEW_TYPES[key.split('.').pop()?.toLowerCase() ?? ''] ?? ['file', 'application/octet-stream'];
  return { kind, contentType };
}

/** Same-origin URL that authorizes the reference against its note before redirecting to the object. */
export function r2AssetUrl(key: string, notePath: string): string {
  return `/r2-assets/${key.split('/').map(encodeURIComponent).join('/')}?note=${encodeURIComponent(notePath)}`;
}
