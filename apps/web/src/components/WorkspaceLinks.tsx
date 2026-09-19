import { Button } from './Button.js';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { AssetItem, FolderItem, NotebookConfig } from '../lib/types.js';
import { fetchAssets } from '../lib/api.js';
import { noteLookupOptions, notePathsOptions, useNoteQueryScope } from '../lib/use-note-queries.js';
import { notebookRoute, noteRoute } from '../lib/routes.js';
import { headingSlug, resolveWorkspaceHref } from '../lib/workspace-links.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';
import { useNoteYouTubeEmbed } from '../lib/use-note-youtube-embed.js';

type BeforeNavigate = () => Promise<boolean>;
const Context = createContext({ registerBeforeNavigate: (_handler: BeforeNavigate): () => void => () => {} });
export const useWorkspaceLinks = () => useContext(Context);

export function WorkspaceLinks({ notebooks, folders, children, onOpenNote }: {
  notebooks: NotebookConfig[];
  folders: FolderItem[];
  children: ReactNode;
  /** `source` is the clicked link, so the caller can tell which Focus pane it came from. */
  onOpenNote: (note: NoteListItem, anchor?: string, source?: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const scope = useNoteQueryScope();
  const before = useRef(new Set<BeforeNavigate>());
  const surfaceRef = useRef<HTMLDivElement>(null);
  useAltWheelHorizontalScroll(surfaceRef, surfaceRef, '.markdown-table-scroll');
  useNoteYouTubeEmbed(surfaceRef);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ asset: AssetItem; notebookId: string; } | null>(null);
  const registerBeforeNavigate = useCallback((handler: BeforeNavigate) => {
    before.current.add(handler);
    return () => {
      before.current.delete(handler);
    };
  }, []);
  const ready = async () => {
    for (const handler of before.current) if (!await handler()) return false;
    return true;
  };
  const open = async (element: HTMLElement, newTab: boolean) => {
    const href = element.dataset.workspaceLink || '';
    const sourcePath = element.dataset.sourcePath || '';
    const link = resolveWorkspaceHref(href, sourcePath, undefined, window.location.origin);
    setError('');
    if (!link) {
      setError(t('links.invalid'));
      return;
    }
    if (link.kind === 'external') {
      window.open(link.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (link.kind === 'anchor') {
      const container = element.closest('[data-markdown-view], .cm-editor');
      const target = [...(container?.querySelectorAll<HTMLElement>('[data-heading-slug]') || [])].find(node => node.dataset.headingSlug === headingSlug(link.anchor));
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (!target) setError(t('links.missing'));
      return;
    }
    if (link.kind === 'route') {
      if (newTab) window.open(link.url, '_blank', 'noopener,noreferrer');
      else if (await ready()) navigate(link.url);
      return;
    }
    // A link target is read by path instead of being looked up in a client-side note list.
    let note: NoteListItem | undefined;
    if (link.kind === 'path') {
      try {
        note = (await queryClient.fetchQuery(noteLookupOptions(scope, [link.path], false))).notes[0];
      } catch (error) {
        setError((error as Error).message);
        return;
      }
    }
    const notebook = link.kind === 'path' ? [...notebooks].sort((a, b) => b.root.length - a.root.length).find(nb => link.path === nb.root || link.path.startsWith(`${nb.root}/`)) : undefined;
    if (note && notebook && link.kind === 'path') {
      if (newTab) window.open(`${noteRoute(notebook.id, note.path.slice(notebook.root.length + 1))}${link.anchor ? `#${encodeURIComponent(link.anchor)}` : ''}`, '_blank', 'noopener,noreferrer');
      else if (await ready()) onOpenNote(note, link.anchor, element);
      return;
    }
    if (link.kind === 'path' && notebook) {
      const root = `${notebook.root}/${notebook.assets || 'assets'}`;
      if (link.path === root || link.path.startsWith(`${root}/`) && !/\.[^/]+$/.test(link.path)) {
        const route = `/assets?notebook=${encodeURIComponent(notebook.id)}&directory=${encodeURIComponent(link.path.slice(root.length + 1))}`;
        if (newTab) window.open(route, '_blank', 'noopener,noreferrer');
        else if (await ready()) navigate(route);
        return;
      }
    }
    const folderHasNotes = async () => {
      if (link.kind !== 'path' || !notebook) return false;
      try {
        const result = await queryClient.fetchQuery(notePathsOptions(scope, { notebookId: notebook.id, folders: [link.path], descendants: true, showHidden: true }));
        return result.paths.length > 0;
      } catch (error) {
        setError((error as Error).message);
        return false;
      }
    };
    if (link.kind === 'path' && notebook && (link.path === notebook.root || folders.some(folder => folder.notebookId === notebook.id && `${notebook.root}/${folder.path}` === link.path) || await folderHasNotes())) {
      const route = notebookRoute(notebook.id, link.path.slice(notebook.root.length + 1) || null);
      if (newTab) window.open(route, '_blank', 'noopener,noreferrer');
      else if (await ready()) navigate(route);
      return;
    }
    try {
      const candidates = notebook ? [notebook] : notebooks;
      const lists = await Promise.all(candidates.map(async nb => ({ notebookId: nb.id, assets: await fetchAssets(nb.id) })));
      for (const list of lists) {
        const asset = list.assets.find(asset => link.kind === 'asset-hash' ? asset.hash === link.hash : asset.path === link.path);
        if (asset) {
          setPreview({ asset, notebookId: list.notebookId });
          return;
        }
      }
      setError(t('links.missing'));
    } catch {
      setError(t('links.loadFailed'));
    }
  };
  const clickedLink = (target: EventTarget) => target instanceof Element ? target.closest<HTMLElement>('[data-workspace-link]') : null;
  return (
    <Context.Provider value={{ registerBeforeNavigate }}>
      <div
        ref={surfaceRef}
        className='workspace-link-surface'
        onMouseDownCapture={event => {
          if (event.button === 0 && clickedLink(event.target)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onClickCapture={event => {
          const element = clickedLink(event.target);
          if (element && event.button === 0) {
            event.preventDefault();
            event.stopPropagation();
            void open(element, event.ctrlKey || event.metaKey);
          }
        }}
        onKeyDownCapture={event => {
          const element = clickedLink(event.target);
          if (element && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            void open(element, false);
          }
        }}
      >
        {children}
        {error && (
          <div role='alert' className='workspace-link-error'>
            {error}
            <button onClick={() => setError('')} aria-label={t('common.close')}>×</button>
          </div>
        )}
        {preview && (
          <WorkspaceDialog title={preview.asset.name} onClose={() => setPreview(null)} className='workspace-asset-preview'>
            <p className='asset-location'>{preview.asset.path}</p>
            {/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(preview.asset.name) ? <img src={preview.asset.rawUrl} alt={preview.asset.name} /> : <p>{t('assets.openToViewFormat')}</p>}
            <div className='workspace-dialog-actions'>
              <a href={preview.asset.rawUrl} target='_blank' rel='noopener noreferrer' className='ui-button'>{t('assets.openOriginal')}</a>
              <Button
                variant='primary'
                onClick={async () => {
                  if (!await ready()) return;
                  navigate(`/assets?notebook=${encodeURIComponent(preview.notebookId)}&asset=${encodeURIComponent(preview.asset.path)}`);
                  setPreview(null);
                }}
              >
                {t('links.locateAsset')}
              </Button>
            </div>
          </WorkspaceDialog>
        )}
      </div>
    </Context.Provider>
  );
}
