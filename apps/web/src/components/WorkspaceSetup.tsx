import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ExternalLink, GitBranch, Languages, ListTree, Lock, LogOut, Network, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Button } from './Button.js';
import { AuthControls, ConnectionState } from './AuthControls.js';
import { LoadingStatus } from './LoadingStatus.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { useTheme } from '../app/useTheme.js';
import { updateWorkspaceConfig } from '../lib/api.js';
import type { WorkspaceConfig } from '../lib/types.js';
import YAML from 'yaml';

/** What `/api/auth/session` says about the visitor; `repositoryChoice` deployments let each visitor pick a repository. */
export interface SessionProbe {
  authenticated?: boolean;
  login?: string;
  storage?: 'stored' | 'cookie';
  repositoryChoice?: boolean;
  workspace?: { repository: string; branch: string; } | null;
}
interface AvailableRepository {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
}
interface AvailableAnswer {
  repositories: AvailableRepository[];
  total: number;
  githubApp: boolean;
  installUrl: string | null;
  /** GitHub's page for a new repository from the starter template; absent on an Enterprise site that names no template. */
  newRepositoryUrl: string | null;
}

const FEATURES = [{ icon: ListTree, key: 'setup.featureNotes' }, { icon: Network, key: 'setup.featureGraph' }, { icon: GitBranch, key: 'setup.featureGit' }] as const;

/**
 * The screens before a workspace opens: the product on one side, the sign-in or repository picker on the other.
 * They render before the app, so they apply the theme themselves and offer the language a visitor cannot yet set in Settings.
 */
function SetupCard({ children }: { children: ReactNode; }) {
  const { t, language, setLanguage } = useTranslation();
  useTheme();
  return (
    <main className='min-h-screen grid md:grid-cols-2' style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <section className='flex flex-col justify-center gap-6 md:gap-8 px-6 py-8 md:px-16 md:py-10 bg-sidebar'>
        <div className='flex items-center gap-4'>
          <img src={`${import.meta.env.BASE_URL}brand/github-notes-192.png`} width='56' height='56' alt='' className='rounded-xl' />
          <div>
            <h1 className='font-serif text-3xl font-semibold'>MyGitNotes</h1>
            <p className='text-sm text-muted'>{t('header.gitWorkspace')}</p>
          </div>
        </div>
        <p className='max-w-md text-base'>{t('setup.brandDescription')}</p>
        {/* On a phone the features would push the sign-in below the fold. */}
        <ul className='hidden md:flex flex-col gap-4 max-w-md'>
          {FEATURES.map(({ icon: Icon, key }) => (
            <li key={key} className='flex items-start gap-3 text-sm'>
              <span className='shrink-0 w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center'>
                <Icon size={16} aria-hidden='true' />
              </span>
              <span className='pt-1.5'>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className='flex flex-col px-6 py-6 md:px-12'>
        <div className='setup-language flex justify-end items-center gap-2 text-muted'>
          <Languages size={16} aria-hidden='true' />
          <Select aria-label={t('settings.language')} value={language} onValueChange={next => setLanguage(next as typeof language)} options={[{ value: 'en', label: 'English' }, { value: 'zh-TW', label: '繁體中文' }]} />
        </div>
        <div className='flex-1 flex items-center justify-center py-8'>
          <div className='w-full max-w-md p-8 rounded-2xl border border-line bg-surface'>{children}</div>
        </div>
      </section>
    </main>
  );
}

/** The first screen where visitors choose their repository: why to sign in, the GitHub button, and what the sign-in can reach. */
function SignIn({ storage }: { storage?: SessionProbe['storage']; }) {
  const { t } = useTranslation();
  return (
    <SetupCard>
      <h2 className='font-serif text-xl font-semibold mb-2'>{t('setup.signInTitle')}</h2>
      <p className='text-sm text-muted mb-6'>{t('setup.signInDescription')}</p>
      <AuthControls connection />
      <div className='mt-6 p-3 rounded-lg bg-sidebar flex items-start gap-2 text-xs text-muted'>
        <ShieldCheck size={16} aria-hidden='true' className='shrink-0 text-primary' />
        <span>{t(storage === 'cookie' ? 'setup.privacy' : 'setup.privacyStored')}</span>
      </div>
    </SetupCard>
  );
}

async function signOut() {
  const response = await fetch('/api/auth/logout', { method: 'POST' });
  if (response.ok) window.location.reload();
}

/** Lists the repositories the visitor may open and stores the one they pick. */
export function RepositoryPicker({ login }: { login?: string; }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<AvailableAnswer | null>(null);
  const [selected, setSelected] = useState<AvailableRepository | null>(null);
  const [branch, setBranch] = useState('');
  // Listing and opening fail separately, so a list that loads again does not hide why opening failed.
  const [listError, setListError] = useState('');
  const [openError, setOpenError] = useState('');
  const [busy, setBusy] = useState(false);
  // While a visitor creates a repository on GitHub: the unfiltered list from before, so the one that appears can be selected.
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
      fetch(`/api/repositories/available?query=${encodeURIComponent(query)}`, { signal: controller.signal }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t('setup.listFailed'));
        setAnswer(body);
        setListError('');
        const pending = creation.current;
        if (pending && !query) {
          const names = (body as AvailableAnswer).repositories.map(repository => repository.fullName);
          const created = pending.before && (body as AvailableAnswer).repositories.find(repository => !pending.before!.has(repository.fullName));
          if (!pending.before) pending.before = new Set(names);
          else if (created) {
            setSelected(created);
            setBranch('');
            creation.current = null;
            setCreating(false);
          }
        }
      }).catch((reason: Error) => {
        if (reason.name !== 'AbortError') setListError(reason.message);
      });
    }, query ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, reload, t]);
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
  const open = async () => {
    if (!selected) return;
    setBusy(true);
    setOpenError('');
    try {
      const response = await fetch('/api/workspace/choice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: selected.fullName, branch: branch.trim() || undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('setup.chooseFailed'));
      window.location.assign('/');
    } catch (reason) {
      setOpenError((reason as Error).message);
      setBusy(false);
    }
  };
  const error = openError || listError;
  return (
    <SetupCard>
      <h2 className='font-serif text-xl font-semibold mb-2'>{t('setup.chooseTitle')}</h2>
      <p className='mb-4 text-sm text-muted'>{t('setup.chooseDescription')}</p>
      <label className='flex items-center gap-2 px-3 py-2 rounded-lg border border-line mb-3'>
        <Search size={16} aria-hidden='true' className='text-muted' />
        <input aria-label={t('setup.searchRepositories')} placeholder={t('setup.searchRepositories')} value={query} onChange={event => setQuery(event.target.value)} className='flex-1 min-w-0 bg-transparent focus:outline-none' />
      </label>
      {!answer && !listError && <LoadingStatus className='mb-3'>{t('setup.loadingRepositories')}</LoadingStatus>}
      {answer && (
        <ul className='flex flex-col gap-1 max-h-80 overflow-y-auto mb-3' aria-label={t('setup.repositories')}>
          {answer.repositories.map(repository => (
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
          ))}
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
      {error && <p role='alert' className='mb-3 text-sm text-danger'>{error}</p>}
      <div className='flex flex-wrap items-center gap-3'>
        <Button variant='primary' disabled={!selected || busy} onClick={() => void open()}>{busy ? t('setup.opening') : t('setup.open')}</Button>
        {answer?.installUrl && (
          <a href={answer.installUrl} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 text-sm text-primary'>
            {t('setup.grantMore')}
            <ExternalLink size={14} aria-hidden='true' />
          </a>
        )}
        <button type='button' onClick={() => void signOut()} className='ml-auto inline-flex items-center gap-1 text-sm text-muted hover:text-fg'>
          <LogOut size={14} aria-hidden='true' />
          {login ? t('setup.signOutAs', { login }) : t('auth.signOut')}
        </button>
      </div>
    </SetupCard>
  );
}

/**
 * Where visitors choose their repository, shows the sign-in screen or the repository picker until they have one.
 * The session probe runs first because it refreshes a lightweight sign-in about to expire, ahead of the
 * workspace's parallel reads, which could otherwise each spend the same single-use refresh token.
 */
export function WorkspaceGate({ children }: { children: ReactNode; }) {
  const [session, setSession] = useState<SessionProbe | null>(null);
  useEffect(() => {
    fetch('/api/auth/session').then(response => response.ok ? response.json() : {}).catch(() => ({})).then(setSession);
  }, []);
  if (!session) {
    return (
      // Every deployment passes through here, so the wait looks like the app's own loading state, not the sign-in page.
      <ConnectionState loading error='' onRetry={() => {}} />
    );
  }
  if (!session.repositoryChoice || (session.authenticated && session.workspace)) return children;
  if (!session.authenticated) return <SignIn storage={session.storage} />;
  return <RepositoryPicker login={session.login} />;
}

/** Offers to commit the manifest derived for a repository that has none, so its layout is kept and editable in Settings; `config` names notebooks by local id, as the file keeps them. */
export function DerivedManifestNotice({ config, configRevision, canWrite, onCreated }: { config: WorkspaceConfig; configRevision: string; canWrite: boolean; onCreated: () => Promise<void>; }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (dismissed) return null;
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await updateWorkspaceConfig(YAML.stringify(config), configRevision);
      await onCreated();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role='status' className='shrink-0 px-4 py-2 text-sm bg-surface border-b border-line flex flex-wrap items-center gap-2'>
      <span className='flex-1 min-w-0'>{error || t('setup.derivedManifest')}</span>
      {canWrite && <Button variant='primary' size='small' disabled={busy} onClick={() => void create()}>{busy ? t('setup.creatingManifest') : t('setup.createManifest')}</Button>}
      <Button size='small' onClick={() => setDismissed(true)}>{t('setup.dismiss')}</Button>
    </div>
  );
}

/** Settings → Access: the repository this visitor chose, and a way back to the picker. */
export function RepositorySwitch({ repository, branch }: { repository: string; branch: string; }) {
  const { t } = useTranslation();
  const switchRepository = async () => {
    const response = await fetch('/api/workspace/choice', { method: 'DELETE' });
    if (response.ok) window.location.assign('/');
  };
  return (
    <section className='border border-line rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3'>
      <span className='flex-1 min-w-0 font-mono text-sm truncate'>
        {repository}
        <span className='text-muted'>@{branch}</span>
      </span>
      <Button onClick={() => void switchRepository()}>
        <ArrowLeftRight size={14} aria-hidden='true' />
        <span>{t('setup.switchRepository')}</span>
      </Button>
    </section>
  );
}
