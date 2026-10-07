import { lazy, Suspense, useState } from 'react';
import YAML from 'yaml';
import { Code } from 'lucide-react';
import { useTranslation } from '../../lib/i18n/index.js';
import { LoadingStatus } from '../LoadingStatus.js';

// CodeMirror loads only when the YAML source view opens, not with the editor.
const FileSourceEditor = lazy(() => import('../FileSourceEditor.js').then(module => ({ default: module.FileSourceEditor })));

export type FrontmatterViewMode = 'form' | 'yaml';
type Metadata = Record<string, unknown>;

/** The panel's heading with its Form / YAML switch; opening YAML seeds the source from `yamlSource`, or else from the current metadata. */
export function FrontmatterHeader({ mode, metadata, yamlSource, onMode, onYaml }: { mode: FrontmatterViewMode; metadata: Metadata; yamlSource?: string; onMode: (mode: FrontmatterViewMode) => void; onYaml: (text: string) => void; }) {
  const { t } = useTranslation();
  return (
    <div className='flex items-center justify-between pb-2 mb-3 border-b border-line shrink-0'>
      <span className='font-semibold text-xs text-fg'>{t('editor.frontmatter')}</span>
      <div className='inline-flex rounded-md p-0.5 bg-sidebar text-[11px]'>
        <button type='button' onClick={() => onMode('form')} className={`px-2 py-0.5 rounded font-medium transition-colors ${mode === 'form' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}>{t('editor.formMode')}</button>
        <button
          type='button'
          onClick={() => {
            onYaml(yamlSource ?? YAML.stringify(metadata));
            onMode('yaml');
          }}
          className={`px-2 py-0.5 rounded font-medium flex items-center gap-1 transition-colors ${mode === 'yaml' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
        >
          <Code className='w-3 h-3' />
          {t('editor.yamlMode')}
        </button>
      </div>
    </div>
  );
}

/** The YAML view: every valid mapping replaces the metadata (with the text it came from), and anything else shows its error and changes nothing. */
export function FrontmatterYaml({ yamlText, setYamlText, yamlError, setYamlError, locked, setMetadata }: { yamlText: string; setYamlText: (value: string) => void; yamlError: string; setYamlError: (value: string) => void; locked: boolean; setMetadata: (metadata: Metadata, text: string) => void; }) {
  const { t } = useTranslation();
  return (
    <div className='flex-1 flex flex-col min-h-0 text-xs space-y-2'>
      {yamlError && <div className='p-2 rounded bg-danger-soft border border-danger/40 text-danger font-mono text-[11px] break-all'>{yamlError}</div>}
      <div className='flex-1 border border-line rounded-md overflow-hidden min-h-[340px]'>
        <Suspense fallback={<LoadingStatus className='p-3'>{t('editor.loadingEditor')}</LoadingStatus>}>
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
                  setMetadata(parsed as Metadata, newYaml);
                  setYamlError('');
                } else if (newYaml.trim() === '') {
                  setMetadata({}, newYaml);
                  setYamlError('');
                } else {
                  setYamlError(`${t('editor.yamlError')}: Root must be a mapping`);
                }
              } catch (err) {
                setYamlError(err instanceof Error ? err.message : t('editor.yamlError'));
              }
            }}
          />
        </Suspense>
      </div>
      <p className='text-[11px] text-muted leading-tight'>{t('editor.yamlHint')}</p>
    </div>
  );
}

export interface MetadataFieldSpec {
  key: string;
  type: 'string' | 'boolean' | 'number';
  label: string;
  /** Declared by configuration, so it stays even when empty and cannot be removed here. */
  isConfigured: boolean;
}

/** The fields other than the reserved ones: those configuration declares, then any other key the metadata holds. */
export function metadataFieldSpecs(metadata: Metadata, reserved: ReadonlySet<string>, configured: { key: string; type?: MetadataFieldSpec['type']; label?: string; }[] = []): MetadataFieldSpec[] {
  const inferred = (key: string): MetadataFieldSpec['type'] => typeof metadata[key] === 'boolean' ? 'boolean' : typeof metadata[key] === 'number' ? 'number' : 'string';
  const fields: MetadataFieldSpec[] = [];
  const seen = new Set<string>();
  for (const field of configured) {
    if (reserved.has(field.key)) continue;
    fields.push({ key: field.key, type: field.type || inferred(field.key), label: field.label || field.key, isConfigured: true });
    seen.add(field.key);
  }
  for (const key of Object.keys(metadata)) {
    if (reserved.has(key) || seen.has(key)) continue;
    fields.push({ key, type: inferred(key), label: key, isConfigured: false });
    seen.add(key);
  }
  return fields;
}

/** The extra fields, under a "Metadata" heading: checkboxes for booleans, inputs for the rest, with remove for unconfigured keys. */
export function MetadataFieldList({ fields, metadata, setMetadata }: { fields: MetadataFieldSpec[]; metadata: Metadata; setMetadata: (metadata: Metadata) => void; }) {
  const { t } = useTranslation();
  if (!fields.length) return null;
  return (
    <div className='pt-2 border-t border-line space-y-3'>
      <span className='block text-muted font-semibold mb-1'>{t('editor.metadata') || 'Metadata'}</span>
      {fields.map((field) => {
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
              aria-label={field.label}
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
  );
}

/** A name box and "+" that adds an empty field; `newFieldKey` may be lifted so a parent keeps it across remounts. */
export function AddMetadataField({ metadata, setMetadata, newFieldKey: liftedKey, setNewFieldKey: setLiftedKey }: { metadata: Metadata; setMetadata: (metadata: Metadata) => void; newFieldKey?: string; setNewFieldKey?: (value: string) => void; }) {
  const [localKey, setLocalKey] = useState('');
  const newFieldKey = liftedKey ?? localKey;
  const setNewFieldKey = setLiftedKey ?? setLocalKey;
  const add = () => {
    const key = newFieldKey.trim();
    if (key && !metadata[key]) setMetadata({ ...metadata, [key]: '' });
    setNewFieldKey('');
  };
  return (
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
              add();
            }
          }}
          className='ui-control flex-1 text-xs py-1'
        />
        <button type='button' onClick={add} disabled={!newFieldKey.trim()} className='px-2 py-1 text-xs bg-line hover:bg-fg/10 rounded disabled:opacity-50 text-fg'>+</button>
      </div>
    </div>
  );
}
