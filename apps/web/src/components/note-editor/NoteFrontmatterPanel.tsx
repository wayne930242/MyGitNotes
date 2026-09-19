import { useMemo } from 'react';
import YAML from 'yaml';
import { Code } from 'lucide-react';
import { isNoteHidden, withNoteStatus } from '@mygitnotes/core/note-status';
import { Select } from '../Select.js';
import { FileSourceEditor } from '../FileSourceEditor.js';
import { NotebookMetadataField } from '../../lib/types.js';
import { useTranslation } from '../../lib/i18n/index.js';

export interface NoteFrontmatterPanelProps {
  metadata: Record<string, unknown>;
  setMetadata: (metadata: Record<string, unknown>) => void;
  statuses: string[];
  metadataFields?: NotebookMetadataField[];
  availableTags: string[];
  locked: boolean;
  newFieldKey: string;
  setNewFieldKey: (value: string) => void;
  frontmatterViewMode: 'form' | 'yaml';
  setFrontmatterViewMode: (mode: 'form' | 'yaml') => void;
  yamlText: string;
  setYamlText: (value: string) => void;
  yamlError: string;
  setYamlError: (value: string) => void;
  tagInput: string;
  setTagInput: (value: string) => void;
  isTagDropdownOpen: boolean;
  setIsTagDropdownOpen: (value: boolean) => void;
}

/** A note's frontmatter: title, status, tags with autocomplete, custom metadata fields, and a raw-YAML view. */
export function NoteFrontmatterPanel({ metadata, setMetadata, statuses, metadataFields, availableTags, locked, newFieldKey, setNewFieldKey, frontmatterViewMode, setFrontmatterViewMode, yamlText, setYamlText, yamlError, setYamlError, tagInput, setTagInput, isTagDropdownOpen, setIsTagDropdownOpen }: NoteFrontmatterPanelProps) {
  const { t } = useTranslation();

  const customFields = useMemo(() => {
    const RESERVED_METADATA_KEYS = new Set(['title', 'status', 'hiden', 'tags', 'created', 'updated']);
    const fields: { key: string; type: 'string' | 'boolean' | 'number'; label: string; isConfigured: boolean; }[] = [];
    const seen = new Set<string>();

    if (metadataFields) {
      for (const f of metadataFields) {
        if (!RESERVED_METADATA_KEYS.has(f.key)) {
          fields.push({ key: f.key, type: f.type || (typeof metadata[f.key] === 'boolean' ? 'boolean' : typeof metadata[f.key] === 'number' ? 'number' : 'string'), label: f.label || f.key, isConfigured: true });
          seen.add(f.key);
        }
      }
    }

    for (const key of Object.keys(metadata)) {
      if (!RESERVED_METADATA_KEYS.has(key) && !seen.has(key)) {
        const val = metadata[key];
        const inferredType: 'string' | 'boolean' | 'number' = typeof val === 'boolean' ? 'boolean' : typeof val === 'number' ? 'number' : 'string';
        fields.push({ key, type: inferredType, label: key, isConfigured: false });
        seen.add(key);
      }
    }
    return fields;
  }, [metadataFields, metadata]);

  const currentTags: string[] = useMemo(() => {
    return Array.isArray(metadata.tags) ? metadata.tags.map(String) : [];
  }, [metadata.tags]);

  const suggestedTags = useMemo(() => {
    const query = tagInput.trim().toLowerCase();
    return availableTags.filter((t) => {
      if (currentTags.includes(t)) return false;
      if (!query) return true;
      return t.toLowerCase().includes(query);
    });
  }, [availableTags, currentTags, tagInput]);

  const handleAddTag = (tagToAdd: string) => {
    const cleanTag = tagToAdd.trim().replace(/^,+|,+$/g, '');
    if (!cleanTag) return;
    if (!currentTags.includes(cleanTag)) {
      setMetadata({ ...metadata, tags: [...currentTags, cleanTag] });
    }
    setTagInput('');
    setIsTagDropdownOpen(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setMetadata({ ...metadata, tags: currentTags.filter((t) => t !== tagToRemove) });
  };

  return (
    <div className='note-panel-scroll flex flex-col h-full'>
      {/* Frontmatter Mode Switch */}
      <div className='flex items-center justify-between pb-2 mb-3 border-b border-line shrink-0'>
        <span className='font-semibold text-xs text-fg'>{t('editor.frontmatter')}</span>
        <div className='inline-flex rounded-md p-0.5 bg-sidebar text-[11px]'>
          <button type='button' onClick={() => setFrontmatterViewMode('form')} className={`px-2 py-0.5 rounded font-medium transition-colors ${frontmatterViewMode === 'form' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>{t('editor.formMode')}</button>
          <button
            type='button'
            onClick={() => {
              setYamlText(YAML.stringify(metadata));
              setYamlError('');
              setFrontmatterViewMode('yaml');
            }}
            className={`px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-colors ${frontmatterViewMode === 'yaml' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
          >
            <Code className='w-3 h-3' />
            {t('editor.yamlMode')}
          </button>
        </div>
      </div>
      {frontmatterViewMode === 'form'
        ? (
          <fieldset disabled={locked} className='note-metadata min-w-0 text-xs animate-fadeIn space-y-3'>
            <div>
              <label className='block text-muted font-semibold mb-1'>{t('editor.title')}</label>
              <input type='text' value={String(metadata.title || '')} onChange={(e) => setMetadata({ ...metadata, title: e.target.value })} placeholder={t('editor.titlePlaceholder')} className='ui-control w-full' />
            </div>
            <div>
              <label className='block text-muted font-semibold mb-1'>{t('editor.status')}</label>
              <Select aria-label={t('editor.status')} disabled={locked} value={String(metadata.status || '')} onValueChange={value => setMetadata(withNoteStatus(metadata, value))} options={Array.from(new Set(['', ...statuses, String(metadata.status || '')])).map(value => ({ value, label: value || t('editor.noStatus') }))} className={`w-full ${metadata.status ? '' : 'status-empty'}`} />
              <label className='flex items-center gap-2 min-h-11 cursor-pointer'>
                <input type='checkbox' aria-label={t('editor.hideNote')} checked={isNoteHidden(metadata)} onChange={event => setMetadata({ ...metadata, hiden: event.target.checked })} className='w-4 h-4 accent-primary' />
                {t('editor.hideNote')}
              </label>
            </div>
            {/* Tags with Autocomplete (Requirement 4) */}
            <div className='relative'>
              <label className='block text-muted font-semibold mb-1'>{t('editor.tags')}</label>
              <div className='flex flex-wrap items-center gap-1.5 p-1.5 bg-surface border border-line rounded-md min-h-[35px] relative'>
                {currentTags.map((tag) => (
                  <span key={tag} className='inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-fg/5 text-fg border border-line'>
                    <span>{tag}</span>
                    <button type='button' onClick={() => handleRemoveTag(tag)} className='text-muted hover:text-danger font-bold ml-0.5'>×</button>
                  </span>
                ))}
                <div className='flex-1 min-w-[100px] relative'>
                  <input
                    type='text'
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      setIsTagDropdownOpen(true);
                    }}
                    onFocus={() => setIsTagDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsTagDropdownOpen(false), 250)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        handleAddTag(tagInput);
                      } else if (e.key === 'Backspace' && !tagInput && currentTags.length > 0) {
                        handleRemoveTag(currentTags[currentTags.length - 1]);
                      }
                    }}
                    placeholder={currentTags.length === 0 ? t('editor.addTagPlaceholder') : t('editor.addPlaceholder')}
                    className='w-full text-xs bg-transparent focus:outline-none text-fg'
                  />
                  {/* Autocomplete Dropdown */}
                  {isTagDropdownOpen && suggestedTags.length > 0 && (
                    <div className='absolute top-full left-0 mt-1 w-52 bg-surface border border-line rounded-lg shadow-xl z-50 max-h-40 overflow-y-auto py-1'>
                      {suggestedTags.map((st) => (
                        <button
                          key={st}
                          type='button'
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleAddTag(st);
                          }}
                          className='w-full text-left px-3 py-1.5 text-xs hover:bg-fg/5 flex items-center justify-between text-fg'
                        >
                          <span className='font-semibold'>{st}</span>
                          <span className='text-[10px] text-muted'>{t('editor.add')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* Quick suggestion suggestions below */}
              {suggestedTags.length > 0 && !tagInput && (
                <div className='flex items-center gap-1.5 mt-1 text-[11px] text-muted flex-wrap'>
                  <span>{t('editor.suggestions')}</span>
                  {suggestedTags.slice(0, 5).map((st) => <button key={st} type='button' onClick={() => handleAddTag(st)} style={{ color: 'var(--color-primary)' }} className='hover:underline font-medium'>+{st}</button>)}
                </div>
              )}
            </div>
            {/* Custom / Notebook Metadata fields */}
            {customFields.length > 0 && (
              <div className='pt-2 border-t border-line space-y-3'>
                <span className='block text-muted font-semibold mb-1'>{t('editor.metadata') || 'Metadata'}</span>
                {customFields.map((field) => {
                  if (field.type === 'boolean') {
                    return (
                      <label key={field.key} className='flex items-center gap-2 min-h-8 cursor-pointer select-none'>
                        <input type='checkbox' aria-label={field.label} checked={Boolean(metadata[field.key])} onChange={(e) => setMetadata({ ...metadata, [field.key]: e.target.checked })} className='w-4 h-4 accent-primary rounded' />
                        <span className='text-fg font-medium'>{field.label}</span>
                      </label>
                    );
                  }

                  return (
                    <div key={field.key}>
                      <div className='flex items-center justify-between mb-1'>
                        <label className='text-muted font-semibold'>{field.label}</label>
                        {!field.isConfigured && (
                          <button
                            type='button'
                            onClick={() => {
                              const next = { ...metadata };
                              delete next[field.key];
                              setMetadata(next);
                            }}
                            className='text-[10px] text-muted hover:text-danger'
                            title='Remove field'
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={metadata[field.key] === undefined || metadata[field.key] === null ? '' : typeof metadata[field.key] === 'object' ? JSON.stringify(metadata[field.key]) : String(metadata[field.key])}
                        onChange={(e) => {
                          let val: unknown = e.target.value;
                          if (field.type === 'number') {
                            const num = Number(e.target.value);
                            val = isNaN(num) ? e.target.value : num;
                          }
                          setMetadata({ ...metadata, [field.key]: val });
                        }}
                        className='ui-control w-full text-xs'
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {/* Add Custom Field */}
            <div className='pt-2 border-t border-line'>
              <div className='flex gap-1.5 items-center'>
                <input
                  type='text'
                  placeholder='New field name...'
                  value={newFieldKey}
                  onChange={(e) => setNewFieldKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newFieldKey.trim()) {
                      e.preventDefault();
                      const key = newFieldKey.trim();
                      if (!metadata[key]) {
                        setMetadata({ ...metadata, [key]: '' });
                      }
                      setNewFieldKey('');
                    }
                  }}
                  className='ui-control flex-1 text-xs py-1'
                />
                <button
                  type='button'
                  onClick={() => {
                    const key = newFieldKey.trim();
                    if (key && !metadata[key]) {
                      setMetadata({ ...metadata, [key]: '' });
                    }
                    setNewFieldKey('');
                  }}
                  disabled={!newFieldKey.trim()}
                  className='px-2 py-1 text-xs bg-line hover:bg-fg/10 rounded disabled:opacity-50 text-fg'
                >
                  +
                </button>
              </div>
            </div>
          </fieldset>
        )
        : (
          <div className='flex-1 flex flex-col min-h-0 text-xs space-y-2'>
            {yamlError && <div className='p-2 rounded bg-danger-soft border border-danger/40 text-danger font-mono text-[11px] break-all'>{yamlError}</div>}
            <div className='flex-1 border border-line rounded-md overflow-hidden min-h-[340px]'>
              <FileSourceEditor
                path='metadata.yaml'
                content={yamlText}
                readOnly={locked}
                label='YAML Metadata'
                onChange={(newYaml) => {
                  setYamlText(newYaml);
                  try {
                    const parsed = YAML.parse(newYaml);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      setMetadata(parsed as Record<string, unknown>);
                      setYamlError('');
                    } else if (newYaml.trim() === '') {
                      setMetadata({});
                      setYamlError('');
                    } else {
                      setYamlError(`${t('editor.yamlError')}: Root must be a mapping`);
                    }
                  } catch (err) {
                    setYamlError(err instanceof Error ? err.message : t('editor.yamlError'));
                  }
                }}
              />
            </div>
            <p className='text-[11px] text-muted leading-tight'>{t('editor.yamlHint')}</p>
          </div>
        )}
    </div>
  );
}
