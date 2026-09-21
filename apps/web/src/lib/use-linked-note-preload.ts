import { type RefObject, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NotebookConfig } from './types.js';
import { noteLookupOptions, useNoteQueryScope } from './use-note-queries.js';
import { parseWorkspaceRoute } from './routes.js';
import { resolveWorkspaceHref } from './workspace-links.js';

/** Resolve only note candidates; folders, assets, anchors and external URLs need no speculative reads. */
export function linkedNotePath(href: string, source: string, notebooks: NotebookConfig[], origin: string): string | null {
  const link = resolveWorkspaceHref(href, source, notebooks, origin);
  if (link?.kind === 'path' && /\.md$/i.test(link.path) && link.path !== source && notebooks.some(nb => link.path.startsWith(`${nb.root}/`))) return link.path;
  if (link?.kind === 'route') {
    const url = new URL(link.url, origin);
    const route = parseWorkspaceRoute(url.pathname, url.search);
    const notebook = notebooks.find(nb => nb.id === route.notebook);
    if (route.valid && route.note && notebook) {
      const path = `${notebook.root}/${route.note}`;
      return path !== source && /\.md$/i.test(path) ? path : null;
    }
  }
  return null;
}

const PRELOAD_LIMIT = 8;
const SCAN_LIMIT = 200;
const SOURCE_LIMIT = 4;
type Connection = { saveData?: boolean; effectiveType?: string; };

/** Preload rendered links one at a time, sharing the exact body query used by every note editor. */
export function useLinkedNotePreload(surface: RefObject<HTMLElement>, notebooks: NotebookConfig[]): void {
  const client = useQueryClient();
  const { sourceId, revision } = useNoteQueryScope();
  useEffect(() => {
    const root = surface.current;
    if (!root || !sourceId) return;
    const scope = { sourceId, revision, drafts: {} };
    const attempted = new Map<string, Set<string>>();
    let stopped = false;
    let busy = false;
    let scheduled: number | undefined;
    const idle = typeof window.requestIdleCallback === 'function';
    const cancel = () => {
      if (scheduled === undefined) return;
      if (idle) window.cancelIdleCallback(scheduled);
      else window.clearTimeout(scheduled);
      scheduled = undefined;
    };
    const allowed = () => {
      const connection = (navigator as Navigator & { connection?: Connection; }).connection;
      return document.visibilityState !== 'hidden' && !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType || '');
    };
    const schedule = () => {
      if (stopped || busy || scheduled !== undefined || !allowed()) return;
      scheduled = idle ? window.requestIdleCallback(() => void run()) : window.setTimeout(() => void run(), 250);
    };
    const run = async () => {
      scheduled = undefined;
      if (stopped || !allowed()) return;
      // A zoomed note owns the visible reading surface; background browse cards do not compete with it.
      const visible = root.querySelector('.note-dialog') || root;
      const elements = visible.querySelectorAll<HTMLElement>('[data-workspace-link][data-source-path]');
      const sources = new Set<string>();
      const candidates: { source: string; path: string; }[] = [];
      for (let index = 0; index < Math.min(elements.length, SCAN_LIMIT); index++) {
        const element = elements[index];
        const source = element.dataset.sourcePath!;
        if (!sources.has(source) && sources.size >= SOURCE_LIMIT) continue;
        sources.add(source);
        const path = linkedNotePath(element.dataset.workspaceLink!, source, notebooks, window.location.origin);
        if (path) candidates.push({ source, path });
      }
      for (const source of attempted.keys()) if (!sources.has(source)) attempted.delete(source);
      for (const { source, path } of candidates) {
        const paths = attempted.get(source) || new Set<string>();
        attempted.set(source, paths);
        if (paths.size >= PRELOAD_LIMIT || paths.has(path)) continue;
        paths.add(path);
        const options = noteLookupOptions(scope, [path], true);
        const query = client.getQueryState(options.queryKey);
        if (query?.data && !query.isInvalidated) continue;
        busy = true;
        // React Query records failures; clicking still retries and presents the normal link error.
        await client.prefetchQuery({ ...options, retry: false });
        busy = false;
        schedule();
        return;
      }
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-workspace-link', 'data-source-path'] });
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      stopped = true;
      cancel();
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [surface, notebooks, client, sourceId, revision]);
}
