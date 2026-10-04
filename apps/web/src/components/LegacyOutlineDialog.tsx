import { useEffect, useState } from 'react';
import type { NotebookConfig } from '@mygitnotes/core';
import type { LegacyOutlineImportRequest } from '@mygitnotes/core/outline-import';
import type { NoteRef } from '@mygitnotes/core/note-query';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { ApiError, readNote } from '../lib/api.js';
import { applyLegacyOutline, downloadLegacySource, type LegacyOutlinePreview, type LegacyOutlineSource, previewLegacyOutline, readLegacyOutlineSource } from '../lib/outline-import.js';
import { discardLegacyBookmarkRecovery, type LegacyBookmarkRecovery } from '../lib/legacy-bookmark-recovery.js';
import { downloadTextFile } from '../lib/note-export.js';
import { useTranslation } from '../lib/i18n/index.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Button } from './Button.js';
import { Select } from './Select.js';

interface LegacyOutlineDialogProps {
  repositories: WorkspaceRepository[];
  notebooks: NotebookConfig[];
  recoveries: LegacyBookmarkRecovery[];
  recoveryError: string;
  onRecoveryChanged: () => void;
  onCreated: (note: NoteRef) => Promise<void>;
  onClose: () => void;
}

export function LegacyOutlineDialog({ repositories, notebooks, recoveries, recoveryError, onRecoveryChanged, onCreated, onClose }: LegacyOutlineDialogProps) {
  const { t } = useTranslation();
  const [repository, setRepository] = useState('');
  const [discard, setDiscard] = useState<LegacyBookmarkRecovery | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <WorkspaceDialog title={t('legacyOutline.title')} onClose={close}>
      <div className='space-y-4'>
        <p className='text-sm text-muted'>{t('legacyOutline.provenance')}</p>
        {(recoveryError || error) && <p role='alert' className='text-sm text-danger'>{recoveryError || error}</p>}
        {recoveries.length > 0 && (
          <section aria-label={t('legacyOutline.recovery')} className='space-y-3'>
            <h3 className='text-sm font-semibold'>{t('legacyOutline.recovery')}</h3>
            <p className='text-sm text-muted'>{t('legacyOutline.blocker')}</p>
            {recoveries.map(recovery => (
              <div key={recovery.repository} className='border border-line rounded-lg p-3 space-y-2'>
                <p className='text-sm break-all'>{recovery.repository}</p>
                {recovery.malformed && <p className='text-sm text-warning'>{t('legacyOutline.malformedDraft')}</p>}
                <div className='flex flex-wrap gap-2'>
                  <Button onClick={() => downloadTextFile('legacy-bookmarks-draft.json', recovery.raw, 'application/json')}>{t('legacyOutline.exportDraft')}</Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setDiscard(recovery);
                      setConfirmation('');
                      setError('');
                    }}
                  >
                    {t('legacyOutline.discard')}
                  </Button>
                </div>
              </div>
            ))}
            {discard && (
              <div className='border border-line rounded-lg p-3 space-y-2'>
                <label className='block text-sm'>
                  {t('legacyOutline.confirmRepository', { repository: discard.repository })}
                  <input aria-label={t('legacyOutline.repositoryConfirmation')} className='ui-control mt-1.5' value={confirmation} onChange={event => setConfirmation(event.target.value)} />
                </label>
                <div className='flex flex-wrap justify-end gap-2'>
                  <Button onClick={() => setDiscard(null)}>{t('common.cancel')}</Button>
                  <Button
                    variant='danger'
                    disabled={confirmation !== discard.repository}
                    onClick={() => {
                      try {
                        discardLegacyBookmarkRecovery(discard, confirmation);
                        setDiscard(null);
                        onRecoveryChanged();
                      } catch (error) {
                        setError((error as Error).message);
                        setDiscard(null);
                        onRecoveryChanged();
                      }
                    }}
                  >
                    {t('legacyOutline.confirmDiscard')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}
        <label className='block text-sm'>
          <span className='block mb-1.5'>{t('legacyOutline.repository')}</span>
          <Select aria-label={t('legacyOutline.repository')} value={repository} disabled={busy} onValueChange={setRepository} className='w-full' options={[{ value: '', label: t('legacyOutline.chooseRepository') }, ...repositories.map(repo => ({ value: repo.id, label: repo.id }))]} />
        </label>
        {repository && <SavedLegacyImport key={repository} repository={repository} notebooks={notebooks.filter(notebook => repositories.find(repo => repo.id === repository)?.notebooks.includes(notebook.id))} onBusy={setBusy} onCreated={onCreated} onClose={close} />}
        {!repository && (
          <div className='flex justify-end'>
            <Button onClick={close}>{t('common.close')}</Button>
          </div>
        )}
      </div>
    </WorkspaceDialog>
  );
}

function SavedLegacyImport({ repository, notebooks, onBusy, onCreated, onClose }: { repository: string; notebooks: NotebookConfig[]; onBusy: (busy: boolean) => void; onCreated: (note: NoteRef) => Promise<void>; onClose: () => void; }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<LegacyOutlineSource | null>(null);
  const [error, setError] = useState('');
  const [notebookId, setNotebookId] = useState('');
  const [path, setPath] = useState('');
  const [title, setTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<LegacyOutlinePreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<LegacyOutlineImportRequest | null>(null);
  const [inspection, setInspection] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readLegacyOutlineSource(repository, controller.signal).then(result => {
      if (!controller.signal.aborted) setSource(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError((error as Error).message);
    });
    return () => controller.abort();
  }, [repository, reload]);
  const invalidate = () => {
    setPreview(null);
    setAcknowledged(false);
    setError('');
  };
  const request = { repository, notebookId, path, title, selectedIds };
  const entries = source?.page?.notebooks.find(owner => owner.notebookId === notebookId)?.bookmarks ?? [];
  const operation = async (run: () => Promise<void>) => {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await run();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <div className='space-y-4'>
      {source && <p className='text-xs text-muted break-all'>{source.path}{' · '}{t('legacyOutline.revision')}{': '}{source.revision}</p>}
      <div className='flex flex-wrap gap-2'>
        <Button disabled={source?.base64 == null} onClick={() => source && downloadLegacySource(source)}>{t('legacyOutline.exportSaved')}</Button>
        <Button
          disabled={busy || Boolean(uncertain)}
          onClick={() => {
            invalidate();
            setSource(null);
            setReload(value => value + 1);
          }}
        >
          {t('legacyOutline.reload')}
        </Button>
      </div>
      {source?.error && <p role='alert' className='text-sm text-danger'>{source.error}</p>}
      {source && source.base64 === null && <p className='text-sm'>{t('legacyOutline.noSource')}</p>}
      {source?.page && (
        <>
          <label className='block text-sm'>
            <span className='block mb-1.5'>{t('legacyOutline.notebook')}</span>
            <Select
              aria-label={t('legacyOutline.notebook')}
              value={notebookId}
              disabled={busy || Boolean(uncertain)}
              onValueChange={value => {
                invalidate();
                setNotebookId(value);
                setSelectedIds([]);
                setPath(`${notebooks.find(notebook => notebook.id === value)?.root ?? ''}/imported.outline.md`);
              }}
              className='w-full'
              options={[{ value: '', label: t('legacyOutline.chooseNotebook') }, ...notebooks.map(notebook => ({ value: notebook.id, label: `${notebook.title} · ${notebook.id}` }))]}
            />
          </label>
          <label className='block text-sm'>
            <span className='block mb-1.5'>{t('createNote.noteTitle')}</span>
            <input
              className='ui-control'
              value={title}
              disabled={busy || Boolean(uncertain)}
              onChange={event => {
                invalidate();
                setTitle(event.target.value);
              }}
            />
          </label>
          <label className='block text-sm'>
            <span className='block mb-1.5'>{t('legacyOutline.path')}</span>
            <input
              className='ui-control'
              value={path}
              disabled={busy || Boolean(uncertain)}
              onChange={event => {
                invalidate();
                setPath(event.target.value);
              }}
            />
          </label>
          <fieldset disabled={busy || Boolean(uncertain)} className='space-y-2'>
            <legend className='text-sm font-semibold mb-2'>{t('legacyOutline.selection')}</legend>
            {entries.map(entry => (
              <label key={entry.id} className='flex items-start gap-2 text-sm break-all'>
                <input
                  type='checkbox'
                  checked={selectedIds.includes(entry.id)}
                  onChange={event => {
                    invalidate();
                    setSelectedIds(ids => event.target.checked ? [...ids, entry.id] : ids.filter(id => id !== entry.id));
                  }}
                />
                <span>{entry.label}{' · '}{entry.id}{' · '}{entry.target.kind}</span>
              </label>
            ))}
          </fieldset>
          <Button
            disabled={busy || !notebookId || !title.trim() || !path || Boolean(uncertain)}
            onClick={() =>
              void operation(async () => {
                setPreview(null);
                setAcknowledged(false);
                setPreview(await previewLegacyOutline(request));
              })}
          >
            {t('legacyOutline.preview')}
          </Button>
        </>
      )}
      {preview && (
        <section aria-label={t('legacyOutline.preview')} className='space-y-3'>
          <p className='text-sm break-all'>{preview.repository}{' · '}{preview.notebookId}{' · '}{preview.path}</p>
          <p className='text-xs text-muted break-all'>{t('legacyOutline.revision')}{': '}{preview.revision}</p>
          <p className='text-sm'>{t(preview.persistence === 'commit' ? 'legacyOutline.commit' : 'legacyOutline.worktree')}</p>
          {!preview.writable && <p className='text-sm text-warning'>{t('legacyOutline.readOnly')}</p>}
          <h3 className='text-sm font-semibold'>{t('legacyOutline.converted')}</h3>
          <ul className='text-sm'>{preview.convertedIds.map(id => <li key={id}>{id}{' · '}{entries.find(entry => entry.id === id)?.label}</li>)}</ul>
          <h3 className='text-sm font-semibold'>{t('legacyOutline.groups')}</h3>
          <ul className='text-sm'>{preview.groups.map(group => <li key={group.id}>{group.label}{' · '}{group.id}{' · '}{group.convertedIds.join(', ')}</li>)}</ul>
          <h3 className='text-sm font-semibold'>{t('legacyOutline.retained')}</h3>
          <ul className='space-y-2 text-sm break-all'>
            {preview.retained.map(item => (
              <li key={`${item.notebookId}:${item.entry.id}`}>
                {item.notebookId}
                {' · '}
                {item.entry.id}
                {' · '}
                {item.entry.label}
                {' — '}
                {t(`legacyOutline.reason.${item.reason}`)}
                <details>
                  <summary>{t('legacyOutline.originalEntry')}</summary>
                  <pre className='whitespace-pre-wrap'>{JSON.stringify(item.entry, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
          {preview.markdown === null ? <p className='text-sm'>{t('legacyOutline.noOutput')}</p> : <pre className='border border-line rounded-lg p-3 text-xs whitespace-pre-wrap break-all'>{preview.markdown}</pre>}
          {preview.partial && (
            <label className='flex items-start gap-2 text-sm'>
              <input type='checkbox' checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
              <span>{t('legacyOutline.acknowledge')}</span>
            </label>
          )}
          <Button
            variant='primary'
            disabled={busy || !preview.writable || preview.markdown === null || (preview.partial && !acknowledged) || Boolean(uncertain)}
            onClick={() =>
              void operation(async () => {
                try {
                  await applyLegacyOutline(request, preview, acknowledged);
                } catch (error) {
                  setPreview(null);
                  // Only definitive client refusals permit another preview. Network/server errors may follow publication.
                  if (!(error instanceof ApiError) || ![400, 401, 403, 404, 409, 410, 413, 422].includes(error.status)) setUncertain(request);
                  throw error;
                }
                setUncertain(request); // A refresh/navigation failure must not turn a successful write into a retry.
                await onCreated(request);
              })}
          >
            {t(preview.partial ? 'legacyOutline.applyPartial' : 'legacyOutline.apply')}
          </Button>
        </section>
      )}
      {uncertain && (
        <div role='status' className='space-y-2 text-sm'>
          <p>{t('legacyOutline.uncertain')}</p>
          <p className='break-all'>{uncertain.repository}{' · '}{uncertain.path}</p>
          <Button
            disabled={busy}
            onClick={() =>
              void operation(async () => {
                const note = await readNote(uncertain.path, uncertain.notebookId);
                setInspection(note.content);
              })}
          >
            {t('legacyOutline.inspect')}
          </Button>
          {inspection && <pre className='whitespace-pre-wrap break-all'>{inspection}</pre>}
        </div>
      )}
      {error && <p role='alert' className='text-sm text-danger'>{error}</p>}
      <div className='flex justify-end'>
        <Button disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}
