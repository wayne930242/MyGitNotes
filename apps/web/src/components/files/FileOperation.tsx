import { Button } from '../Button.js';
import type { useFileManager } from './useFileManager.js';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export function FileOperation({ model }: { model: ReturnType<typeof useFileManager>; }) {
  const { t, listing: maybeListing, selected, busy, operation, setOperation, name, setName, destination, setDestination, title, setTitle, description, setDescription, order, setOrder, operationForm, mutable, infoHost, submit, operationLabel, destinationDirs, relative } = model;
  const listing = maybeListing!;
  const renderOperation = (form: ReactNode) => operation !== 'metadata' ? form : infoHost ? createPortal(form, infoHost) : null;

  return (
    <>
      {operation && mutable && renderOperation(
        <form
          ref={operationForm}
          className='file-operation'
          aria-label={operationLabel}
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3>{operationLabel}</h3>
          {['move', 'delete', 'remove-directory'].includes(operation) && (
            <p>
              <code>{selected}</code>
            </p>
          )}
          {['create', 'mkdir', 'move'].includes(operation) && (
            <label>
              {t('files.name')}
              <input
                className='ui-control'
                autoFocus
                required
                maxLength={120}
                pattern='[^/\\\\]+'
                value={name}
                disabled={busy}
                onChange={event => setName(event.target.value)}
              />
            </label>
          )}
          {(operation === 'move' || operation === 'remove-directory') && (
            <label>
              {t('files.destination')}
              <select className='ui-control' value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>{destinationDirs.map(dir => <option key={dir.path} value={dir.path}>{relative(dir.path)}</option>)}</select>
            </label>
          )}
          {operation === 'move' && (
            <p className='file-destination'>
              {t('files.newPath')}
              {': '}
              <code>{destination}/{name}</code>
            </p>
          )}
          {operation === 'remove-directory' && (
            <>
              <p>{t('files.removeHint', { count: listing.entries.filter(entry => entry.path.startsWith(selected + '/') && !entry.directory && entry.name !== '_dir.yml').length })}</p>
              <ul className='file-affected'>
                {listing.entries.filter(entry => entry.path.startsWith(selected + '/') && entry.path !== selected + '/_dir.yml').map(entry => (
                  <li key={entry.path}>
                    <code>{entry.path.slice(selected.length + 1)}{entry.directory ? '/' : ''}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {operation === 'delete' && <p>{t('files.deleteHint', { name: basename(selected) })}</p>}
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
          <div className='file-actions'>
            <button type='button' className='ui-button' disabled={busy} onClick={() => setOperation(undefined)}>{t('common.cancel')}</button>
            <Button type='submit' variant='primary' disabled={busy || operation === 'move' && destination + '/' + name.trim() === selected}>{operation === 'delete' || operation === 'remove-directory' ? t('files.confirmDelete') : t('common.save')}</Button>
          </div>
        </form>,
      )}
    </>
  );
}
