import { forwardRef } from 'react';
import { Cloud, Folder } from 'lucide-react';
import { R2Panel } from '../R2Panel.js';
import { WorkspaceSidebar, WorkspaceSidebarPortal, WorkspaceSidebarToggle } from '../WorkspaceChrome.js';
import { FileTree } from './FileTree.js';
import { FileToolbar } from './FileToolbar.js';
import { FileListing } from './FileListing.js';
import { FileDetail } from './FileDetail.js';
import { FileOperation } from './FileOperation.js';
import { FileInfoPanel } from './FileInfoPanel.js';
import { FileLeaveDialog } from './FileLeaveDialog.js';
import { useFileManager } from './useFileManager.js';
import type { FileManagerHandle, FileManagerProps } from './types.js';
import '../file-manager.css';
export const FileManager = forwardRef<FileManagerHandle, FileManagerProps>(function FileManager(props, ref) {
  const model = useFileManager(props, ref);
  const { notebookId, writable, mode, layout, beforeChange, onChanged, onInsert, t, sidebar, listing, showHidden, busy, reading, error, r2, r2Directory, setR2Directory, mutable, selectedEntry, refresh, refreshR2, run, navigate, navigateR2 } = model;
  return (
    <div className='file-manager' data-mode={mode} data-layout={layout} aria-busy={busy || reading || !listing}>
      {layout === 'page' && listing && (
        <>
          <WorkspaceSidebarToggle label={t('folder.folders')} open={sidebar.open} onClick={() => sidebar.setOpen(open => !open)} />
          <WorkspaceSidebarPortal>
            <WorkspaceSidebar label={t('folder.folders')} className='assets-sidebar'>
              <div className='sidebar-section-label'>{t('folder.folders')}</div>
              <FileTree model={model} />
            </WorkspaceSidebar>
          </WorkspaceSidebarPortal>
        </>
      )}
      {layout === 'panel' && (
        <div className='file-panel-sources' role='group' aria-label={t('files.location')}>
          <button type='button' aria-pressed={r2Directory === undefined} disabled={busy || !listing} onClick={() => listing && void navigate(listing.root)}>
            <Folder size={14} />
            {t('files.titleLabel')}
          </button>
          {r2 && (
            <button type='button' aria-pressed={r2Directory !== undefined} disabled={busy} onClick={() => void navigateR2(r2.prefix.slice(0, -1))}>
              <Cloud size={14} />R2
            </button>
          )}
        </div>
      )}
      <FileToolbar model={model} />
      {error && <p role='alert' className='file-error'>{error}</p>}
      {!listing ? <p role='status'>{error ? t('files.unavailable') : t('files.loading')}</p> : (
        <>
          <div className='file-manager-body'>
            {layout !== 'page' && <FileTree model={model} />}
            {r2 && r2Directory !== undefined
              ? (
                <R2Panel
                  notebookId={notebookId}
                  listing={r2}
                  directory={r2Directory}
                  mutable={mode === 'manage' && writable}
                  showHidden={showHidden}
                  busy={busy}
                  run={run}
                  onNavigate={path => setR2Directory(path)}
                  onRefresh={refreshR2}
                  beforeChange={beforeChange}
                  onNotesChanged={async () => {
                    const next = await refresh();
                    await onChanged?.({ revision: next.revision, selectedPath: '', pathMap: {}, deletedPaths: [] });
                  }}
                  onInsert={mode === 'pick-image' ? onInsert : undefined}
                />
              )
              : (
                <section className={`file-content ${selectedEntry ? 'has-selection' : ''}`}>
                  <p className='file-storage-hint'>{mode === 'pick-image' ? t('files.pickerHint') : !mutable ? t('files.readOnly') : listing.remote ? t('files.remoteHint') : t('files.localHint')}</p>
                  <FileListing model={model} />
                  <FileDetail model={model} />
                  <FileOperation model={model} />
                </section>
              )}
            <FileInfoPanel model={model} />
          </div>
        </>
      )}
      <FileLeaveDialog model={model} />
    </div>
  );
});
