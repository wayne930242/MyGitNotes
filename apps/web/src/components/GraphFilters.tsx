import { useId, useRef, useState, type ReactNode } from 'react';
import { Filter, Search, X } from 'lucide-react';
import type { FilterControls } from '../lib/filter-controls.js';
import { useTranslation } from '../lib/i18n/index.js';
import './graph-filters.css';


export function GraphFilters({ value, neighbors, notebooks, folders, tags, statuses, onChange, allNotebooks, onAllNotebooksChange, onClear, showOrphans, onToggleOrphans, children, extraCount = 0 }: FilterControls & { showOrphans?: boolean; onToggleOrphans?: () => void; children?: ReactNode; extraCount?: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [optionSearch, setOptionSearch] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  const folderChoices = folders.flatMap(folder => {
    const notebook = notebooks.find(nb => nb.id === folder.notebookId);
    return notebook && (value.notebookId === 'all' || notebook.id === value.notebookId)
      ? [{ path: `${notebook.root.replace(/\/$/, '')}/${folder.path}`, label: `${notebook.title} / ${folder.path}` }] : [];
  }).sort((a, b) => a.label.localeCompare(b.label));
  const folderLabel = (path: string) => folderChoices.find(folder => folder.path === path)?.label || path;
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...value.folders.map(folder => ({ key: `folder:${folder}`, label: folderLabel(folder), remove: () => onChange({ folders: value.folders.filter(item => item !== folder) }) })),
    ...value.tags.map(tag => ({ key: `tag:${tag}`, label: `#${tag}`, remove: () => onChange({ tags: value.tags.filter(item => item !== tag) }) })),
    ...(!value.descendants ? [{ key: 'descendants', label: t('filters.directOnly'), remove: () => onChange({ descendants: true }) }] : []),
    ...(value.tagMode === 'all' ? [{ key: 'tagMode', label: t('filters.all'), remove: () => onChange({ tagMode: 'any' }) }] : []),
    ...(value.q ? [{ key: 'q', label: value.q, remove: () => onChange({ q: '' }) }] : []),
    ...(value.status ? [{ key: 'status', label: value.status, remove: () => onChange({ status: null }) }] : []),
    ...(value.showHidden ? [{ key: 'hidden', label: t('filters.hidden'), remove: () => onChange({ showHidden: false }) }] : []),
    ...(neighbors ? [{ key: 'neighbors', label: t('filters.neighbors'), remove: () => onChange({ neighbors: false }) }] : []),
  ];
  const needle = optionSearch.toLocaleLowerCase();
  const visibleFolders = folderChoices.filter(folder => folder.label.toLocaleLowerCase().includes(needle));
  const visibleTags = [...new Set([...value.tags, ...tags])].filter(tag => tag.toLocaleLowerCase().includes(needle)).sort();
  const conditionChips = <div className="filter-chips">
    {chips.map(chip => <button type="button" className="filter-chip" key={chip.key} onClick={chip.remove} aria-label={t('filters.remove', { value: chip.label })}><span>{chip.label}</span><X size={12} aria-hidden="true" /></button>)}
    {chips.length + extraCount > 0 && <button type="button" className="filter-clear" onClick={onClear}>{t('filters.clear')}</button>}
  </div>;
  return <section className="graph-filters is-compact" aria-label={t('filters.title')}
    onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}>
    <div className="filter-summary">
      <label className="filter-search header-search"><Search size={15} aria-hidden="true" />
        <input type="search" aria-label={t('header.searchPlaceholder')} placeholder={t('header.searchPlaceholder')} value={value.q} onChange={event => onChange({ q: event.target.value })} />
      </label>
      <button type="button" className="ui-button filter-trigger" ref={trigger} aria-label={t('filters.title')} title={t('filters.title')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
        <Filter size={14} aria-hidden="true" /><span className="filter-count">{chips.length + extraCount}</span>
      </button>
      {onToggleOrphans && <button type="button" className="ui-button" aria-pressed={showOrphans} onClick={onToggleOrphans}>{t('graph.showOrphans')}</button>}
    </div>
    {open && <div id={id} className="filter-details">
      <div className="filter-details-heading"><strong>{t('filters.title')}</strong><button type="button" className="ui-button" aria-label={t('filters.close')} onClick={close}><X size={14} /></button></div>
      {conditionChips}
      {children}
      {notebooks.length > 1 && <label className="filter-check"><input type="checkbox" checked={allNotebooks} onChange={event => onAllNotebooksChange(event.target.checked)} />{t('filters.allNotebooks')}</label>}
      <div className="filter-fields">
        <label>{t('sidebar.statusFilter')}<select value={value.status || ''} onChange={event => onChange({ status: event.target.value || null })}>
          <option value="">{t('sidebar.allStatuses')}</option>{[...new Set([...(value.status ? [value.status] : []), ...statuses])].map(status => <option key={status} value={status}>{status}</option>)}
        </select></label>
      </div>
      <label className="filter-option-search">{t('filters.findOptions')}<input type="search" value={optionSearch} onChange={event => setOptionSearch(event.target.value)} /></label>
      <fieldset><legend>{t('folder.folders')}</legend>
        <label className="filter-check"><input type="checkbox" checked={value.descendants} onChange={event => onChange({ descendants: event.target.checked })} />{t('filters.descendants')}</label>
        <div className="filter-options">
          {visibleFolders.map(folder => <label className="filter-check" key={folder.path}><input type="checkbox" checked={value.folders.includes(folder.path)} onChange={() => onChange({ folders: toggle(value.folders, folder.path) })} /><span>{folder.label}</span></label>)}
          {!visibleFolders.length && <p className="filter-empty">{t('filters.noOptions')}</p>}
        </div>
      </fieldset>
      <fieldset><legend>{t('filters.tags')}</legend>
        <label className="filter-tag-mode">{t('filters.tagMode')}<select value={value.tagMode} onChange={event => onChange({ tagMode: event.target.value as 'any' | 'all' })}>
          <option value="any">{t('filters.any')}</option><option value="all">{t('filters.all')}</option>
        </select></label>
        <div className="filter-options">{visibleTags.map(tag => <label className="filter-check" key={tag}><input type="checkbox" checked={value.tags.includes(tag)} onChange={() => onChange({ tags: toggle(value.tags, tag) })} /><span>#{tag}</span></label>)}
          {!visibleTags.length && <p className="filter-empty">{t('filters.noOptions')}</p>}
        </div>
      </fieldset>
      <label className="filter-check"><input type="checkbox" checked={value.showHidden} onChange={event => onChange({ showHidden: event.target.checked })} />{t('filters.hidden')}</label>
      <label className="filter-check"><input type="checkbox" checked={neighbors} onChange={event => onChange({ neighbors: event.target.checked })} />{t('filters.neighbors')}</label>
    </div>}
  </section>;
}
