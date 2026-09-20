import { Eye, EyeOff, FilePen, FilePlus, FileText, FileX, Folder, FolderPlus, Info, RefreshCw, Upload } from 'lucide-react';
import type { useFileManager } from './useFileManager.js';
export function FileToolbar({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { notebookId, layout, onOpenIndex, t, listing, directory, setDirectory, selected, setSelected, showHidden, treeOpen, setTreeOpen, showMarkdown, setDetail, busy, setOperation, r2, r2Directory, setR2Directory, readSequence, mutable, refresh, refreshR2, loadDetail, run, prepareLeave, navigate, openOperation, openFolderInfo, upload, toggleHidden, toggleMarkdown } = model;

  return (
    <>
      <header className='file-manager-toolbar'>
        {layout !== 'page' && (
          <button type='button' className='ui-button file-tree-toggle' aria-label={t('folder.folders')} title={t('folder.folders')} aria-expanded={treeOpen} onClick={() => setTreeOpen(!treeOpen)}>
            <Folder size={16} />
          </button>
        )}
        {r2Directory === undefined && (layout === 'panel' || directory !== listing?.root) && (
          <nav aria-label={t('files.location')} className='file-breadcrumbs'>
            {layout === 'panel' && listing && (
              <button
                type='button'
                disabled={busy}
                onClick={() => void navigate(listing.root)}
              >
                {t('files.root')}
              </button>
            )}
            {listing && (
              <>
                {directory.slice(listing.root.length + 1).split('/').filter(Boolean).map((part, index, parts) => (
                  <span key={index}>
                    {' / '}
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => void navigate(listing.root + '/' + parts.slice(0, index + 1).join('/'))}
                    >
                      {part}
                    </button>
                  </span>
                ))}
              </>
            )}
          </nav>
        )}
        {r2 && r2Directory !== undefined && (layout === 'panel' || r2Directory !== r2.prefix.slice(0, -1)) && (
          <nav aria-label={t('files.location')} className='file-breadcrumbs'>
            <button type='button' disabled={busy} onClick={() => setR2Directory(r2.prefix.slice(0, -1))}>R2</button>
            {r2Directory.slice(r2.prefix.length).split('/').map((part, index, parts) => (
              <span key={index}>
                {' / '}
                <button type='button' disabled={busy} onClick={() => setR2Directory(r2.prefix + parts.slice(0, index + 1).join('/'))}>{part}</button>
              </span>
            ))}
          </nav>
        )}
        {mutable && r2Directory === undefined && (
          <div className='file-toolbar-actions' role='group' aria-label={t('files.actions')}>
            <button type='button' className='ui-icon-button' aria-label={t('files.mkdir')} title={t('files.mkdir')} disabled={busy} onClick={() => void openOperation('mkdir')}>
              <FolderPlus size={17} />
              <span className='file-toolbar-label'>{t('files.mkdir')}</span>
            </button>
            <button type='button' className='ui-icon-button' aria-label={t('files.create')} title={t('files.create')} disabled={busy} onClick={() => void openOperation('create')}>
              <FilePlus size={17} />
              <span className='file-toolbar-label'>{t('files.create')}</span>
            </button>
            <label className='ui-icon-button' title={t('files.upload')} aria-disabled={busy}>
              <Upload size={17} />
              <span className='file-toolbar-label' aria-hidden='true'>{t('files.upload')}</span>
              <input
                type='file'
                aria-label={t('files.upload')}
                disabled={busy}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void upload(file);
                }}
                className='sr-only'
              />
            </label>
            <button type='button' className='ui-icon-button' aria-label={t('files.metadata')} title={t('files.metadata')} disabled={busy} onClick={() => void openFolderInfo()}>
              <Info size={17} />
              <span className='file-toolbar-label'>{t('files.metadata')}</span>
            </button>
            {onOpenIndex && (
              <button type='button' className='ui-icon-button' aria-label={t('files.index')} title={t('files.index')} disabled={busy} onClick={() => void run(() => onOpenIndex(directory, notebookId))}>
                <FilePen size={17} />
                <span className='file-toolbar-label'>{t('files.index')}</span>
              </button>
            )}
          </div>
        )}
        <div className='file-toolbar-view' role='group' aria-label={t('files.display')}>
          <button type='button' className='ui-icon-button file-hidden-toggle' aria-label={t('files.showHidden')} title={t('files.showHidden')} aria-pressed={showHidden} disabled={busy || !listing} onClick={toggleHidden}>
            {showHidden ? <Eye size={18} /> : <EyeOff size={18} />}
            <span className='file-toolbar-label'>{t('files.showHidden')}</span>
          </button>
          <button type='button' className='ui-icon-button file-markdown-toggle' aria-label={t('files.showMarkdown')} title={t('files.showMarkdown')} aria-pressed={showMarkdown} disabled={busy || !listing} onClick={toggleMarkdown}>
            {showMarkdown ? <FileText size={18} /> : <FileX size={18} />}
            <span className='file-toolbar-label'>{t('files.showMarkdown')}</span>
          </button>
          <button
            type='button'
            className='ui-icon-button'
            aria-label={t('folder.reload')}
            title={t('folder.reload')}
            disabled={busy}
            onClick={() =>
              void (async () => {
                if (await prepareLeave()) {
                  await run(async () => {
                    await refreshR2();
                    const next = await refresh();
                    if (selected && next.entries.some(e => e.path === selected)) await loadDetail(selected);
                    else {
                      setDirectory(next.root);
                      setSelected('');
                      setDetail(undefined);
                      setOperation(undefined);
                      readSequence.current++;
                    }
                  });
                }
              })()}
          >
            <RefreshCw size={16} />
            <span className='file-toolbar-label'>{t('folder.reload')}</span>
          </button>
        </div>
      </header>
    </>
  );
}
