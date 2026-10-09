import { type ReactNode, useEffect, useState } from 'react';
import { ArrowLeftRight, GitBranch, Languages, ListTree, LogOut, Network, ShieldCheck } from 'lucide-react';
import { Button } from './Button.js';
import { AuthControls, ConnectionState } from './AuthControls.js';
import { LoadingStatus } from './LoadingStatus.js';
import { RepositoryAddFlow } from './RepositoryAdd.js';
import { RepositoryChooser } from './RepositoryChooser.js';
import type { AvailableRepository } from '../lib/available-repositories.js';
import { fetchMembers, type MembersAnswer } from '../lib/members-api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Select } from './Select.js';
import { useTheme } from '../app/useTheme.js';
import { updateWorkspaceConfig } from '../lib/api.js';
import type { WorkspaceConfig } from '../lib/types.js';
import YAML from 'yaml';

/**
 * What `/api/auth/session` says about the visitor; `repositoryChoice` deployments have each visitor bring a repository:
 * picked through repository choices, or, with `accountMembers`, added to the list their account keeps.
 */
export interface SessionProbe {
  authenticated?: boolean;
  login?: string;
  storage?: 'stored' | 'cookie';
  repositoryChoice?: boolean;
  accountMembers?: boolean;
  workspace?: { repository: string; branch: string; } | null;
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
  const open = async (selected: AvailableRepository, branch: string | undefined) => {
    const response = await fetch('/api/workspace/choice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: selected.fullName, branch }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || t('setup.chooseFailed'));
    window.location.assign('/');
  };
  return (
    <SetupCard>
      <h2 className='font-serif text-xl font-semibold mb-2'>{t('setup.chooseTitle')}</h2>
      <p className='mb-4 text-sm text-muted'>{t('setup.chooseDescription')}</p>
      <RepositoryChooser actionLabel={t('setup.open')} busyLabel={t('setup.opening')} onChoose={open} footer={<SignOutButton login={login} />} />
    </SetupCard>
  );
}

function SignOutButton({ login }: { login?: string; }) {
  const { t } = useTranslation();
  return (
    <button type='button' onClick={() => void signOut()} className='ml-auto inline-flex items-center gap-1 text-sm text-muted hover:text-fg'>
      <LogOut size={14} aria-hidden='true' />
      {login ? t('setup.signOutAs', { login }) : t('auth.signOut')}
    </button>
  );
}

/**
 * Where each person keeps their own repositories (an edition's account list): the add flow for someone who has none
 * yet, which opens the workspace once the first one is added.
 */
function FirstRepository({ login }: { login?: string; }) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<MembersAnswer>();
  const [error, setError] = useState('');
  const load = async () => {
    try {
      setMembers(await fetchMembers());
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void fetchMembers().then(answer => !cancelled && setMembers(answer), (cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <SetupCard>
      <h2 className='font-serif text-xl font-semibold mb-2'>{t('setup.addFirstTitle')}</h2>
      <p className='mb-4 text-sm text-muted'>{t('setup.addFirstDescription')}</p>
      {members ? <RepositoryAddFlow members={members} onAdded={() => window.location.assign('/')} onStale={load} /> : error ? <p role='alert' className='mb-3 text-sm text-danger'>{error}</p> : <LoadingStatus className='mb-3'>{t('repositories.loading')}</LoadingStatus>}
      <div className='flex mt-3'>
        <SignOutButton login={login} />
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
  return session.accountMembers ? <FirstRepository login={session.login} /> : <RepositoryPicker login={session.login} />;
}

/** Offers to commit the manifest derived for a repository that has none, so its layout is kept and editable in Settings; `config` names notebooks by local id, as the file keeps them. */
export function DerivedManifestNotice({ repository, config, configRevision, canWrite, onCreated }: { repository: string; config: WorkspaceConfig; configRevision: string; canWrite: boolean; onCreated: () => Promise<void>; }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (dismissed) return null;
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await updateWorkspaceConfig(repository, YAML.stringify(config), configRevision);
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
