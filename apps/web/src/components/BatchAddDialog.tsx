import React, { useMemo, useState } from 'react';
import { focusTabKey } from '@mygitnotes/core/focus-page';
import type { NoteFocus } from '../lib/use-note-focus.js';
import { useNoteFacets, useNotePaths } from '../lib/use-note-queries.js';
import { focusErrorMessage } from '../lib/focus-error-message.js';
import { batchAddCandidates, batchAddExisting, batchAddMode, batchAddResult, batchAddTabs } from '../lib/batch-add.js';
import type { FolderItem } from '../lib/types.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';
import { Select } from './Select.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';
import './graph-filters.css';

/**
 * Adds every note matching a folder and/or tag filter to one pane, deduplicated against what it already holds.
 * Folder and tags combine with Or by default (either condition matches) or And (both must).
 */
export const BatchAddDialog: React.FC<{
  focus: NoteFocus; target: string; pane: number; notebookId: string; notebookRoot: string; folders: readonly FolderItem[]; onClose: () => void;
}> = ({ focus, target, pane, notebookId, notebookRoot, folders, onClose }) => {
  const { t } = useTranslation();
  const [folder, setFolder] = useState('');
  const [descendants, setDescendants] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any');
  const [combine, setCombine] = useState<'or' | 'and'>('or');
  const [result, setResult] = useState<{ added: number; existing: number; full: number } | null>(null);
  const [error, setError] = useState('');

  const folderOptions = useMemo(() => folders.filter(item => item.notebookId === notebookId)
    .map(item => ({ value: `${notebookRoot}/${item.path}`, label: item.title || item.path }))
    .sort((a, b) => a.label.localeCompare(b.label)), [folders, notebookId, notebookRoot]);
  const tagFacets = useNoteFacets(false);
  const tagOptions = useMemo(() => Object.keys(tagFacets.facets?.[notebookId]?.tags ?? {}).sort(), [tagFacets.facets, notebookId]);

  const hasFolder = folder !== '', hasTags = tags.length > 0;
  // A single condition needs one query (And and Or agree); both conditions under Or need the two unioned client-side.
  const mode = batchAddMode(hasFolder, hasTags, combine);
  const andResult = useNotePaths(mode === 'and' && (hasFolder || hasTags)
    ? { notebookId, folders: hasFolder ? [folder] : [], descendants, tags, tagMode } : null);
  const folderResult = useNotePaths(mode === 'or' ? { notebookId, folders: [folder], descendants } : null);
  const tagsResult = useNotePaths(mode === 'or' ? { notebookId, tags, tagMode } : null);
  const candidatePaths = batchAddCandidates(mode, andResult.paths, folderResult.paths, tagsResult.paths);
  const loading = mode === 'or' ? (folderResult.loading || tagsResult.loading) : andResult.loading;

  const toggleTag = (tag: string) => setTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (result || (!hasFolder && !hasTags) || loading) return;
    const tabs = batchAddTabs(candidatePaths);
    const heldKeys = new Set((focus.layoutOf(target)?.panes[pane]?.tabs ?? []).map(focusTabKey));
    const existing = batchAddExisting(tabs, heldKeys);
    let outcome: { added: number; skipped: number } | false;
    try { outcome = focus.addBatch(target, tabs, pane); }
    catch (caught) { setError(focusErrorMessage(t, caught)); return; }
    if (!outcome) { setError(t('focus.addFailed')); return; }
    setResult(batchAddResult(outcome, existing));
  };

  return <WorkspaceDialog title={t('focus.batchAdd')} onClose={onClose} className="focus-batch-dialog">
    <form className="screen-form" onSubmit={submit}>
      <label className="focus-batch-folder">{t('focus.batchAddFolder')}
        <Select value={folder} disabled={Boolean(result)} onValueChange={setFolder}
          options={[{ value: '', label: t('folder.allFolders') }, ...folderOptions]} />
      </label>
      <label className="filter-check"><input type="checkbox" checked={descendants} disabled={Boolean(result)}
        onChange={event => setDescendants(event.target.checked)} />{t('filters.descendants')}</label>
      <fieldset><legend>{t('filters.tags')}</legend>
        <label className="filter-tag-mode">{t('filters.tagMode')}
          <Select value={tagMode} disabled={Boolean(result)} onValueChange={value => setTagMode(value as 'any' | 'all')}
            options={[{ value: 'any', label: t('filters.any') }, { value: 'all', label: t('filters.all') }]} />
        </label>
        <div className="filter-options">
          {tagOptions.map(tag => <label className="filter-check" key={tag}>
            <input type="checkbox" checked={tags.includes(tag)} disabled={Boolean(result)} onChange={() => toggleTag(tag)} /><span>#{tag}</span>
          </label>)}
          {!tagOptions.length && <p className="filter-empty">{t('filters.noOptions')}</p>}
        </div>
      </fieldset>
      {hasFolder && hasTags && <label className="focus-batch-combine">{t('focus.batchAddCombine')}
        <Select value={combine} disabled={Boolean(result)} onValueChange={value => setCombine(value as 'or' | 'and')}
          options={[{ value: 'or', label: t('focus.batchAddCombineOr') }, { value: 'and', label: t('focus.batchAddCombineAnd') }]} />
      </label>}
      {!result && (hasFolder || hasTags) && <p className="filter-results">{t('filters.results', { count: candidatePaths.length })}</p>}
      {!result && !hasFolder && !hasTags && <p className="filter-empty">{t('focus.batchAddNoFilter')}</p>}
      {result && <p role="status">{t(result.full > 0 ? 'focus.batchAddResultFull' : 'focus.batchAddResult', result)}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="workspace-dialog-actions">
        <Button type="button" onClick={onClose}>{t(result ? 'common.close' : 'common.cancel')}</Button>
        {!result && <Button type="submit" variant="primary" disabled={(!hasFolder && !hasTags) || loading}>{t('common.confirm')}</Button>}
      </div>
    </form>
  </WorkspaceDialog>;
};
