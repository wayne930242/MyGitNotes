import YAML from 'yaml';
import { useState } from 'react';
import { patchFrontmatterField } from '@mygitnotes/core/frontmatter-patch';
import { useTranslation } from '../lib/i18n/index.js';
import { AddMetadataField, FrontmatterHeader, type FrontmatterViewMode, FrontmatterYaml, MetadataFieldList, metadataFieldSpecs } from './note-editor/FrontmatterParts.js';

type Metadata = Record<string, unknown>;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
/** The form shows these itself; every other key is an ordinary metadata field. */
const RESERVED: ReadonlySet<string> = new Set(['name', 'description']);

/** A SKILL.md's frontmatter as an object, its source text, and why it cannot be read when it cannot. */
export function readSkillFrontmatter(content: string): { metadata: Metadata; source: string; error?: string; } {
  const match = content.match(FRONTMATTER);
  if (!match) return { metadata: {}, source: '' };
  const document = YAML.parseDocument(match[1]);
  if (document.errors.length) return { metadata: {}, source: match[1], error: document.errors[0].message };
  const value: unknown = document.toJS();
  if (value === null || value === undefined) return { metadata: {}, source: match[1] };
  if (typeof value !== 'object' || Array.isArray(value)) return { metadata: {}, source: match[1], error: 'The frontmatter must be a mapping of fields.' };
  return { metadata: value as Metadata, source: match[1] };
}

/** Replaces the frontmatter block with `source`, keeping the body as it is; empty source removes the block. */
export function withSkillFrontmatterSource(content: string, source: string): string {
  const match = content.match(FRONTMATTER);
  const body = match ? content.slice(match[0].length) : content;
  return source.trim() ? `---\n${source.trimEnd()}\n---\n${match ? body : `\n${body}`}` : body;
}

/**
 * Writes `next` into the frontmatter one changed key at a time, so every key it leaves alone keeps its exact bytes
 * (quoting, flow style, comments, line endings); a file without frontmatter gets a block.
 */
export function withSkillMetadata(content: string, next: Metadata): string {
  const { metadata, error } = readSkillFrontmatter(content);
  if (error) return content;
  if (!FRONTMATTER.test(content)) return Object.keys(next).length ? `---\n${YAML.stringify(next).trimEnd()}\n---\n\n${content}` : content;
  let patched = content;
  for (const key of Object.keys(metadata)) if (!(key in next)) patched = patchFrontmatterField(patched, key, undefined);
  for (const [key, value] of Object.entries(next)) if (JSON.stringify(metadata[key]) !== JSON.stringify(value)) patched = patchFrontmatterField(patched, key, value);
  return patched;
}

interface AgentSkillMetadataPanelProps {
  content: string;
  disabled: boolean;
  /** The SKILL.md path; the skill's name is its folder name. */
  path: string;
  renaming: boolean;
  onChange: (content: string) => void;
  onRename: (slug: string) => Promise<void>;
}

/**
 * A skill's metadata, edited like a note's frontmatter: a Form / YAML switch, the name (its folder, so changing it
 * renames the skill) and description first, then any other field, and "add field".
 */
export function AgentSkillMetadataPanel({ content, disabled, path, renaming, onChange, onRename }: AgentSkillMetadataPanelProps) {
  const { t } = useTranslation();
  const { metadata, source, error } = readSkillFrontmatter(content);
  const slug = path.split('/').at(-2) || '';
  const [slugDraft, setSlugDraft] = useState(slug);
  const [mode, setMode] = useState<FrontmatterViewMode>('form');
  const [yamlText, setYamlText] = useState('');
  const [yamlError, setYamlError] = useState('');
  const locked = disabled || renaming;
  const setMetadata = (next: Metadata) => onChange(withSkillMetadata(content, next));
  const rename = () => {
    if (slugDraft.trim() && slugDraft !== slug) void onRename(slugDraft.trim());
  };

  return (
    <div className='note-frontmatter-panel note-panel-scroll flex flex-col h-full'>
      <FrontmatterHeader
        mode={mode}
        metadata={metadata}
        yamlSource={source}
        onMode={setMode}
        onYaml={text => {
          setYamlText(text);
          setYamlError('');
        }}
      />
      {mode === 'form'
        ? (
          <fieldset disabled={locked} aria-label={t('agent.skillMetadata')} className='note-metadata min-w-0 text-xs animate-fadeIn space-y-3'>
            {error && <p role='alert' className='p-2 rounded bg-danger-soft border border-danger/40 text-danger text-[11px]'>{t('agent.skillMetadataError')}</p>}
            <div>
              <label className='block text-muted font-semibold mb-1' htmlFor='agent-skill-name'>{t('agent.skillName')}</label>
              <input
                id='agent-skill-name'
                type='text'
                className='ui-control w-full font-mono'
                value={slugDraft}
                onChange={event => setSlugDraft(event.target.value)}
                onBlur={rename}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    rename();
                  }
                  if (event.key === 'Escape') setSlugDraft(slug);
                }}
              />
              <p className='mt-1 text-[11px] text-muted leading-tight'>{renaming ? t('agent.renamingSkill') : t('agent.skillNameHint')}</p>
            </div>
            <div>
              <label className='block text-muted font-semibold mb-1' htmlFor='agent-skill-description'>{t('agent.skillDescription')}</label>
              <textarea id='agent-skill-description' className='ui-control w-full min-h-24 resize-y' disabled={Boolean(error) || locked} value={typeof metadata.description === 'string' ? metadata.description : ''} onChange={event => setMetadata({ ...metadata, description: event.target.value })} />
              <p className='mt-1 text-[11px] text-muted leading-tight'>{t('agent.skillDescriptionHint')}</p>
            </div>
            {!error && <MetadataFieldList fields={metadataFieldSpecs(metadata, RESERVED)} metadata={metadata} setMetadata={setMetadata} />}
            {!error && <AddMetadataField metadata={metadata} setMetadata={setMetadata} />}
          </fieldset>
        )
        : <FrontmatterYaml yamlText={yamlText} setYamlText={setYamlText} yamlError={yamlError} setYamlError={setYamlError} locked={locked} setMetadata={(_metadata, text) => onChange(withSkillFrontmatterSource(content, text))} />}
    </div>
  );
}
