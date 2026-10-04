import { useState } from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import { defaultStudyProgression, studyLaneStatuses } from '@mygitnotes/core/study-stages';
import type { NoteListItem } from '@mygitnotes/core/note-query';
import type { NotebookConfig } from '../lib/types.js';
import { useCompilationActions } from '../lib/compilation-actions.js';
import { compilationRowItems, studyRowItems } from '../lib/compilation-content.js';
import { useLaneNotes } from '../lib/compilation-queries.js';
import { useTranslation } from '../lib/i18n/index.js';
import { useCompilation } from '../lib/use-compilation.js';
import { useStudyWorkspace } from '../lib/use-study-workspace.js';
import { Button } from './Button.js';
import { CompilationEditRow } from './CompilationDialogs.js';
import { LoadingStatus } from './LoadingStatus.js';
import { StudyLane } from './StudyLane.js';
import { useCompilationAssets } from './useCompilationItemOpen.js';
import type { FolderItem } from '../lib/types.js';
import './study.css';

/** The full-screen study session of one compilation: its notes ordered by the compilation's study settings. */
export function CompilationStudy({ notebooks, folders, notebookId, path, onOpenNote, onStudySaved, onBack }: { notebooks: NotebookConfig[]; folders: FolderItem[]; notebookId: string; path: string; onOpenNote: (note: NoteListItem) => void; onStudySaved: () => void; onBack: () => void; }) {
  const { t } = useTranslation();
  const actions = useCompilationActions();
  const compilation = useCompilation({ notebookId, path }, notebooks);
  const study = useStudyWorkspace(actions.repository(notebookId), onStudySaved);
  const { assets } = useCompilationAssets(notebooks, notebookId);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const row = compilation.page.rows[0];
  const reviewRow = row && { ...row, progression: row.progression || defaultStudyProgression(studyLaneStatuses(row, notebooks)), study: { ...row.study, filter: row.study?.filter || 'all' as const, dueFirst: true } };
  // A study session orders its whole queue, so the compilation reads every member at once.
  const lane = useLaneNotes(reviewRow, { all: true });
  const items = reviewRow ? studyRowItems(compilationRowItems(reviewRow, lane.notes, [], notebooks), reviewRow, lane.notes, study.study) : [];
  const notes = items.flatMap(item => item.kind === 'note' ? lane.notes.filter(note => note.notebookId === item.notebookId && note.path === item.path) : []);
  const disabled = !compilation.writable || compilation.loading || compilation.saving;
  return (
    <div className='workspace-route screen-main screen-focused'>
      <main className='screen-content'>
        <header className='screen-focus-header'>
          <Button className='study-back' aria-label={t('compilation.backTo')} onClick={onBack}>
            <ArrowLeft size={18} />
            <span>{t('compilation.backTo')}</span>
          </Button>
          {row && (
            <div className='study-header-actions'>
              <div className='study-undo-slot' ref={setToolbar} />
              <Button size='icon' disabled={disabled} aria-label={`${t('screen.editRow')}: ${row.name}`} onClick={() => setEditing(true)}>
                <Pencil size={18} />
              </Button>
            </div>
          )}
        </header>
        <div className='screen-board-scroll'>
          {study.error && (
            <div className='screen-error' role='alert'>
              {study.error}
              <Button onClick={() => void study.reload()}>{t('study.reload')}</Button>
            </div>
          )}
          {compilation.error && <p role='alert' className='screen-error'>{compilation.error}</p>}
          {compilation.loading ? <LoadingStatus>{t('screen.loading')}</LoadingStatus> : !row
            ? (
              <div className='screen-board-empty' role='status'>
                <p>{compilation.invalid[0]?.error ?? t('compilation.notFound')}</p>
              </div>
            )
            : reviewRow && <section id={`screen-lane-${reviewRow.id}`} className='screen-study-session' aria-label={reviewRow.name}>{lane.error && <p role='alert' className='screen-error'>{lane.error}</p>}{lane.loading ? <LoadingStatus>{t('notes.loading')}</LoadingStatus> : <StudyLane toolbar={toolbar} key={reviewRow.id} row={reviewRow} notes={notes} controller={study} disabled={disabled} onOpen={onOpenNote} />}</section>}
        </div>
      </main>
      {editing && row && (
        <CompilationEditRow
          row={row}
          disabled={disabled}
          notebooks={notebooks}
          assets={assets}
          folders={folders}
          selectedNotebookId={notebookId}
          onClose={() => setEditing(false)}
          onApply={next => compilation.change({ rows: [next] })}
          onRemove={() => {
            compilation.change({ rows: [] });
            onBack();
          }}
        />
      )}
    </div>
  );
}
