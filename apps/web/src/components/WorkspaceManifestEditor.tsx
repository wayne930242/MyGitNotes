import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { NotebookConfig, NotebookMetadataField, WorkspaceConfig } from '@mygitnotes/core';
import YAML from 'yaml';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

interface WorkspaceManifestEditorProps {
  yamlContent: string;
  onChange: (yaml: string) => void;
  readOnly: boolean;
}

type EditorMode = 'advanced' | 'form';

const YOUTUBE_MODES = ['thumbnail', 'medium', 'theater'] as const;
const METADATA_TYPES = ['string', 'boolean', 'number'] as const;

/** Lenient shape check only: full validation (duplicate ids, overlapping roots, etc.) happens server-side on Save. */
function parseFormConfig(yamlContent: string): WorkspaceConfig | null {
  try {
    const raw = YAML.parse(yamlContent);
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<WorkspaceConfig>;
    if (!candidate.workspace || !Array.isArray(candidate.notebooks)) return null;
    return candidate as WorkspaceConfig;
  } catch {
    return null;
  }
}

export const WorkspaceManifestEditor: React.FC<WorkspaceManifestEditorProps> = ({ yamlContent, onChange, readOnly }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EditorMode>(() => parseFormConfig(yamlContent) ? 'form' : 'advanced');

  const parsed = useMemo(() => parseFormConfig(yamlContent), [yamlContent]);

  const updateConfig = (updater: (config: WorkspaceConfig) => WorkspaceConfig) => {
    if (!parsed) return;
    onChange(YAML.stringify(updater(parsed)));
  };

  const updateNotebook = (id: string, updater: (notebook: NotebookConfig) => NotebookConfig) => {
    updateConfig(config => ({ ...config, notebooks: config.notebooks.map(nb => nb.id === id ? updater(nb) : nb) }));
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2' role='tablist' aria-label={t('settings.manifestMode')}>{(['advanced', 'form'] as const).map(candidate => <button key={candidate} type='button' role='tab' aria-selected={mode === candidate} onClick={() => setMode(candidate)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${mode === candidate ? 'border-primary bg-primary-soft/40 text-fg' : 'border-line text-muted hover:text-fg'}`}>{candidate === 'advanced' ? t('settings.manifestModeAdvanced') : t('settings.manifestModeForm')}</button>)}</div>
      {mode === 'advanced' && <textarea style={{ caretColor: 'currentColor' }} readOnly={readOnly} aria-label={t('settings.manifest')} value={yamlContent} onChange={e => onChange(e.target.value)} rows={12} className='w-full p-4 font-mono text-xs bg-code text-fg rounded-xl focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed border border-line' spellCheck={false} />}
      {mode === 'form' && (!parsed ? <p className='text-xs text-danger'>{t('settings.manifestFormInvalid')}</p> : (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <label className='flex flex-col gap-1 text-xs'>
              <span className='font-semibold text-fg'>{t('settings.manifestWorkspaceTitle')}</span>
              <input type='text' disabled={readOnly} value={parsed.workspace.title} onChange={e => updateConfig(config => ({ ...config, workspace: { ...config.workspace, title: e.target.value } }))} className='w-full p-2 text-xs bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary' />
            </label>
            <label className='flex flex-col gap-1 text-xs'>
              <span className='font-semibold text-fg'>{t('settings.manifestDefaultNotebook')}</span>
              <select disabled={readOnly} value={parsed.workspace.default_notebook} onChange={e => updateConfig(config => ({ ...config, workspace: { ...config.workspace, default_notebook: e.target.value } }))} className='w-full p-2 text-xs bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary'>{parsed.notebooks.map(nb => <option key={nb.id} value={nb.id}>{nb.title}</option>)}</select>
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <input type='checkbox' disabled={readOnly} checked={parsed.files?.hide_dotfiles ?? true} onChange={e => updateConfig(config => ({ ...config, files: { ...config.files, hide_dotfiles: e.target.checked } }))} />
              <span className='font-semibold text-fg'>{t('settings.manifestHideDotfiles')}</span>
            </label>
          </div>
          <div className='flex flex-col gap-2'>
            <h4 className='text-xs font-semibold text-fg uppercase tracking-wider'>{t('settings.manifestPreferences')}</h4>
            <label className='flex flex-col gap-1 text-xs'>
              <span className='font-semibold text-fg'>{t('settings.manifestYoutubeMode')}</span>
              <select disabled={readOnly} value={parsed.preferences?.defaultYoutubeDisplayMode ?? 'thumbnail'} onChange={e => updateConfig(config => ({ ...config, preferences: { ...config.preferences, defaultYoutubeDisplayMode: e.target.value as typeof YOUTUBE_MODES[number] } }))} className='w-full p-2 text-xs bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary'>{YOUTUBE_MODES.map(m => <option key={m} value={m}>{t(`youtube.${m}` as const)}</option>)}</select>
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <input type='checkbox' disabled={readOnly} checked={parsed.preferences?.defaultShowLineNumbers ?? false} onChange={e => updateConfig(config => ({ ...config, preferences: { ...config.preferences, defaultShowLineNumbers: e.target.checked } }))} />
              <span className='font-semibold text-fg'>{t('settings.manifestShowLineNumbers')}</span>
            </label>
            <label className='flex items-center gap-2 text-xs'>
              <input type='checkbox' disabled={readOnly} checked={parsed.preferences?.defaultFocusMode ?? false} onChange={e => updateConfig(config => ({ ...config, preferences: { ...config.preferences, defaultFocusMode: e.target.checked } }))} />
              <span className='font-semibold text-fg'>{t('settings.manifestFocusMode')}</span>
            </label>
          </div>
          <div className='flex flex-col gap-3'>
            <h4 className='text-xs font-semibold text-fg uppercase tracking-wider'>{t('settings.manifestNotebooks')}</h4>
            {parsed.notebooks.map(nb => (
              <div key={nb.id} className='flex flex-col gap-2 p-3 border border-line rounded-xl bg-sidebar'>
                <div className='text-xs font-semibold text-fg'>
                  {nb.title} <span className='text-muted font-mono'>({nb.id})</span>
                </div>
                <label className='flex flex-col gap-1 text-xs'>
                  <span className='text-muted'>{t('settings.manifestNotebookRoot')}</span>
                  <input type='text' disabled={readOnly} value={nb.root} onChange={e => updateNotebook(nb.id, current => ({ ...current, root: e.target.value }))} className='w-full p-2 text-xs font-mono bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary' />
                </label>
                <div className='flex flex-col gap-1'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-muted'>{t('settings.manifestNotebookMetadata')}</span>
                    {!readOnly && (
                      <Button size='small' type='button' onClick={() => updateNotebook(nb.id, current => ({ ...current, metadata: [...(current.metadata ?? []), { key: '' }] }))}>
                        <Plus className='w-3 h-3' />
                        <span>{t('settings.manifestAddMetadataField')}</span>
                      </Button>
                    )}
                  </div>
                  {(nb.metadata ?? []).map((field, index) => (
                    <div key={index} className='flex flex-col sm:flex-row sm:items-center gap-1.5'>
                      <input type='text' disabled={readOnly} aria-label={t('settings.manifestMetadataKeyPlaceholder')} placeholder={t('settings.manifestMetadataKeyPlaceholder')} value={field.key} onChange={e => updateNotebook(nb.id, current => ({ ...current, metadata: (current.metadata ?? []).map((f, i) => i === index ? { ...f, key: e.target.value } : f) }))} className='min-w-0 flex-1 p-1.5 text-xs font-mono bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary' />
                      <select disabled={readOnly} aria-label={t('settings.manifestMetadataType')} value={field.type ?? 'string'} onChange={e => updateNotebook(nb.id, current => ({ ...current, metadata: (current.metadata ?? []).map((f, i) => i === index ? { ...f, type: e.target.value as NotebookMetadataField['type'] } : f) }))} className='p-1.5 text-xs bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary'>{METADATA_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select>
                      <input type='text' disabled={readOnly} aria-label={t('settings.manifestMetadataLabelPlaceholder')} placeholder={t('settings.manifestMetadataLabelPlaceholder')} value={field.label ?? ''} onChange={e => updateNotebook(nb.id, current => ({ ...current, metadata: (current.metadata ?? []).map((f, i) => i === index ? { ...f, label: e.target.value } : f) }))} className='min-w-0 flex-1 p-1.5 text-xs bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary' />
                      {!readOnly && (
                        <Button size='icon' type='button' onClick={() => updateNotebook(nb.id, current => ({ ...current, metadata: (current.metadata ?? []).filter((_, i) => i !== index) }))} aria-label={t('settings.manifestRemove')}>
                          <Trash2 className='w-3 h-3' />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <div className='flex flex-col gap-1'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-xs text-muted'>{t('settings.manifestNotebookPathAliases')}</span>
                    {!readOnly && (
                      <Button size='small' type='button' onClick={() => updateNotebook(nb.id, current => ({ ...current, pathAliases: { ...current.pathAliases, '': '' } }))}>
                        <Plus className='w-3 h-3' />
                        <span>{t('settings.manifestAddPathAlias')}</span>
                      </Button>
                    )}
                  </div>
                  {Object.entries(nb.pathAliases ?? {}).map(([alias, target], index) => (
                    <div key={index} className='flex flex-col sm:flex-row sm:items-center gap-1.5'>
                      <input
                        type='text'
                        disabled={readOnly}
                        aria-label={t('settings.manifestPathAliasKeyPlaceholder')}
                        placeholder={t('settings.manifestPathAliasKeyPlaceholder')}
                        value={alias}
                        onChange={e =>
                          updateNotebook(nb.id, current => {
                            const entries = Object.entries(current.pathAliases ?? {});
                            entries[index] = [e.target.value, entries[index][1]];
                            return { ...current, pathAliases: Object.fromEntries(entries) };
                          })}
                        className='min-w-0 flex-1 p-1.5 text-xs font-mono bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary'
                      />
                      <input
                        type='text'
                        disabled={readOnly}
                        aria-label={t('settings.manifestPathAliasTargetPlaceholder')}
                        placeholder={t('settings.manifestPathAliasTargetPlaceholder')}
                        value={target}
                        onChange={e => updateNotebook(nb.id, current => {
                          const entries = Object.entries(current.pathAliases ?? {});
                          entries[index] = [entries[index][0], e.target.value];
                          return { ...current, pathAliases: Object.fromEntries(entries) };
                        })}
                        className='min-w-0 flex-1 p-1.5 text-xs font-mono bg-surface border border-line rounded-lg focus:outline-none focus:ring-2 focus:ring-primary'
                      />
                      {!readOnly && (
                        <Button
                          size='icon'
                          type='button'
                          onClick={() =>
                            updateNotebook(nb.id, current => {
                              const entries = Object.entries(current.pathAliases ?? {}).filter((_, i) => i !== index);
                              return { ...current, pathAliases: Object.fromEntries(entries) };
                            })}
                          aria-label={t('settings.manifestRemove')}
                        >
                          <Trash2 className='w-3 h-3' />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
