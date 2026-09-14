import { Select } from './Select.js';
import { useEffect, useState } from 'react';
import { KeyRound, Copy, Check, Plus, Trash2, HelpCircle, Github, Gitlab, ChevronDown, LogOut } from 'lucide-react';
import { McpTutorialModal } from './McpTutorialModal.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useTranslation } from '../lib/i18n/index.js';
import type { TranslationKey } from '../lib/i18n/index.js';

class GrantRequestError extends Error {
  constructor(public key: TranslationKey) { super(key); }
}

async function requestGrant(url: string, fallback: TranslationKey, init?: RequestInit) {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const errors: Partial<Record<number, TranslationKey>> = {
        400: 'auth.grantSetupRequired',
        401: 'auth.grantSignInRequired',
        403: 'auth.grantAccessDenied',
        404: 'auth.grantNotFound',
        503: 'auth.grantServiceUnavailable',
      };
      throw new GrantRequestError(errors[response.status] || fallback);
    }
    return await response.json();
  } catch (error) {
    throw error instanceof GrantRequestError ? error : new GrantRequestError(fallback);
  }
}

type Session = { authenticated?: boolean; login?: string; configured?: boolean; provider?: 'github' | 'gitlab'; loginUrl?: string };
type Grant = { id: string; name: string; write: boolean; source: string; createdAt: number; expiresAt: null };
function useSession() {
  const [session, setSession] = useState<Session>({});
  useEffect(() => { fetch('/api/auth/session').then(r => r.json()).then(setSession).catch(() => {}); }, []);
  return session;
}
const connectionActionClass = 'inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0';

export function AuthControls({ local = false, connection = false }: { local?: boolean; connection?: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  if (local || (!session.authenticated && !session.provider)) return null;
  return session.authenticated ? <details className="header-user-menu">
    <summary className="header-user-button" aria-label={session.login}><span className="header-user-avatar">{session.login?.slice(0, 1).toUpperCase()}</span><span className="header-user-login">{session.login}</span><ChevronDown size={12} /></summary>
    <div className="header-user-popover"><span>{session.login}</span><button onClick={async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) window.location.reload();
    }}><LogOut size={14} />{t('auth.signOut')}</button></div>
  </details> : <a href={session.provider === 'gitlab' ? '/api/auth/gitlab' : '/api/auth/github'} className={connection ? `${connectionActionClass} ui-button-primary` : 'header-login'}>{session.provider === 'gitlab' ? <Gitlab size={16} /> : <Github size={16} />}<span>{t(session.provider === 'gitlab' ? 'auth.signInWithGitlab' : 'auth.signInWithGithub')}</span></a>;
}
export function AgentAccessSettings({ local = false }: { local?: boolean }) {
  const { t, language } = useTranslation();
  const session = useSession();
  const canManage = !local && Boolean(session.authenticated);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const refresh = async () => {
    const data = await requestGrant('/api/auth/agent-tokens', 'auth.loadGrantsFailed');
    setGrants(data.grants);
  };
  useEffect(() => { if (canManage) void refresh().catch((error: GrantRequestError) => setError(error.key)); }, [canManage]);
  const handleCopyToken = async () => {
    setCopyError(false);
    const input = document.getElementById('agent-token') as HTMLInputElement | null;
    const ok = await copyToClipboard(token, input);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      input?.select();
      setCopyError(true);
    }
  };
  const create = async () => {
    if (!canManage) return;
    setBusy(true); setError(null); setCopied(false); setCopyError(false); setToken('');
    try {
      const data = await requestGrant('/api/auth/agent-token', 'auth.createGrantFailed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, write }) });
      setToken(data.url); setName(''); await refresh();
    } catch (error) { setError((error as GrantRequestError).key); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await requestGrant(`/api/auth/agent-tokens/${id}`, 'auth.revokeGrantFailed', { method: 'DELETE' });
      setConfirmRevoke(null); setToken(''); await refresh();
    } catch (error) { setError((error as GrantRequestError).key); }
    finally { setBusy(false); }
  };
  return <section className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-200 flex gap-2 items-center">
        <KeyRound className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        {t('auth.mcpAccessControl')}
      </h3>
      <button
        type="button"
        onClick={() => setIsTutorialOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 transition active:scale-95 shadow-xs shrink-0 cursor-pointer"
        title={t('auth.connectorGuide')}
      >
        <HelpCircle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        <span>{t('auth.connectorGuide')}</span>
      </button>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">{t('auth.grantsActiveNotice')}</p>
    <p className="text-xs text-slate-500 dark:text-slate-400">{t('auth.chatgptConnectorNotice')}</p>
    {local ? <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{t('auth.localAccessNotice')}</p> : session.provider && !session.authenticated && <p className="text-sm"><a className="underline" href={session.provider === 'gitlab' ? '/api/auth/gitlab' : '/api/auth/github'}>{t(session.provider === 'gitlab' ? 'auth.signInWithGitlab' : 'auth.signInWithGithub')}</a>{t('auth.signInToManage')}</p>}
    <>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">{t('auth.clientName')}<input disabled={!canManage || busy} aria-label={t('auth.clientName')} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder={t('auth.clientNamePlaceholder')} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent" /></label>
        <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">{t('auth.access')}<Select disabled={!canManage || busy} aria-label={t('auth.access')} value={write ? 'write' : 'read'} onValueChange={value => setWrite(value === 'write')} options={[{ value: 'read', label: t('auth.readOnly') }, { value: 'write', label: t('auth.readAndWrite') }]} /></label>
        <button disabled={!canManage || busy} onClick={create} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-white transition hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--color-primary)' }}><Plus className="w-3.5 h-3.5" />{t('auth.createGrant')}</button>
      </div>
      {canManage && token && <div className="p-3 rounded-lg bg-black/5 dark:bg-white/5 flex flex-col gap-2">
        <label className="text-xs font-semibold" htmlFor="agent-token">{t('auth.copyUrlPrompt')}</label>
        <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
          <input
            id="agent-token"
            aria-label={t('auth.connectionUrlAria')}
            readOnly
            value={token}
            onClick={e => (e.target as HTMLInputElement).select()}
            onFocus={e => e.target.select()}
            className="flex-1 min-w-0 p-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono text-xs cursor-pointer select-all focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition active:scale-95 shadow-xs shrink-0 cursor-pointer ${
              copied
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-700 dark:hover:bg-indigo-600'
            }`}
            onClick={handleCopyToken}
            title={copied ? t('common.copied') : t('common.copy')}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? t('common.copied') : t('common.copy')}</span>
          </button>
          <button
            type="button"
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition active:scale-95 shadow-xs shrink-0 cursor-pointer"
            onClick={() => setIsTutorialOpen(true)}
          >
            <HelpCircle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span>{t('auth.connectorGuide')}</span>
          </button>
          <button
            type="button"
            className="px-2.5 py-1.5 text-xs rounded-lg border border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition shrink-0 cursor-pointer"
            onClick={() => { setToken(''); setCopyError(false); setCopied(false); }}
          >
            {t('auth.dismiss')}
          </button>
        </div>
        {copyError && <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">{t('auth.copyErrorManual')}</p>}
      </div>}
      {canManage && <div className="divide-y divide-slate-200 dark:divide-slate-800">{grants.map(grant => <div key={grant.id} className="py-3 flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-sm font-medium truncate">{grant.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{grant.write ? t('auth.readAndWrite') : t('auth.readOnly')} · {t('auth.untilRevoked')} · {new Date(grant.createdAt).toLocaleDateString(language)}</p><p className="text-xs font-mono text-slate-400 truncate">{grant.source.replace(/^(github|gitlab):/, '')}</p></div>
        {confirmRevoke === grant.id ? <div className="flex gap-3 text-xs shrink-0"><button disabled={busy} className="text-rose-600 font-semibold hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition" onClick={() => revoke(grant.id)}>{t('auth.confirmRevoke')}</button><button onClick={() => setConfirmRevoke(null)} className="hover:underline transition">{t('common.cancel')}</button></div> : <button disabled={busy} className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition" onClick={() => setConfirmRevoke(grant.id)}><Trash2 className="w-3.5 h-3.5" />{t('auth.revoke')}</button>}
      </div>)}{!grants.length && <p className="text-xs text-slate-400 py-2">{t('auth.noGrants')}</p>}</div>}
    </>
    {error && <p role="alert" className="text-xs text-rose-600">{t(error)}</p>}
    <McpTutorialModal
      isOpen={isTutorialOpen}
      onClose={() => setIsTutorialOpen(false)}
      activeUrl={token || undefined}
    />
  </section>;
}
export function ConnectionState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return <main className="min-h-screen p-8 flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}><div className="max-w-xl w-full p-8 rounded-2xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><h1 className="text-2xl font-semibold mb-4">MyGitNotes</h1><p role="status" className="mb-6">{loading ? t('auth.openingWorkspace') : error}</p>{!loading && <div className="flex flex-wrap items-center gap-3"><button onClick={onRetry} className={`${connectionActionClass} border hover:bg-black/5 dark:hover:bg-white/10 transition active:scale-95`}>{t('auth.retry')}</button><AuthControls connection /></div>}</div></main>;
}
