import { useState } from 'react';
import { AlertCircle, Check, Save } from 'lucide-react';
import YAML from 'yaml';
import type { RepositoryId } from '@mygitnotes/core/repository';
import { ApiError, updateWorkspaceConfig } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { Button } from './Button.js';
import { Select } from './Select.js';
import { WorkspaceManifestEditor } from './WorkspaceManifestEditor.js';

export interface ManifestSettingsProps {
  repositories: WorkspaceRepository[];
  /** The default repository, whose manifest the editor shows when the chosen repository is gone. */
  defaultRepository: RepositoryId;
  /** The repository the editor shows until the person chooses one: the current notebook's, or the default repository's. */
  initialRepository: RepositoryId;
  /** Keeps the revision a save answered, since a refetch may still answer from the snapshot before it. */
  onManifestRevision: (repository: RepositoryId, revision: string) => void;
  onRefreshWorkspace: () => Promise<void>;
}

/** The text the editor starts from: the stored manifest by local id, or the file as written when it cannot be read. */
const manifestText = (repository: WorkspaceRepository | undefined) => repository?.manifestError ? repository.manifestError.text : repository?.config ? YAML.stringify(repository.config) : '';

/** Settings → Manifest: each repository's own `.mygitnotes.yaml`, edited and committed in that repository. */
export function ManifestSettings({ repositories, defaultRepository, initialRepository, onManifestRevision, onRefreshWorkspace }: ManifestSettingsProps) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<RepositoryId | null>(null);
  const selected = chosen ?? initialRepository;
  const repository = repositories.find(candidate => candidate.id === selected) ?? repositories.find(candidate => candidate.id === defaultRepository);
  const [yamlContent, setYamlContent] = useState(() => manifestText(repository));
  /** The person changed the text since it was last loaded or saved. */
  const [edited, setEdited] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string; } | null>(null);

  // The editor restarts from the manifest when another repository is chosen, and follows its manifest text when that
  // changes while the person has not edited it. A revision that moves alone (a note committed in the repository) changes
  // nothing here; a save always sends the latest revision. The outcome of a save stays shown until another repository is chosen.
  const text = manifestText(repository);
  const [loaded, setLoaded] = useState({ repository: repository?.id, text });
  if (loaded.repository !== repository?.id) {
    setLoaded({ repository: repository?.id, text });
    setYamlContent(text);
    setEdited(false);
    setStatusMessage(null);
  } else if (loaded.text !== text) {
    setLoaded({ repository: repository?.id, text });
    if (!edited) setYamlContent(text);
  }
  const editYaml = (value: string) => {
    setYamlContent(value);
    setEdited(true);
  };

  const onCore = repository?.branch === 'core';
  // A repository whose manifest does not load is unavailable only until that manifest is fixed here.
  const editable = Boolean(repository && (!repository.unavailable || repository.unavailable.reason === 'invalid-manifest'));
  const canWrite = Boolean(repository?.write && editable && !onCore);
  const handleSaveConfig = async () => {
    if (!repository) return;
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const saved = await updateWorkspaceConfig(repository.id, yamlContent, repository.configRevision);
      // Saved, the editor follows the manifest the refresh brings back.
      setEdited(false);
      if (saved.configRevision) onManifestRevision(repository.id, saved.configRevision);
      await onRefreshWorkspace();
      setStatusMessage({ type: 'success', text: t('settings.saved') });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        // The manifest moved since it was read: refresh to its current revision and keep the person's text to re-apply and save.
        setStatusMessage({ type: 'error', text: t('settings.manifestConflict') });
        await onRefreshWorkspace().catch(() => undefined);
      } else setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div id='settings-manifest' className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <label className='text-xs font-semibold text-fg uppercase tracking-wider'>{t('settings.manifest')}</label>
          {onCore && <span className='text-[11px] px-2 py-0.5 rounded-full bg-sidebar text-muted font-mono'>{t('settings.coreBranchReadOnly')}</span>}
        </div>
        <Button variant='primary' type='button' onClick={handleSaveConfig} disabled={!canWrite || isSaving} title={onCore ? t('settings.coreBranchConfigReadOnlyTitle') : t('settings.saveCommit')}>
          <Save className='w-3.5 h-3.5' />
          <span>{isSaving ? t('settings.saving') : t('settings.saveCommit')}</span>
        </Button>
      </div>
      {repositories.length > 1 && (
        <label className='flex flex-col gap-1 text-xs'>
          <span className='font-semibold text-fg'>{t('settings.manifestRepository')}</span>
          <Select aria-label={t('settings.manifestRepository')} value={repository?.id ?? ''} onValueChange={setChosen} options={repositories.map(candidate => ({ value: candidate.id, label: `${candidate.title} · ${candidate.repository ?? candidate.id}` }))} />
        </label>
      )}
      <p className='text-xs text-muted'>{t('settings.manifestHint')}{onCore && <span className='block mt-1 text-warning text-[11px]'>{t('settings.coreBranchManifestWarning')}</span>}</p>
      {repository?.unavailable && !repository.manifestError && <p role='alert' className='text-xs text-danger'>{repository.unavailable.message}</p>}
      {repository?.manifestError && (
        <p role='alert' className='p-3 rounded-lg text-xs flex items-start gap-2 bg-danger-soft text-danger border border-danger/40'>
          <AlertCircle className='w-4 h-4 shrink-0' />
          <span>{t('settings.manifestInvalid', { error: repository.manifestError.message })}</span>
        </p>
      )}
      {repository?.manifest === 'derived' && !repository.unavailable && <p className='text-xs text-muted'>{t('settings.manifestDerivedRepository')}</p>}
      {repository && editable && <WorkspaceManifestEditor key={repository.id} yamlContent={yamlContent} onChange={editYaml} readOnly={!canWrite} />}
      {statusMessage && (
        <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${statusMessage.type === 'success' ? 'bg-success-soft text-success border border-success/40' : 'bg-danger-soft text-danger border border-danger/40'}`}>
          {statusMessage.type === 'success' ? <Check className='w-4 h-4 text-success' /> : <AlertCircle className='w-4 h-4 text-danger' />}
          <span>{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
}
