import { GitCommit, RotateCcw } from 'lucide-react';
import type { GitStatus, NoteItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';

interface ChangesToolProps {
  gitStatus: GitStatus | null;
  deletedNotes: NoteItem[];
  onRestoreNote: (note: NoteItem) => void;
  onOpenCommitModal: () => void;
}

export function ChangesTool({ gitStatus, deletedNotes, onRestoreNote, onOpenCommitModal }: ChangesToolProps) {
  const { t } = useTranslation();
  const files = [...new Set([...(gitStatus?.staged || []), ...(gitStatus?.modified || []), ...(gitStatus?.untracked || [])])].sort();

  return (
    <div className="panel-tool changes-tool">
      {files.length === 0 && deletedNotes.length === 0 && <p className="todo-empty">{t('panel.changesEmpty')}</p>}

      {files.length > 0 && (
        <section className="todo-group">
          <h4>{t('panel.changesFiles')} <span className="todo-group-count">{files.length}</span></h4>
          <ul className="changes-file-list">
            {files.map(path => (
              <li key={path}>
                <button type="button" className="changes-file-button" title={t('panel.changesViewDiff', { path })} onClick={onOpenCommitModal}>{path}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {deletedNotes.length > 0 && (
        <section className="todo-group">
          <h4>{t('panel.changesDeleted')} <span className="todo-group-count">{deletedNotes.length}</span></h4>
          <ul className="changes-file-list">
            {deletedNotes.map(note => (
              <li key={note.path} className="changes-deleted-item">
                <span className="changes-file-label" title={note.path}>{note.title}</span>
                <button type="button" className="ui-icon-button" aria-label={t('footer.restore')} title={t('footer.restore')} onClick={() => onRestoreNote(note)}>
                  <RotateCcw aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(files.length > 0 || deletedNotes.length > 0) && (
        <button type="button" className="ui-button ui-button-primary changes-commit-button" onClick={onOpenCommitModal}>
          <GitCommit aria-hidden="true" />
          <span>{t('footer.commit')}</span>
        </button>
      )}
    </div>
  );
}
