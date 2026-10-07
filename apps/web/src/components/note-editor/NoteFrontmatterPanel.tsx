import { useMemo } from 'react';
import { isNoteHidden, withNoteStatus } from '@mygitnotes/core/note-status';
import { Select } from '../Select.js';
import { NotebookMetadataField } from '../../lib/types.js';
import { useTranslation } from '../../lib/i18n/index.js';
import { AddMetadataField, FrontmatterHeader, FrontmatterYaml, MetadataFieldList, metadataFieldSpecs } from './FrontmatterParts.js';

const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set(['title', 'status', 'hiden', 'tags', 'created', 'updated']);

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

  const customFields = useMemo(() => metadataFieldSpecs(metadata, RESERVED_METADATA_KEYS, metadataFields), [metadataFields, metadata]);

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
    <div className='note-frontmatter-panel note-panel-scroll flex flex-col h-full'>
      <FrontmatterHeader
        mode={frontmatterViewMode}
        metadata={metadata}
        onMode={setFrontmatterViewMode}
        onYaml={text => {
          setYamlText(text);
          setYamlError('');
        }}
      />
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
            {/* Tags with Autocomplete */}
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
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
            <MetadataFieldList fields={customFields} metadata={metadata} setMetadata={setMetadata} />
            <AddMetadataField metadata={metadata} setMetadata={setMetadata} newFieldKey={newFieldKey} setNewFieldKey={setNewFieldKey} />
          </fieldset>
        )
        : <FrontmatterYaml yamlText={yamlText} setYamlText={setYamlText} yamlError={yamlError} setYamlError={setYamlError} locked={locked} setMetadata={setMetadata} />}
    </div>
  );
}
