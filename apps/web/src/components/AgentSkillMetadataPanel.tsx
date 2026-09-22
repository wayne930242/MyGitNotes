import YAML from 'yaml';
import { useState } from 'react';
import { useTranslation } from '../lib/i18n/index.js';

interface AgentSkillMetadataPanelProps {
  content: string;
  disabled: boolean;
  path: string;
  renaming: boolean;
  onChange: (content: string) => void;
  onRename: (slug: string) => Promise<void>;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function readSkillMetadata(content: string): { title: string; description: string; } {
  const match = content.match(FRONTMATTER);
  if (!match) return { title: '', description: '' };
  try {
    const value = YAML.parse(match[1]);
    return { title: typeof value?.name === 'string' ? value.name : typeof value?.title === 'string' ? value.title : '', description: typeof value?.description === 'string' ? value.description : '' };
  } catch {
    return { title: '', description: '' };
  }
}

export function updateSkillMetadata(content: string, key: 'name' | 'description', value: string): string {
  const match = content.match(FRONTMATTER);
  if (!match) return `---\n${YAML.stringify({ [key]: value }).trim()}\n---\n\n${content}`;
  const document = YAML.parseDocument(match[1]);
  if (document.errors.length || !YAML.isMap(document.contents)) return content;
  document.set(key, value);
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n${content.slice(match[0].length)}`;
}

export function AgentSkillMetadataPanel({ content, disabled, path, renaming, onChange, onRename }: AgentSkillMetadataPanelProps) {
  const { t } = useTranslation();
  const metadata = readSkillMetadata(content);
  const slug = path.split('/').at(-2) || '';
  const [slugDraft, setSlugDraft] = useState(slug);

  return (
    <fieldset disabled={disabled || renaming} className='border-b border-line bg-sidebar/40 px-4 py-3 md:px-6'>
      <legend className='sr-only'>{t('agent.skillMetadata')}</legend>
      <div className='grid gap-3 md:grid-cols-[minmax(10rem,0.8fr)_minmax(16rem,1.5fr)_minmax(12rem,0.8fr)]'>
        <label className='min-w-0 text-xs font-semibold text-muted'>
          <span className='mb-1 block'>{t('agent.skillTitle')}</span>
          <input aria-label={t('agent.skillTitle')} className='ui-control w-full font-medium text-fg' value={metadata.title} onChange={event => onChange(updateSkillMetadata(content, 'name', event.target.value))} />
        </label>
        <label className='min-w-0 text-xs font-semibold text-muted'>
          <span className='mb-1 block'>{t('agent.skillDescription')}</span>
          <textarea aria-label={t('agent.skillDescription')} className='ui-control min-h-16 w-full resize-y text-fg' value={metadata.description} onChange={event => onChange(updateSkillMetadata(content, 'description', event.target.value))} />
        </label>
        <label className='min-w-0 text-xs font-semibold text-muted'>
          <span className='mb-1 block'>{t('agent.skillSlug')}</span>
          <div className='flex gap-2'>
            <input aria-label={t('agent.skillSlug')} className='ui-control min-w-0 flex-1 font-mono text-fg' value={slugDraft} onChange={event => setSlugDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && slugDraft !== slug) {
                event.preventDefault();
                void onRename(slugDraft);
              }
            }} />
            <button type='button' className='editor-action rounded-md border border-line bg-surface px-3 text-xs font-semibold text-fg hover:bg-fg/5 disabled:opacity-40' disabled={slugDraft === slug || !slugDraft.trim()} onClick={() => void onRename(slugDraft)}>{renaming ? t('agent.renamingSkill') : t('agent.renameSkill')}</button>
          </div>
          <span className='mt-1 block text-[10px] font-normal text-muted'>{t('agent.skillSlugHint')}</span>
        </label>
      </div>
    </fieldset>
  );
}
