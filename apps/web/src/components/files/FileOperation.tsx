import { Button } from '../Button.js';
import { WorkspaceDialog } from '../WorkspaceDialog.js';
import type { useFileManager } from './useFileManager.js';
import { createPortal } from 'react-dom';
import { baseName } from '../../lib/paths.js';

export function FileOperation({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { t, listing, selected, busy, operation, setOperation, name, setName, destination, setDestination, title, setTitle, description, setDescription, order, setOrder, operationForm, mutable, infoHost, submit, operationLabel, destinationDirs, relative, deleteMode, setDeleteMode, deleteConfirmed, setDeleteConfirmed, metadataReady, error } = model;
  if (!operation || !mutable || !listing) return null;
  const deletingFolder = operation === 'remove-directory';
  const destructive = deletingFolder && deleteMode === 'contents';
  const affected = listing.entries.filter(entry => entry.path.startsWith(selected + '/') && (destructive || entry.path !== selected + '/_dir.yml'));
  const close = () => {
    if (!busy) setOperation(undefined);
  };
  const form = (
    <form
      ref={operationForm}
      className='file-operation'
      aria-label={operationLabel}
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      {operation === 'metadata' && <h3>{operationLabel}</h3>}
      {['move', 'rename', 'delete', 'remove-directory'].includes(operation) && (
        <p>
          <code>{selected}</code>
        </p>
      )}
      {['create', 'mkdir', 'rename'].includes(operation) && (
        <label>
          {t('files.name')}
          <input className='ui-control' autoFocus required maxLength={120} pattern='[^/\\\\]+' value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        </label>
      )}
      {deletingFolder && (
        <fieldset disabled={busy} className='file-delete-choice'>
          <legend>{t('files.remove-directory')}</legend>
          <label>
            <input
              type='radio'
              name='folder-delete-mode'
              value='preserve'
              checked={!destructive}
              onChange={() => {
                setDeleteMode('preserve');
                setDeleteConfirmed(false);
              }}
            />
            {t('files.preserveContents')}
          </label>
          <label>
            <input
              type='radio'
              name='folder-delete-mode'
              value='contents'
              checked={destructive}
              onChange={() => {
                setDeleteMode('contents');
                setDeleteConfirmed(false);
              }}
            />
            {t('files.deleteContents')}
          </label>
        </fieldset>
      )}
      {(operation === 'move' || deletingFolder && !destructive) && (
        <label>
          {t('files.destination')}
          <select className='ui-control' autoFocus={operation === 'move'} value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>{destinationDirs.map(dir => <option key={dir.path} value={dir.path}>{relative(dir.path)}</option>)}</select>
        </label>
      )}
      {(operation === 'move' || operation === 'rename') && (
        <p className='file-destination'>
          {t('files.newPath')}
          {': '}
          <code>{destination}/{name}</code>
        </p>
      )}
      {deletingFolder && (
        <>
          <p>{t(destructive ? 'files.deleteTreeHint' : 'files.removeHint', { count: affected.filter(entry => !entry.directory).length })}</p>
          <ul className='file-affected'>
            {affected.map(entry => (
              <li key={entry.path}>
                <code>{entry.path.slice(selected.length + 1)}{entry.directory ? '/' : ''}</code>
              </li>
            ))}
          </ul>
          {destructive && (
            <label className='file-delete-confirm'>
              <input type='checkbox' checked={deleteConfirmed} disabled={busy} onChange={event => setDeleteConfirmed(event.target.checked)} />
              {t('files.deleteTreeConfirm')}
            </label>
          )}
        </>
      )}
      {operation === 'delete' && <p>{t('files.deleteHint', { name: baseName(selected) })}</p>}
      {operation === 'metadata' && (
        <>
          <label>
            {t('files.title')}
            <input className='ui-control' value={title} required disabled={busy} onChange={event => setTitle(event.target.value)} />
          </label>
          <label>
            {t('files.description')}
            <textarea className='ui-control' value={description} disabled={busy} onChange={event => setDescription(event.target.value)} />
          </label>
          <label>
            {t('files.order')}
            <input type='number' className='ui-control' value={order} required disabled={busy} onChange={event => setOrder(Number(event.target.value))} />
          </label>
        </>
      )}
      {error && <p role='alert' className='file-error'>{error}</p>}
      <div className='file-actions'>
        <button type='button' className='ui-button' disabled={busy} onClick={close}>{t('common.cancel')}</button>
        <Button type='submit' variant='primary' disabled={busy || operation === 'metadata' && !metadataReady || destructive && !deleteConfirmed || (operation === 'move' || operation === 'rename') && destination + '/' + name.trim() === selected}>{operation === 'delete' || deletingFolder ? t('files.confirmDelete') : t('common.save')}</Button>
      </div>
    </form>
  );
  return operation === 'metadata' ? infoHost ? createPortal(form, infoHost) : null : <WorkspaceDialog title={operationLabel} onClose={close}>{form}</WorkspaceDialog>;
}
