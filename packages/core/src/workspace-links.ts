export type WorkspaceLink =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; anchor: string }
  | { kind: 'path'; path: string; anchor: string }
  | { kind: 'route'; url: string }
  | { kind: 'asset-hash'; hash: string };

export function noteLinkHref(sourcePath: string, targetPath: string): string {
  const source = sourcePath.split('/').slice(0, -1), target = targetPath.split('/');
  while (source.length && target.length && source[0] === target[0]) { source.shift(); target.shift(); }
  return [...source.map(() => '..'), ...target.map(part => encodeURIComponent(part).replace(/[!'()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase()))].join('/');
}

export function noteMarkdownLink(sourcePath: string, targetPath: string, title: string): string {
  return `[${title.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ')}](${noteLinkHref(sourcePath, targetPath)})`;
}

export function headingSlug(text: string): string {
  return text
    .replace(/^#{1,6}\s*/, '')
    .replace(/[*_`]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

export function resolveWorkspaceHref(value: string, sourcePath: string): WorkspaceLink | null {
  const href = value.trim();
  if (!href || /[\\\x00-\x1f\x7f]/.test(href)) return null;
  try {
    if (/^(https?:|mailto:)/i.test(href) || href.startsWith('//')) {
      const url = new URL(href.startsWith('//') ? `https:${href}` : href);
      if (url.username || url.password) return null;
      return { kind: 'external', url: url.href };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    if (href.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(href.slice(1)) };
    if (/^\/(?:notebooks\/|notes(?:[?#]|$)|assets(?:[?#]|$)|screen(?:[?#]|$)|graph(?:[?#]|$))/.test(href)) {
      return { kind: 'route', url: href };
    }
    const hashed = href.match(/^\/raw-assets\/by-hash\/([a-f0-9]{40})$/);
    if (hashed) return { kind: 'asset-hash', hash: hashed[1] };
    const [withoutHash, hash = ''] = href.split('#', 2);
    const raw = withoutHash.split('?', 1)[0].replace(/^\/raw-assets\//, '/');
    const absolute = raw.startsWith('/') || raw.startsWith('notes/');
    const stack = absolute ? [] : sourcePath.split('/').slice(0, -1);
    for (const encoded of raw.replace(/^\//, '').split('/')) {
      const part = decodeURIComponent(encoded);
      if (/[\/\\\x00-\x1f\x7f]/.test(part)) return null;
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!stack.length) return null;
        stack.pop();
      } else {
        stack.push(part);
      }
    }
    return stack.length ? { kind: 'path', path: stack.join('/'), anchor: decodeURIComponent(hash) } : null;
  } catch {
    return null;
  }
}
