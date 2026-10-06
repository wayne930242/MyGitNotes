import { type ReactNode, useEffect, useState } from 'react';
import { ArrowLeftRight, ExternalLink, Lock, LogOut, Search } from 'lucide-react';
import { Button } from './Button.js';
import { AuthControls } from './AuthControls.js';
import { LoadingStatus } from './LoadingStatus.js';
import { useTranslation } from '../lib/i18n/index.js';
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
  installUrl: string | null;
}

function SetupCard({ children }: { children: ReactNode; }) {
  return (
    <main className='min-h-screen p-8 flex items-center justify-center' style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <div className='max-w-xl w-full p-8 rounded-2xl border' style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h1 className='text-2xl font-semibold mb-4'>MyGitNotes</h1>
        {children}
      </div>
    </main>
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // Typing settles before the list is asked for, so each keystroke does not list the account again.
    const timer = setTimeout(() => {
      fetch(`/api/repositories/available?query=${encodeURIComponent(query)}`, { signal: controller.signal }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || t('setup.listFailed'));
        setAnswer(body);
        setError('');
      }).catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      });
    }, query ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, t]);
  const open = async () => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace/choice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: selected.fullName, branch: branch.trim() || undefined }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('setup.chooseFailed'));
      window.location.assign('/');
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };
  return (
    <SetupCard>
      <p className='mb-4 text-sm text-muted'>{t('setup.chooseDescription')}</p>
      <label className='flex items-center gap-2 px-3 py-2 rounded-lg border border-line mb-3'>
        <Search size={16} aria-hidden='true' className='text-muted' />
        <input aria-label={t('setup.searchRepositories')} placeholder={t('setup.searchRepositories')} value={query} onChange={event => setQuery(event.target.value)} className='flex-1 min-w-0 bg-transparent focus:outline-none' />
      </label>
      {!answer && !error && <LoadingStatus className='mb-3'>{t('setup.loadingRepositories')}</LoadingStatus>}
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
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionProbe | null>(null);
  useEffect(() => {
    fetch('/api/auth/session').then(response => response.ok ? response.json() : {}).catch(() => ({})).then(setSession);
  }, []);
  if (!session) {
    return (
      <SetupCard>
        <LoadingStatus>{t('auth.openingWorkspace')}</LoadingStatus>
      </SetupCard>
    );
  }
  if (!session.repositoryChoice || (session.authenticated && session.workspace)) return children;
  if (!session.authenticated) {
    return (
      <SetupCard>
        <p className='mb-6'>{t('setup.signInDescription')}</p>
        <AuthControls connection />
      </SetupCard>
    );
  }
  return <RepositoryPicker login={session.login} />;
}

/** Offers to commit the manifest derived for a repository that has none, so its layout is kept and editable in Settings. */
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
