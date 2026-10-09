import { useState } from 'react';
import { ArrowLeft, ExternalLink, FolderPlus } from 'lucide-react';
import { Button } from './Button.js';
import { LoadingStatus } from './LoadingStatus.js';
import { RepositoryChooser } from './RepositoryChooser.js';
import { useTranslation } from '../lib/i18n/index.js';
import { addRepositoryMember, fetchMemberFolders, type MemberFolders, type MembersAnswer, MembershipApiError, type MembersLimit } from '../lib/members-api.js';

/** Whether a limit leaves no room to show another repository. */
export const limitReached = (limit: MembersLimit | undefined) => Boolean(limit && limit.visible >= limit.max);

/**
 * The quiet line under a limited list: how many repositories are visible of how many the plan allows and, once the
 * limit is reached, to hide one first or upgrade. It reads as a note, not an error (ui-design: plan limits).
 */
export function MembersLimitLine({ limit, refusal }: { limit: MembersLimit; refusal?: string; }) {
  const { t } = useTranslation();
  const full = limitReached(limit) || Boolean(refusal);
  return (
    <p className='text-xs text-muted flex flex-wrap items-center gap-x-2 gap-y-1' data-members-limit>
      <span>{t(limit.plan ? 'repositories.limitOnPlan' : 'repositories.limit', { visible: limit.visible, max: limit.max, plan: limit.plan ?? '' })}</span>
      {full && <span>{t('repositories.limitReached')}</span>}
      {full && limit.upgradeUrl && (
        <a href={limit.upgradeUrl} className='inline-flex items-center gap-1 text-primary'>
          {t('repositories.upgrade')}
          <ExternalLink size={12} aria-hidden='true' />
        </a>
      )}
    </p>
  );
}

export interface RepositoryAddFlowProps {
  /** The member list this flow adds to: its revision, its members (marked in the picker) and its limit. */
  members: MembersAnswer;
  /** Runs after a repository was added. */
  onAdded: () => Promise<void> | void;
  /** Reloads the member list after it changed elsewhere, so the next try uses its new revision. */
  onStale: () => Promise<void>;
  /** Shows a hidden member the picker lists; absent where showing is not offered. */
  onShow?: (id: string) => Promise<void>;
}

/**
 * Adds a platform repository to a list the person keeps: pick it (and a branch) from the repositories they can push
 * to, then, when that branch keeps no manifest, pick the folder its one notebook uses from its top-level folders or
 * type a new one. Nothing is written to the repository. A reached limit blocks adding with the quiet limit line.
 */
export function RepositoryAddFlow({ members, onAdded, onStale, onShow }: RepositoryAddFlowProps) {
  const { t } = useTranslation();
  const [folderStep, setFolderStep] = useState<{ repository: string; branch?: string; found?: MemberFolders; }>();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refusal, setRefusal] = useState('');
  const full = limitReached(members.limit);
  const blockedReason = full ? t('repositories.limitReached') : undefined;

  /** Adds the repository, returning to the caller's errors only what the flow does not handle itself. */
  const add = async (repository: string, branch: string | undefined, picked?: string) => {
    try {
      await addRepositoryMember(repository, branch, members.revision ?? '', picked);
      setFolderStep(undefined);
      setRefusal('');
      await onAdded();
    } catch (cause) {
      if (!(cause instanceof MembershipApiError)) throw cause;
      if (cause.code === 'folder-required') {
        setFolder('');
        setFolderStep({ repository, branch });
        fetchMemberFolders(repository, branch).then(found => setFolderStep(step => step && step.repository === repository ? { ...step, found } : step), (reason: Error) => setError(reason.message));
        return;
      }
      if (cause.code === 'visible-limit') {
        setRefusal(cause.message);
        return;
      }
      if (cause.code === 'stale') {
        await onStale();
        throw new Error(t('repositories.stale'));
      }
      throw cause;
    }
  };
  const addInFolder = async () => {
    if (!folderStep) return;
    setBusy(true);
    setError('');
    try {
      await add(folderStep.repository, folderStep.branch, folder.trim());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const notice = members.limit
    ? (
      <div className='mb-3'>
        <MembersLimitLine limit={members.limit} refusal={refusal} />
      </div>
    )
    : null;

  if (folderStep) {
    const { found } = folderStep;
    return (
      <div className='flex flex-col gap-3' data-folder-step>
        <p className='text-sm'>{t('repositories.pickFolderHint', { repository: folderStep.repository, branch: found?.branch ?? folderStep.branch ?? '' })}</p>
        {!found && !error && <LoadingStatus>{t('repositories.loadingFolders')}</LoadingStatus>}
        {found && found.folders.length > 0 && (
          <ul className='flex flex-col gap-1 max-h-60 overflow-y-auto' aria-label={t('repositories.folders')}>
            {found.folders.map(name => (
              <li key={name}>
                <button
                  type='button'
                  aria-pressed={folder === name}
                  onClick={() => setFolder(name)}
                  className={`w-full px-3 py-2 rounded-lg border text-left font-mono text-sm transition ${folder === name ? 'border-primary bg-primary-soft/40' : 'border-line hover:bg-fg/5'}`}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className='flex flex-col gap-1 text-xs'>
          <span className='font-semibold text-fg'>{t('repositories.addFolder')}</span>
          <input className='ui-control font-mono' value={folder} onChange={event => setFolder(event.target.value)} placeholder='notes' aria-label={t('repositories.addFolder')} disabled={busy} />
          <span className='text-muted'>{t('repositories.newFolderHint')}</span>
        </label>
        {notice}
        {error && <p role='alert' className='text-sm text-danger'>{error}</p>}
        <div className='flex flex-wrap items-center gap-2'>
          <Button variant='primary' disabled={busy || !folder.trim() || full} onClick={() => void addInFolder()}>
            <FolderPlus className='w-3.5 h-3.5' />
            <span>{busy ? t('repositories.adding') : t('repositories.add')}</span>
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setFolderStep(undefined);
              setError('');
            }}
          >
            <ArrowLeft className='w-3.5 h-3.5' />
            <span>{t('repositories.backToList')}</span>
          </Button>
        </div>
      </div>
    );
  }
  return <RepositoryChooser actionLabel={t('repositories.add')} busyLabel={t('repositories.adding')} onChoose={(repository, branch) => add(repository.fullName, branch)} members={members.members} {...(onShow ? { onShow } : {})} {...(blockedReason ? { showBlocked: blockedReason } : {})} notice={notice} blocked={full} />;
}
