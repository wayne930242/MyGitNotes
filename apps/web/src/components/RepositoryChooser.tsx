import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Eye, Lock, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from './Button.js';
import { LoadingStatus } from './LoadingStatus.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { AvailableRepositories, AvailableRepository } from '../lib/available-repositories.js';
import { useRepositoryList } from '../lib/web-features.js';

/** A workspace member the chooser marks in the list, by its platform repository's name. */
export interface ChooserMember {
  id: string;
  repository?: string;
  hidden: boolean;
}

export interface RepositoryChooserProps {
  /** The button that acts on the selected repository, and its label while it does. */
  actionLabel: string;
  busyLabel: string;
  /** Acts on the selected repository and branch (undefined for its default branch); a thrown error is shown under the list. */
  onChoose: (repository: AvailableRepository, branch: string | undefined) => Promise<void>;
  /** Members already in the workspace: shown as added, a hidden one with Show instead (Pro decision P8). */
  members?: readonly ChooserMember[];
  /** Shows a hidden member; absent where the list has no members. */
  onShow?: (id: string) => Promise<void>;
  /** Why showing is not possible now, such as a reached limit; Show is then disabled with it. */
  showBlocked?: string;
  /** A quiet note above the actions, such as a reached limit. */
  notice?: ReactNode;
  /** Disables the action, with `notice` saying why. */
  blocked?: boolean;
  /** More controls at the end of the action row, such as signing out. */
  footer?: ReactNode;
}

/**
 * Searches the repositories the signed-in person may open or add, walks them through creating one from the starter
 * template on GitHub, and acts on the one they select with an optional branch. Where the list comes from is the
 * edition's (`WebFeature.repositoryList`), the deployment's own list otherwise.
 */
export function RepositoryChooser({ actionLabel, busyLabel, onChoose, members = [], onShow, showBlocked, notice, blocked = false, footer }: RepositoryChooserProps) {
  const { t } = useTranslation();
  const list = useRepositoryList();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<AvailableRepositories | null>(null);
  const [selected, setSelected] = useState<AvailableRepository | null>(null);
  const [branch, setBranch] = useState('');
  // Listing and acting fail separately, so a list that loads again does not hide why acting failed.
  const [listError, setListError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  // While a person creates a repository on GitHub: the unfiltered list from before, so the one that appears can be selected.
  const creation = useRef<{ before: Set<string> | null; } | null>(null);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!creating) return;
    // Returning from the GitHub tab lists the repositories again.
    const refresh = () => setReload(count => count + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [creating]);
  useEffect(() => {
    const controller = new AbortController();
    // Typing settles before the list is asked for, so each keystroke does not list the account again.
    const timer = setTimeout(() => {
      list(query, controller.signal).then(body => {
        setAnswer(body);
        setListError('');
        const pending = creation.current;
        if (pending && !query) {
          const names = body.repositories.map(repository => repository.fullName);
          const created = pending.before && body.repositories.find(repository => !pending.before!.has(repository.fullName));
          if (!pending.before) pending.before = new Set(names);
          else if (created) {
            setSelected(created);
            setBranch('');
            creation.current = null;
            setCreating(false);
          }
        }
      }).catch((reason: Error) => {
        if (reason.name !== 'AbortError') setListError(reason.message || t('setup.listFailed'));
      });
    }, query ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, reload, list, t]);
  /** The member a listed repository already is: as the list source marks it, else by name. */
  const memberOf = (repository: AvailableRepository) => repository.member ?? members.find(member => member.repository?.toLowerCase() === repository.fullName.toLowerCase());
  const startCreating = () => {
    if (!answer?.newRepositoryUrl) return;
    window.open(answer.newRepositoryUrl, '_blank', 'noopener');
    // A filtered list is not a full picture of what existed, so the next unfiltered one becomes the baseline.
    creation.current = { before: query ? null : new Set(answer.repositories.map(repository => repository.fullName)) };
    setQuery('');
    setCreating(true);
  };
  const stopCreating = () => {
    creation.current = null;
    setCreating(false);
  };
  const act = async () => {
    if (!selected) return;
    setBusy(true);
    setActionError('');
    try {
      await onChoose(selected, branch.trim() || undefined);
    } catch (reason) {
      setActionError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const show = async (id: string) => {
    if (!onShow) return;
    setBusy(true);
    setActionError('');
    try {
      await onShow(id);
    } catch (reason) {
      setActionError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const error = actionError || listError;
  return (
    <>
      <label className='flex items-center gap-2 px-3 py-2 rounded-lg border border-line mb-3'>
        <Search size={16} aria-hidden='true' className='text-muted' />
        <input aria-label={t('setup.searchRepositories')} placeholder={t('setup.searchRepositories')} value={query} onChange={event => setQuery(event.target.value)} className='flex-1 min-w-0 bg-transparent focus:outline-none' />
      </label>
      {!answer && !listError && <LoadingStatus className='mb-3'>{t('setup.loadingRepositories')}</LoadingStatus>}
      {answer && (
        <ul className='flex flex-col gap-1 max-h-80 overflow-y-auto mb-3' aria-label={t('setup.repositories')}>
          {answer.repositories.map(repository => {
            const member = memberOf(repository);
            if (member) {
              return (
                <li key={repository.fullName} className='flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-line text-left' data-member-of={repository.fullName}>
                  <span className='font-mono text-sm truncate text-muted'>{repository.fullName}</span>
                  {member.hidden
                    ? (
                      <span className='flex items-center gap-2 shrink-0 text-xs text-muted'>
                        {t('repositories.hidden')}
                        {onShow && (
                          <Button
                            size='small'
                            disabled={busy || Boolean(showBlocked)}
                            title={showBlocked}
                            onClick={() => void show(member.id)}
                          >
                            <Eye className='w-3.5 h-3.5' />
                            <span>{t('repositories.show')}</span>
                          </Button>
                        )}
                      </span>
                    )
                    : (
                      <span className='inline-flex items-center gap-1 shrink-0 text-xs text-muted'>
                        <Check size={12} aria-hidden='true' />
                        {t('repositories.added')}
                      </span>
                    )}
                </li>
              );
            }
            return (
              <li key={repository.fullName}>
                <button
                  type='button'
                  aria-pressed={selected?.fullName === repository.fullName}
                  onClick={() => setSelected(repository)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-left transition ${selected?.fullName === repository.fullName ? 'border-primary bg-primary-soft/40' : 'border-line hover:bg-fg/5'}`}
                >
                  <span className='font-mono text-sm truncate'>{repository.fullName}</span>
                  <span className='flex items-center gap-2 shrink-0 text-xs text-muted'>
                    {repository.private && (
                      <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sidebar'>
                        <Lock size={12} aria-hidden='true' />
                        {t('setup.private')}
                      </span>
                    )}
                    {new Date(repository.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            );
          })}
          {!answer.repositories.length && <li className='px-3 py-2 text-sm text-muted'>{t('setup.noRepositories')}</li>}
        </ul>
      )}
      {answer && answer.total > answer.repositories.length && <p className='text-xs text-muted mb-3'>{t('setup.moreRepositories', { count: answer.total - answer.repositories.length })}</p>}
      {answer?.newRepositoryUrl && !creating && (
        <button type='button' onClick={startCreating} className='w-full flex items-center justify-center gap-2 mb-3 px-3 py-2 rounded-lg border border-dashed border-line text-sm text-muted hover:text-fg hover:bg-fg/5 transition'>
          <Plus size={16} aria-hidden='true' />
          {t('setup.createRepository')}
        </button>
      )}
      {answer?.newRepositoryUrl && creating && (
        <section aria-label={t('setup.createSteps')} className='mb-3 p-3 rounded-lg bg-sidebar text-sm'>
          <h3 className='font-semibold mb-2'>{t('setup.createSteps')}</h3>
          <ol className='list-decimal pl-5 flex flex-col gap-2'>
            <li>
              {t('setup.createStepGitHub')}{' '}
              <a href={answer.newRepositoryUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-primary'>
                {t('setup.reopenGitHub')}
                <ExternalLink size={12} aria-hidden='true' />
              </a>
            </li>
            {answer.githubApp && answer.installUrl && (
              <li>
                {t('setup.createStepGrant')}{' '}
                <a href={answer.installUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-primary'>
                  {t('setup.grantNew')}
                  <ExternalLink size={12} aria-hidden='true' />
                </a>
              </li>
            )}
            <li>{t('setup.createStepReturn')}</li>
          </ol>
          <div className='flex items-center gap-3 mt-3'>
            <Button onClick={() => setReload(count => count + 1)}>
              <RefreshCw size={14} aria-hidden='true' />
              {t('setup.refreshList')}
            </Button>
            <button type='button' onClick={stopCreating} className='text-sm text-muted hover:text-fg'>{t('common.cancel')}</button>
          </div>
        </section>
      )}
      {selected && (
        <label className='flex flex-col gap-1 mb-3 text-sm'>
          <span>{t('setup.branch')}</span>
          <input value={branch} onChange={event => setBranch(event.target.value)} placeholder={selected.defaultBranch} className='px-3 py-2 rounded-lg border border-line bg-transparent font-mono text-sm' />
        </label>
      )}
      {notice}
      {error && <p role='alert' className='mb-3 text-sm text-danger'>{error}</p>}
      <div className='flex flex-wrap items-center gap-3'>
        <Button variant='primary' disabled={!selected || busy || blocked} onClick={() => void act()}>{busy ? busyLabel : actionLabel}</Button>
        {answer?.installUrl && (
          <a href={answer.installUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-sm text-primary'>
            {t('setup.grantMore')}
            <ExternalLink size={14} aria-hidden='true' />
          </a>
        )}
        {footer}
      </div>
    </>
  );
}
