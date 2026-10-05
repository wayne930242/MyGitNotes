import { useState } from 'react';
import { Button } from './Button.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { useTranslation } from '../lib/i18n/index.js';
import { noteStem, renamedPath } from '../lib/note-move.js';

/** Names a note: its title, and the file name that follows from it in the same folder. */
export function RenameNoteDialog({ path, title, busy, onClose, onConfirm }: { path: string; title: string; busy: boolean; onClose: () => void; onConfirm: (title: string) => void; }) {
  const { t } = useTranslation();
  const [name, setName] = useState(title);
  const valid = Boolean(noteStem(name));
  const submit = () => {
    if (valid && !busy) onConfirm(name);
  };
  return (
    <WorkspaceDialog title={t('files.renameTitle', { title })} onClose={onClose}>
      <form
        className='screen-form'
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <label>
          {t('files.renameLabel')}
          <input className='ui-control' aria-label={t('files.renameLabel')} value={name} maxLength={100} onChange={event => setName(event.target.value)} onFocus={event => event.target.select()} autoFocus />
        </label>
        <p className='text-xs text-muted font-mono break-all'>{valid ? t('files.renameFile', { file: renamedPath(path, name).split('/').pop() ?? '' }) : t('files.renameInvalid')}</p>
        <div className='workspace-dialog-actions'>
          <Button type='button' onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type='submit' variant='primary' disabled={busy || !valid}>{t('files.rename')}</Button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
