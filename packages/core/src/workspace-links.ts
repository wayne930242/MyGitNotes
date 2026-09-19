export type WorkspaceLink = { kind: 'external'; url: string; } | { kind: 'anchor'; anchor: string; } | { kind: 'path'; path: string; anchor: string; } | { kind: 'route'; url: string; } | { kind: 'asset-hash'; hash: string; };

export function noteLinkHref(sourcePath: string, targetPath: string): string {
  const source = sourcePath.split('/').slice(0, -1), target = targetPath.split('/');
  while (source.length && target.length && source[0] === target[0]) {
    source.shift();
    target.shift();
  }
  return [...source.map(() => '..'), ...target.map(part => encodeURIComponent(part).replace(/[!'()*]/g, value => '%' + value.charCodeAt(0).toString(16).toUpperCase()))].join('/');
}

/** The web app route of a note, relative to the app origin. */
export function noteWebPath(notebookId: string, relativePath: string): string {
  return `/notebooks/${encodeURIComponent(notebookId)}/notes/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

export function noteMarkdownLink(sourcePath: string, targetPath: string, title: string): string {
  return `[${title.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ')}](${noteLinkHref(sourcePath, targetPath)})`;
}

export function headingSlug(text: string): string {
  return text.replace(/^#{1,6}\s*/, '').replace(/[*_`]/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}

import type { NotebookConfig } from './types.js';

let workspaceNotebooksRegistry: NotebookConfig[] = [];

export function setWorkspaceNotebooks(notebooks: NotebookConfig[]): void {
  workspaceNotebooksRegistry = notebooks;
}

export function getWorkspaceNotebooks(): NotebookConfig[] {
  return workspaceNotebooksRegistry;
}

export function resolveWorkspaceHref(value: string, sourcePath: string, aliasesOrNotebooks?: Record<string, string> | NotebookConfig[], currentOrigin?: string): WorkspaceLink | null {
  const href = value.trim();
  if (!href || /[\\\x00-\x1f\x7f]/.test(href)) return null;
  try {
    if (/^(https?:|mailto:)/i.test(href) || href.startsWith('//')) {
      const url = new URL(href.startsWith('//') ? `https:${href}` : href);
      if (url.username || url.password) return null;
      if (currentOrigin && url.origin === currentOrigin) {
        // The stripped pathname can itself start with `//`; resolve it as a path directly
        // instead of re-running the protocol/`//` check, which would reinterpret it as
        // protocol-relative and hand navigation to whatever host follows the `//`.
        return resolveRelativeWorkspaceHref(`${url.pathname}${url.search}${url.hash}`, sourcePath, aliasesOrNotebooks);
      }
      return { kind: 'external', url: url.href };
    }
    return resolveRelativeWorkspaceHref(href, sourcePath, aliasesOrNotebooks);
  } catch {
    return null;
  }
}

function resolveRelativeWorkspaceHref(href: string, sourcePath: string, aliasesOrNotebooks?: Record<string, string> | NotebookConfig[]): WorkspaceLink | null {
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
    if (href.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(href.slice(1)) };
    if (/^\/(?:notebooks\/|notes(?:[?#]|$)|assets(?:[?#]|$)|screen(?:[?#]|$)|graph(?:[?#]|$))/.test(href)) {
      return { kind: 'route', url: href };
    }
    const hashed = href.match(/^\/raw-assets\/by-hash\/([a-f0-9]{40})$/);
    if (hashed) return { kind: 'asset-hash', hash: hashed[1] };
    const [withoutHash, hash = ''] = href.split('#', 2);
    let raw = withoutHash.split('?', 1)[0].replace(/^\/raw-assets\//, '/');

    // Path alias resolution (e.g. from tsconfig compilerOptions.paths)
    let isAliased = false;
    let aliases: Record<string, string> | undefined;
    if (aliasesOrNotebooks && !Array.isArray(aliasesOrNotebooks)) {
      aliases = aliasesOrNotebooks;
    } else {
      const nbs = Array.isArray(aliasesOrNotebooks) ? aliasesOrNotebooks : workspaceNotebooksRegistry;
      const matchedNb = [...nbs].sort((a, b) => b.root.length - a.root.length).find(nb => sourcePath === nb.root || sourcePath.startsWith(`${nb.root}/`));
      aliases = matchedNb?.pathAliases;
    }

    if (aliases) {
      for (const [pattern, target] of Object.entries(aliases)) {
        if (pattern.endsWith('/*') && target.endsWith('/*')) {
          const prefix = pattern.slice(0, -2);
          if (raw.startsWith(prefix + '/')) {
            const suffix = raw.slice(prefix.length + 1);
            const targetPrefix = target.slice(0, -2);
            raw = targetPrefix ? `${targetPrefix}/${suffix}` : suffix;
            isAliased = true;
            break;
          }
        } else if (pattern.endsWith('/*')) {
          const prefix = pattern.slice(0, -2);
          if (raw.startsWith(prefix + '/')) {
            const suffix = raw.slice(prefix.length + 1);
            const targetPrefix = target.replace(/\/$/, '');
            raw = targetPrefix ? `${targetPrefix}/${suffix}` : suffix;
            isAliased = true;
            break;
          }
        } else if (raw === pattern) {
          raw = target;
          isAliased = true;
          break;
        }
      }
    }

    const absolute = isAliased || raw.startsWith('/') || raw.startsWith('notes/');
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
