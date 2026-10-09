import { useState } from 'react';
import { AlertCircle, AlertTriangle, Check, Save } from 'lucide-react';
import YAML from 'yaml';
import type { RepositoryId } from '@mygitnotes/core/repository';
import { updateWorkspaceConfig } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { Button } from './Button.js';
import { Select } from './Select.js';
import { WorkspaceManifestEditor } from './WorkspaceManifestEditor.js';

export interface ManifestSettingsProps {
  repositories: WorkspaceRepository[];
  /** The home repository, whose manifest declares every notebook of the workspace. */
  homeRepository: RepositoryId;
  /** The repository the editor opens on: the current notebook's, or the default repository's. */
  initialRepository: RepositoryId;
  /** Keeps the revision a save answered, since a refetch may still answer from the snapshot before it. */
  onManifestRevision: (repository: RepositoryId, revision: string) => void;
  onRefreshWorkspace: () => Promise<void>;
}

/** The text the editor starts from: the stored manifest by local id, or the file as written when it cannot be read. */
const manifestText = (repository: WorkspaceRepository | undefined) => repository?.manifestError ? repository.manifestError.text : repository?.config ? YAML.stringify(repository.config) : '';

/** Settings → Manifest: each repository's own `.mygitnotes.yaml`, edited and committed in that repository. */
export function ManifestSettings({ repositories, homeRepository, initialRepository, onManifestRevision, onRefreshWorkspace }: ManifestSettingsProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(initialRepository);
  const repository = repositories.find(candidate => candidate.id === selected) ?? repositories.find(candidate => candidate.id === homeRepository);
  const [yamlContent, setYamlContent] = useState(() => manifestText(repository));
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string; } | null>(null);

  // The editor restarts from the repository's manifest whenever another repository is chosen or its manifest changes,
  // such as after its own save; the outcome of a save stays shown until another repository is chosen.
  const source = repository ? [repository.id, repository.configRevision, manifestText(repository)].join('\n') : '';
  const [loaded, setLoaded] = useState({ source, repository: repository?.id });
  if (loaded.source !== source) {
    setLoaded({ source, repository: repository?.id });
    setYamlContent(manifestText(repository));
    if (loaded.repository !== repository?.id) setStatusMessage(null);
  }

  const onCore = repository?.branch === 'core';
  const canWrite = Boolean(repository?.write && !repository.unavailable && !onCore);
  const handleSaveConfig = async () => {
    if (!repository) return;
    setIsSaving(true);
    setStatusMessage(null);
    try {
      const saved = await updateWorkspaceConfig(repository.id, yamlContent, repository.configRevision);
      if (saved.configRevision) onManifestRevision(repository.id, saved.configRevision);
      await onRefreshWorkspace();
      setStatusMessage({ type: 'success', text: t('settings.saved') });
    } catch (err: unknown) {
      setStatusMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
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
          <Select aria-label={t('settings.manifestRepository')} value={repository?.id ?? ''} onValueChange={setSelected} options={repositories.map(candidate => ({ value: candidate.id, label: `${candidate.title} · ${candidate.repository ?? candidate.id}` }))} />
        </label>
      )}
      <p className='text-xs text-muted'>{t('settings.manifestHint')}{onCore && <span className='block mt-1 text-warning text-[11px]'>{t('settings.coreBranchManifestWarning')}</span>}</p>
      {repository?.unavailable && <p role='alert' className='text-xs text-danger'>{repository.unavailable.message}</p>}
      {repository?.manifestError && (
        <p role='alert' className='p-3 rounded-lg text-xs flex items-start gap-2 bg-danger-soft text-danger border border-danger/40'>
          <AlertCircle className='w-4 h-4 shrink-0' />
          <span>{t('settings.manifestInvalid', { error: repository.manifestError.message })}</span>
        </p>
      )}
      {repository && repository.id !== homeRepository && !repository.unavailable && <p className='text-xs text-muted'>{t('settings.manifestNotebooksFromHome')}</p>}
      {repository?.manifest === 'derived' && repository.id !== homeRepository && !repository.unavailable && <p className='text-xs text-muted'>{t('settings.manifestDerivedRepository')}</p>}
      {repository?.unservedDefault && (
        <p role='status' className='p-3 rounded-lg text-xs flex items-start gap-2 bg-surface text-warning border border-line'>
          <AlertTriangle className='w-4 h-4 shrink-0' />
          <span>{t('settings.manifestUnservedDefault', { notebook: repository.unservedDefault })}</span>
        </p>
      )}
      {repository && !repository.unavailable && <WorkspaceManifestEditor key={repository.id} yamlContent={yamlContent} onChange={setYamlContent} readOnly={!canWrite} />}
      {statusMessage && (
        <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${statusMessage.type === 'success' ? 'bg-success-soft text-success border border-success/40' : 'bg-danger-soft text-danger border border-danger/40'}`}>
          {statusMessage.type === 'success' ? <Check className='w-4 h-4 text-success' /> : <AlertCircle className='w-4 h-4 text-danger' />}
          <span>{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
}
