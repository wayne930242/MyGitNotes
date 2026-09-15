import { Button } from './Button.js';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssetItem, NoteItem, NotebookConfig, FolderItem } from '../lib/types.js';
import { fetchAssets } from '../lib/api.js';
import { noteRoute, notebookRoute } from '../lib/routes.js';
import { headingSlug, resolveWorkspaceHref } from '../lib/workspace-links.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useAltWheelHorizontalScroll } from '../lib/use-alt-wheel-horizontal-scroll.js';
import { useNoteYouTubeEmbed } from '../lib/use-note-youtube-embed.js';

type BeforeNavigate = () => Promise<boolean>;
const Context = createContext({ notes: [] as NoteItem[], registerBeforeNavigate: (_handler: BeforeNavigate): (() => void) => () => {} });
export const useWorkspaceLinks = () => useContext(Context);

export function WorkspaceLinks({ notebooks, notes, folders, children, onOpenNote }: {
  notebooks: NotebookConfig[]; notes: NoteItem[]; folders: FolderItem[]; children: ReactNode;
  onOpenNote: (note: NoteItem, anchor?: string) => void;
}) {
  const { t } = useTranslation(); const navigate = useNavigate();
  const before = useRef(new Set<BeforeNavigate>());
  const surfaceRef = useRef<HTMLDivElement>(null);
  useAltWheelHorizontalScroll(surfaceRef, surfaceRef, '.markdown-table-scroll');
  useNoteYouTubeEmbed(surfaceRef);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ asset: AssetItem; notebookId: string } | null>(null);
  const registerBeforeNavigate = useCallback((handler: BeforeNavigate) => {
    before.current.add(handler);
    return () => { before.current.delete(handler); };
  }, []);
  const ready = async () => { for (const handler of before.current) if (!await handler()) return false; return true; };
  const open = async (element: HTMLElement, newTab: boolean) => {
    const href = element.dataset.workspaceLink || '';
    const sourcePath = element.dataset.sourcePath || '';
    const link = resolveWorkspaceHref(href, sourcePath);
    setError('');
    if (!link) { setError(t('links.invalid')); return; }
    if (link.kind === 'external') { window.open(link.url, '_blank', 'noopener,noreferrer'); return; }
    if (link.kind === 'anchor') {
      const container = element.closest('[data-markdown-view], .cm-editor');
      const target = [...(container?.querySelectorAll<HTMLElement>('[data-heading-slug]') || [])]
        .find(node => node.dataset.headingSlug === headingSlug(link.anchor));
      target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (!target) setError(t('links.missing'));
      return;
    }
    if (link.kind === 'route') {
      if (newTab) window.open(link.url, '_blank', 'noopener,noreferrer');
      else if (await ready()) navigate(link.url);
      return;
    }
    const note = link.kind === 'path' ? notes.find(note => note.path === link.path) : undefined;
    const notebook = link.kind === 'path' ? [...notebooks].sort((a,b) => b.root.length - a.root.length)
      .find(nb => link.path === nb.root || link.path.startsWith(`${nb.root}/`)) : undefined;
    if (note && notebook && link.kind === 'path') {
      if (newTab) window.open(`${noteRoute(notebook.id, note.path.slice(notebook.root.length + 1))}${link.anchor ? `#${encodeURIComponent(link.anchor)}` : ''}`, '_blank', 'noopener,noreferrer');
      else if (await ready()) onOpenNote(note, link.anchor);
      return;
    }
    if (link.kind === 'path' && notebook) {
      const root = `${notebook.root}/${notebook.assets || 'assets'}`;
      if (link.path === root || link.path.startsWith(`${root}/`) && !/\.[^/]+$/.test(link.path)) {
        const route = `/assets?notebook=${encodeURIComponent(notebook.id)}&directory=${encodeURIComponent(link.path.slice(root.length + 1))}`;
        if (newTab) window.open(route, '_blank', 'noopener,noreferrer'); else if (await ready()) navigate(route);
        return;
      }
    }
    if (link.kind === 'path' && notebook && (link.path === notebook.root || folders.some(folder => folder.notebookId === notebook.id && `${notebook.root}/${folder.path}` === link.path) || notes.some(note => note.notebookId === notebook.id && note.path.startsWith(`${link.path}/`)))) {
      const route = notebookRoute(notebook.id, link.path.slice(notebook.root.length + 1) || null);
      if (newTab) window.open(route, '_blank', 'noopener,noreferrer'); else if (await ready()) navigate(route);
      return;
    }
    try {
      const candidates = notebook ? [notebook] : notebooks;
      const lists = await Promise.all(candidates.map(async nb => ({ notebookId: nb.id, assets: await fetchAssets(nb.id) })));
      for (const list of lists) {
        const asset = list.assets.find(asset => link.kind === 'asset-hash' ? asset.hash === link.hash : asset.path === link.path);
        if (asset) { setPreview({ asset, notebookId: list.notebookId }); return; }
      }
      setError(t('links.missing'));
    } catch { setError(t('links.loadFailed')); }
  };
  const clickedLink = (target: EventTarget) => target instanceof Element ? target.closest<HTMLElement>('[data-workspace-link]') : null;
  return <Context.Provider value={{ notes, registerBeforeNavigate }}>
    <div ref={surfaceRef} className="workspace-link-surface" onMouseDownCapture={event => {
      if (event.button === 0 && clickedLink(event.target)) { event.preventDefault(); event.stopPropagation(); }
    }} onClickCapture={event => {
      const element = clickedLink(event.target);
      if (element && event.button === 0) { event.preventDefault(); event.stopPropagation(); void open(element, event.ctrlKey || event.metaKey); }
    }} onKeyDownCapture={event => {
      const element = clickedLink(event.target);
      if (element && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); void open(element, false); }
    }}>
      {children}
      {error && <div role="alert" className="workspace-link-error">{error}<button onClick={() => setError('')} aria-label={t('common.close')}>×</button></div>}
      {preview && <WorkspaceDialog title={preview.asset.name} onClose={() => setPreview(null)} className="workspace-asset-preview">
        <p className="asset-location">{preview.asset.path}</p>
        {/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(preview.asset.name)
          ? <img src={preview.asset.rawUrl} alt={preview.asset.name} /> : <p>{t('assets.openToViewFormat')}</p>}
        <div className="workspace-dialog-actions">
          <a href={preview.asset.rawUrl} target="_blank" rel="noopener noreferrer" className="ui-button">{t('assets.openOriginal')}</a>
          <Button variant="primary"  onClick={async () => {
            if (!await ready()) return;
            navigate(`/assets?notebook=${encodeURIComponent(preview.notebookId)}&asset=${encodeURIComponent(preview.asset.path)}`); setPreview(null);
          }}>{t('links.locateAsset')}</Button>
        </div>
      </WorkspaceDialog>}
    </div>
  </Context.Provider>;
}
