import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import { fetchAssets } from '../lib/api.js';
import { notebookRoute } from '../lib/routes.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import type { ScreenAsset, ScreenContentProps } from './ScreenCard.js';

export function useScreenItemOpen(options: { notebooks: NotebookConfig[]; assets: ScreenAsset[]; onOpenNote: (note: NoteListItem) => void; onMissing: () => void; }): { open: ScreenContentProps['onOpen']; preview: ReactNode; } {
  const { notebooks, assets, onOpenNote, onMissing } = options;
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ScreenAsset>();
  const open: ScreenContentProps['onOpen'] = (item, note) => {
    if (item.kind === 'youtube') {
      window.open(`https://www.youtube.com/watch?v=${item.videoId}&t=${item.start}`, '_blank', 'noopener,noreferrer');
      return;
    }
    const nb = notebooks.find(nb => nb.id === item.notebookId);
    if (!nb) {
      onMissing();
      return;
    }
    if (item.kind === 'note') {
      if (note) onOpenNote(note);
      else onMissing();
    } else if (item.kind === 'folder') {
      const assetRoot = `${nb.root}/${nb.assets || 'assets'}`;
      navigate(item.path === assetRoot || item.path.startsWith(`${assetRoot}/`) ? `/assets?notebook=${encodeURIComponent(nb.id)}&directory=${encodeURIComponent(item.path.slice(assetRoot.length + 1))}` : notebookRoute(nb.id, item.path === nb.root ? null : item.path.slice(nb.root.length + 1)));
    } else {
      const asset = assets.find(asset => asset.notebookId === item.notebookId && asset.path === item.path);
      if (asset) setPreview(asset);
      else onMissing();
    }
  };
  const previewNode: ReactNode = preview
    ? (
      <WorkspaceDialog title={preview.name} onClose={() => setPreview(undefined)} className='asset-preview-dialog'>
        <div className='workspace-asset-preview'>{/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(preview.name) ? <img src={preview.rawUrl} alt={preview.name} /> : <a href={preview.rawUrl} target='_blank' rel='noopener noreferrer'>{preview.name}</a>}</div>
        <div className='workspace-dialog-actions'>
          <Button onClick={() => navigate(`/assets?notebook=${encodeURIComponent(preview.notebookId)}&asset=${encodeURIComponent(preview.path)}`)}>{t('links.locateAsset')}</Button>
        </div>
      </WorkspaceDialog>
    )
    : null;
  return { open, preview: previewNode };
}

export function useScreenAssets(notebooks: NotebookConfig[], notebookId: string): { assets: ScreenAsset[]; error: boolean; loading: boolean; retry: () => void; } {
  const [assets, setAssets] = useState<ScreenAsset[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    /* eslint-disable react/set-state-in-effect -- The notebook-scoped asset request sets loading before it starts and settles after all sources; preserve cancellation and partial-result fallback. */
    setLoading(true);
    /* eslint-enable react/set-state-in-effect */
    const scoped = notebooks.filter(nb => nb.id === notebookId);
    void Promise.allSettled(scoped.map(async nb => (await fetchAssets(nb.id)).map(asset => ({ ...asset, notebookId: nb.id })))).then(results => {
      if (!active) return;
      setAssets(previous => results.flatMap((result, index) => result.status === 'fulfilled' ? result.value : previous.filter(asset => asset.notebookId === scoped[index].id)));
      setError(results.some(result => result.status === 'rejected'));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [notebooks, notebookId, attempt]);
  return { assets, error, loading, retry: () => setAttempt(value => value + 1) };
}
