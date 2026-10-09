import { type RefObject, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type NoteRef, noteRefKey } from '@mygitnotes/core/note-query';
import type { RepositoryId } from '@mygitnotes/core/repository';
import type { NotebookConfig } from './types.js';
import { noteLookupOptions, useNoteQueryScope } from './use-note-queries.js';
import { keyedAppUrl, parseWorkspaceRoute } from './routes.js';
import { notebookOfPath, resolveWorkspaceHref, type WorkspaceLink } from './workspace-links.js';
import type { NotebookKey } from '@mygitnotes/core/notebook-key';
import { resolveBareId } from './notebook-keys.js';

/** What a link can reach: the notebooks in its source note's repository, and the source notebook when known. */
export interface LinkScope {
  source?: NotebookConfig;
  notebooks: NotebookConfig[];
  /** The key an app link's bare notebook id stands for, by the rule that redirects old URLs. */
  resolve: (localId: string) => NotebookKey | null;
}

/**
 * A link resolves within its source note's repository. The source notebook is the nearest
 * `data-source-notebook`, since notebook roots may repeat across repositories; without one it
 * is the notebook whose root holds the source path.
 */
export function linkScope(element: HTMLElement, notebooks: NotebookConfig[], repositories: Record<string, RepositoryId>, defaultRepository: RepositoryId): LinkScope {
  const sourceId = element.closest<HTMLElement>('[data-source-notebook]')?.dataset.sourceNotebook;
  const source = notebooks.find(nb => nb.id === sourceId) ?? notebookOfPath(element.dataset.sourcePath || '', notebooks);
  const repository = source && repositories[source.id];
  return { source, notebooks: source ? notebooks.filter(nb => (repositories[nb.id] ?? '') === (repository ?? '')) : [], resolve: localId => resolveBareId(repositories, defaultRepository, localId) };
}

/** Path aliases come from the source notebook when known. */
export const linkAliases = (scope: LinkScope) => scope.source ? scope.source.pathAliases ?? {} : scope.notebooks;

/** An app link with a bare notebook id names the notebook's key instead, keeping its path, query and fragment. */
export function keyedLink(link: WorkspaceLink, scope: LinkScope): WorkspaceLink {
  return link.kind === 'route' ? { kind: 'route', url: keyedAppUrl(link.url, scope.resolve) } : link;
}

/** Resolve only note candidates; folders, assets, anchors and external URLs need no speculative reads. */
export function linkedNote(href: string, source: string, scope: LinkScope, origin: string): NoteRef | null {
  const resolved = resolveWorkspaceHref(href, source, linkAliases(scope), origin);
  const link = resolved && keyedLink(resolved, scope);
  if (link?.kind === 'path' && /\.md$/i.test(link.path) && link.path !== source) {
    const notebook = notebookOfPath(link.path, scope.notebooks);
    return notebook ? { notebookId: notebook.id, path: link.path } : null;
  }
  if (link?.kind === 'route') {
    const url = new URL(link.url, origin);
    const route = parseWorkspaceRoute(url.pathname, url.search);
    const notebook = scope.notebooks.find(nb => nb.id === route.notebook);
    if (route.valid && route.note && notebook) {
      const path = `${notebook.root}/${route.note}`;
      return path !== source && /\.md$/i.test(path) ? { notebookId: notebook.id, path } : null;
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
  const { sourceId, revisions, repositories } = useNoteQueryScope();
  useEffect(() => {
    const root = surface.current;
    if (!root || !sourceId) return;
    const scope = { sourceId, revisions, repositories, drafts: {} };
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
      const candidates: { source: string; path: string; notebookId: string; }[] = [];
      for (let index = 0; index < Math.min(elements.length, SCAN_LIMIT); index++) {
        const element = elements[index];
        const sourcePath = element.dataset.sourcePath!;
        const reach = linkScope(element, notebooks, repositories, sourceId);
        if (!reach.source) continue;
        const source = noteRefKey({ notebookId: reach.source.id, path: sourcePath });
        if (!sources.has(source) && sources.size >= SOURCE_LIMIT) continue;
        sources.add(source);
        const target = linkedNote(element.dataset.workspaceLink!, sourcePath, reach, window.location.origin);
        if (target) candidates.push({ source, ...target });
      }
      for (const source of attempted.keys()) if (!sources.has(source)) attempted.delete(source);
      for (const { source, path, notebookId } of candidates) {
        const paths = attempted.get(source) || new Set<string>();
        attempted.set(source, paths);
        const key = noteRefKey({ notebookId, path });
        if (paths.size >= PRELOAD_LIMIT || paths.has(key)) continue;
        paths.add(key);
        const options = noteLookupOptions(scope, [{ notebookId, path }], true);
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
  }, [surface, notebooks, client, sourceId, revisions, repositories]);
}
