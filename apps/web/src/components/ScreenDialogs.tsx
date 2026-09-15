import { Button } from './Button.js';
import { useState } from 'react';
import { parseYouTubeUrl, type ScreenItem, type ScreenRow } from '@mygitnotes/core/screen-page';
import { defaultStudyProgression, studyLaneStatuses, StudyProgressionSchema, type StudyProgression } from '@mygitnotes/core/study-stages';
import { StudyLaneSettings } from './StudyLane.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import { Select } from './Select.js';
import type { ScreenContentProps } from './ScreenCard.js';
import type { FolderItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { screenFolderOptions } from '../lib/screen-content.js';

type RowDialogContent = Pick<ScreenContentProps, 'notebooks' | 'notes' | 'assets'> & {
  folders: FolderItem[];
  selectedNotebookId: string;
};

function ScreenRowDialog({ notebooks, notes, assets, folders, selectedNotebookId, row, disabled, onApply, onClose, onRemove }: RowDialogContent & {
  row?: ScreenRow;
  disabled?: boolean;
  onApply: (row: ScreenRow) => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const source = row?.kind === 'dynamic' ? row.source : undefined;
  const [kind, setKind] = useState(row?.kind === 'dynamic' ? row.source.kind : 'custom');
  const [name, setName] = useState(row?.name || ''), [tag, setTag] = useState(source?.kind === 'tag' ? source.tag : '');
  const [notebookId, setNotebook] = useState(source?.notebookId || selectedNotebookId);
  const [tagNotebookId, setTagNotebook] = useState(source?.kind === 'tag' ? source.notebookId || '' : source?.notebookId || selectedNotebookId);
  const [folder, setFolder] = useState(source?.kind === 'folder' ? source.path : ''), [recursive, setRecursive] = useState(source?.kind === 'folder' ? source.recursive : true);
  const [view, setView] = useState<ScreenRow['view']>(row?.view || 'small');
  const [customProgression, setProgression] = useState<StudyProgression | undefined>(row?.progression);
  const [studyChanged, setStudyChanged] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [studyFilter, setStudyFilter] = useState<NonNullable<ScreenRow['study']>['filter']>(row?.study?.filter || 'all');
  const [stageError, setStageError] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const nb = notebooks.find(nb => nb.id === notebookId);
  const draftRow: ScreenRow = kind === 'custom' ? { id: row?.id || 'draft', name: name || 'draft', view, kind: 'custom', items: row?.kind === 'custom' ? row.items : [] }
    : { id: row?.id || 'draft', name: name || 'draft', view, kind: 'dynamic', source: kind === 'tag' ? { kind: 'tag', tag, ...(tagNotebookId ? { notebookId: tagNotebookId } : {}) } : { kind: 'folder', notebookId, path: folder || nb?.root || '', recursive } };
  const progression = customProgression || defaultStudyProgression(studyLaneStatuses(draftRow, notebooks)) || { stages: [], easy: 'two' as const };
  const tags = [...new Set(notes.filter(note => !tagNotebookId || note.notebookId === tagNotebookId).flatMap(note => note.tags))].sort();
  const options = !row ? [{ value: 'custom', label: t('screen.custom') }, { value: 'tag', label: t('screen.tagRow') }, { value: 'folder', label: t('screen.folderRow') }]
    : row.kind === 'dynamic' ? [{ value: 'tag', label: t('screen.tagRow') }, { value: 'folder', label: t('screen.folderRow') }]
    : [{ value: 'custom', label: t('screen.custom') }];
  return <WorkspaceDialog title={t(row ? 'screen.editRow' : 'screen.addRow')} onClose={onClose}>
    <form className="screen-form" onSubmit={event => {
      event.preventDefault();
      if (disabled || row && !name.trim()) return;
      const result = StudyProgressionSchema.safeParse(progression);
      if (studyChanged && !result.success) { setStageError(true); setAdvancedOpen(true); return; }
      const base = { id: row?.id || crypto.randomUUID(), name: name.trim() || t(kind === 'custom' ? 'screen.custom' : 'screen.dynamic'), view, ...(row?.graph ? { graph: row.graph } : {}), ...(studyChanged ? { study: { ...row?.study, filter: studyFilter, dueFirst: true } } : row?.study ? { study: row.study } : {}), ...(studyChanged && result.success ? { progression: result.data } : row?.progression ? { progression: row.progression } : {}) };
      const sort = row?.kind === 'dynamic' && row.sort ? { sort: row.sort } : {};
      onApply(kind === 'custom'
        ? { ...base, kind: 'custom', items: row?.kind === 'custom' ? row.items : [] }
        : { ...base, kind: 'dynamic', ...sort, source: kind === 'tag'
          ? { kind: 'tag', tag: tag.trim(), ...(tagNotebookId ? { notebookId: tagNotebookId } : {}) }
          : { kind: 'folder', notebookId, path: folder || nb!.root, recursive } });
      onClose();
    }}>
      <label>{t('screen.rowName')}<input className="ui-control" aria-label={t('screen.rowName')} value={name} maxLength={100} onChange={e => setName(e.target.value)} autoFocus /></label>
      {(!row || row.kind === 'dynamic') && <label>{t('screen.rowType')}<Select value={kind} disabled={disabled} onValueChange={setKind} options={options} /></label>}
      {kind === 'tag' && <><label>{t('sidebar.notebooks')}<Select value={tagNotebookId} onValueChange={id => { setTagNotebook(id); if (id) setNotebook(id); setTag(''); }} options={[{ value: '', label: t('screen.allNotebooks') }, ...notebooks.map(nb => ({ value: nb.id, label: nb.title }))]} /></label>
        <label>{t('screen.tag')}<input className="ui-control" value={tag} onChange={e => setTag(e.target.value)} list="screen-tags" required maxLength={200} /></label>
        <datalist id="screen-tags">{tags.map(tag => <option key={tag} value={tag} />)}</datalist></>}
      {kind === 'folder' && <label>{t('sidebar.notebooks')}<Select value={notebookId} onValueChange={id => { setNotebook(id); setFolder(''); }} options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} /></label>}
      {kind === 'folder' && <><label>{t('folder.folders')}<Select value={folder || nb?.root || ''} onValueChange={setFolder} options={screenFolderOptions(nb, folders, assets).map(folder => ({ value: folder.path, label: folder.title }))} /></label>
        <label className="screen-checkbox"><input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />{t('screen.recursive')}</label></>}
      <label>{t('screen.view')}<Select aria-label={t('screen.view')} value={view} disabled={disabled} onValueChange={value => setView(value as ScreenRow['view'])} options={(['thumbnail', 'small', 'medium', 'graph'] as const).map(value => ({ value, label: t(`screen.${value}`) }))} /></label>
      <details className="study-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
        <summary>{t('study.advanced')}</summary>
        <div className="study-advanced-content">
          <p>{t('study.defaultsHint')}</p>
          {progression.stages.length === 1 && <p className="study-single-stage">{t('study.singleStage')}</p>}
          {progression.stages.length === 0 && <p>{t('study.configureLane')}</p>}
          <label>{t('study.filter')}<Select aria-label={t('study.filter')} value={studyFilter} disabled={disabled} onValueChange={value => { setStudyFilter(value as typeof studyFilter); setStudyChanged(true); }} options={(['all', 'due', 'future', 'paused'] as const).map(value => ({ value, label: t(`study.filter.${value}`) }))} /></label>
          <StudyLaneSettings progression={progression} disabled={Boolean(disabled) || !advancedOpen} onChange={value => { setProgression(value); setStudyChanged(true); setStageError(false); }} />
          <Button disabled={disabled} onClick={() => { setProgression(undefined); setStudyChanged(true); setStageError(false); }}>{t('study.restoreDefaults')}</Button>
          {stageError && <p role="alert">{t('study.invalidStages')}</p>}
        </div>
      </details>
      {confirmRemove && <p className="screen-dialog-hint">{t('screen.removeRowHint')}</p>}
      <div className="workspace-dialog-actions">
        {onRemove && <Button type="button"  disabled={disabled} onClick={() => { if (!confirmRemove) setConfirmRemove(true); else { onRemove(); onClose(); } }}>{t(confirmRemove ? 'screen.confirmRemoveRow' : 'screen.removeRow')}</Button>}
        <Button  type="button" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={disabled || Boolean(row && !name.trim()) || kind === 'folder' && !nb || kind === 'tag' && !tag.trim()}>{t(row ? 'screen.apply' : 'screen.addRow')}</Button>
      </div>
    </form>
  </WorkspaceDialog>;
}

export function ScreenAddRow(props: RowDialogContent & { onAdd: (row: ScreenRow) => void; onClose: () => void }) {
  return <ScreenRowDialog {...props} onApply={props.onAdd} />;
}

export function ScreenEditRow(props: RowDialogContent & { row: ScreenRow; disabled?: boolean; onApply: (row: ScreenRow) => void; onRemove: () => void; onClose: () => void }) {
  return <ScreenRowDialog {...props} />;
}

export function ScreenAddItem({ rowName, notebooks, notes, assets, folders, selectedNotebookId, onAdd, onClose }: Omit<ScreenContentProps, 'onOpen'> & {
  rowName: string; folders: FolderItem[]; selectedNotebookId: string; onAdd: (item: ScreenItem) => void; onClose: () => void;
}) {
  const { t } = useTranslation(); const [kind, setKind] = useState('note');
  const [notebookId, setNotebook] = useState(selectedNotebookId), [query, setQuery] = useState(''), [youtube, setYoutube] = useState(''), [title, setTitle] = useState('');
  const nb = notebooks.find(nb => nb.id === notebookId);
  const options = kind === 'note' ? notes.filter(note => note.notebookId === notebookId).map(note => ({ path: note.path, title: note.title }))
    : kind === 'asset' ? assets.filter(asset => asset.notebookId === notebookId).map(asset => ({ path: asset.path, title: asset.name }))
    : screenFolderOptions(nb, folders, assets);
  const video = parseYouTubeUrl(youtube);
  return <WorkspaceDialog title={`${t('screen.addItem')} · ${rowName}`} onClose={onClose}>
    <div className="screen-form">
      <label>{t('screen.itemType')}<Select value={kind} onValueChange={setKind} options={[{ value: 'note', label: t('nav.notes') }, { value: 'folder', label: t('folder.folders') }, { value: 'asset', label: t('nav.assets') }, { value: 'youtube', label: 'YouTube' }]} /></label>
      {kind === 'youtube' ? <><label>YouTube URL<input autoFocus className="ui-control" type="url" value={youtube} onChange={e => setYoutube(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" /></label>
        <label>{t('screen.videoTitle')}<input className="ui-control" maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label>
        {youtube && !video && <p className="screen-form-error">{t('screen.invalidVideo')}</p>}
        <div className="workspace-dialog-actions"><Button variant="primary" disabled={!video} onClick={() => { if (video) { onAdd({ id: crypto.randomUUID(), kind: 'youtube', ...video, title: title.trim() || 'YouTube' }); onClose(); } }}>{t('screen.pin')}</Button></div>
      </> : <><label>{t('sidebar.notebooks')}<Select value={notebookId} onValueChange={id => { setNotebook(id); setQuery(''); }} options={notebooks.map(nb => ({ value: nb.id, label: nb.title }))} /></label>
        <input className="ui-control" type="search" aria-label={t('screen.findItem')} placeholder={t('screen.findItem')} value={query} onChange={e => setQuery(e.target.value)} />
        <div className="screen-item-options">{options.filter(option => `${option.title} ${option.path}`.toLowerCase().includes(query.toLowerCase())).map(option => <Button className="screen-item-option" key={option.path} onClick={() => {
          onAdd({ id: crypto.randomUUID(), kind: kind as 'note' | 'asset' | 'folder', notebookId, path: option.path }); onClose();
        }}><span>{option.title}</span><small>{option.path}</small></Button>)}</div></>}
    </div>
  </WorkspaceDialog>;
}
