import { Select } from './Select.js';
import { useEffect, useState } from 'react';
import { KeyRound, Copy, Plus, Trash2, HelpCircle } from 'lucide-react';
import { McpTutorialModal } from './McpTutorialModal.js';

type Session = { authenticated?: boolean; login?: string; configured?: boolean };
type Grant = { id: string; name: string; write: boolean; source: string; createdAt: number; expiresAt: null };
function useSession() {
  const [session, setSession] = useState<Session>({});
  useEffect(() => { fetch('/api/auth/session').then(r => r.json()).then(setSession).catch(() => {}); }, []);
  return session;
}
export function AuthControls({ local = false }: { local?: boolean }) {
  const session = useSession();
  if (local) return null;
  return session.authenticated ? <div className="flex items-center gap-2 text-xs shrink-0 text-slate-600 dark:text-slate-300">
    <span>{session.login}</span>
    <button className="underline hover:opacity-80 transition" onClick={async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (response.ok) window.location.reload();
    }}>Sign out</button>
  </div> : <a href="/api/auth/github" className="px-3 py-1.5 rounded-lg text-white text-xs shrink-0 hover:opacity-90 active:scale-95 transition" style={{ backgroundColor: 'var(--color-primary)' }}>Sign in with GitHub</a>;
}
export function AgentAccessSettings({ local = false }: { local?: boolean }) {
  const session = useSession();
  const canManage = !local && Boolean(session.authenticated);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [name, setName] = useState('');
  const [write, setWrite] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const refresh = async () => {
    const response = await fetch('/api/auth/agent-tokens');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setGrants(data.grants);
  };
  useEffect(() => { if (canManage) void refresh().catch(error => setError(error.message)); }, [canManage]);
  const create = async () => {
    if (!canManage) return;
    setBusy(true); setError(''); setCopied(false); setToken('');
    try {
      const response = await fetch('/api/auth/agent-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, write }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setToken(data.url); setName(''); await refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/auth/agent-tokens/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error);
      setConfirmRevoke(null); setToken(''); await refresh();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col gap-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold text-sm text-slate-800 dark:text-slate-200 flex gap-2 items-center">
        <KeyRound className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        MCP Access Control
      </h3>
      <button
        type="button"
        onClick={() => setIsTutorialOpen(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 transition active:scale-95 shadow-xs shrink-0 cursor-pointer"
        title="開啟 ChatGPT / Claude / Cursor 連接器教學"
      >
        <HelpCircle className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        <span>連接器教學指南</span>
      </button>
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">Grants stay active until you revoke them here. Signing out keeps them active. Paste the connection URL into your MCP client; creating or revoking a grant takes effect immediately.</p>
    <p className="text-xs text-slate-500 dark:text-slate-400">For a ChatGPT connector, paste the full URL as the MCP server URL and select No authentication. The URL itself grants access.（若需詳細圖文步驟，請點擊上方「連接器教學指南」）</p>
    {local ? <p role="status" className="text-sm text-slate-600 dark:text-slate-300">Local workspace access follows your operating-system permissions. Persistent MCP connection URLs are available for a GitHub workspace.</p> : !session.authenticated && <p className="text-sm"><a className="underline" href="/api/auth/github">Sign in with GitHub</a> to manage agent access.</p>}
    <>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">Client name<input disabled={!canManage || busy} aria-label="MCP client name" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Notes assistant" className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent" /></label>
        <label className="text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-1">Access<Select disabled={!canManage || busy} aria-label="MCP access" value={write ? 'write' : 'read'} onValueChange={value => setWrite(value === 'write')} options={[{value:'read',label:'Read-only'},{value:'write',label:'Read and write'}]} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900" /></label>
        <button disabled={!canManage || busy} onClick={create} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-white transition hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed" style={{ backgroundColor: 'var(--color-primary)' }}><Plus className="w-3.5 h-3.5" />Create grant</button>
      </div>
      {canManage && token && <div className="p-3 rounded-lg bg-black/5 dark:bg-white/5 flex flex-col gap-2">
        <label className="text-xs font-semibold" htmlFor="agent-token">Copy this MCP connection URL now; it is shown once.</label>
        <div className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
          <input id="agent-token" aria-label="MCP connection URL" readOnly value={token} onFocus={e => e.target.select()} className="flex-1 min-w-0 p-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono text-xs" />
          <button className="text-xs flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition" onClick={async () => { try { await navigator.clipboard.writeText(token); setCopied(true); } catch { setError('Select the connection URL and copy it manually.'); } }}><Copy className="w-3.5 h-3.5" />{copied ? 'Copied' : 'Copy'}</button>
          <button className="text-xs flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline transition" onClick={() => setIsTutorialOpen(true)}><HelpCircle className="w-3.5 h-3.5" />教學</button>
          <button className="text-xs underline hover:opacity-80 transition" onClick={() => setToken('')}>Dismiss</button>
        </div>
      </div>}
      {canManage && <div className="divide-y divide-slate-200 dark:divide-slate-800">{grants.map(grant => <div key={grant.id} className="py-3 flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-sm font-medium truncate">{grant.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{grant.write ? 'Read and write' : 'Read-only'} · Until revoked · {new Date(grant.createdAt).toLocaleDateString()}</p><p className="text-xs font-mono text-slate-400 truncate">{grant.source.replace(/^github:/, '')}</p></div>
        {confirmRevoke === grant.id ? <div className="flex gap-3 text-xs shrink-0"><button disabled={busy} className="text-rose-600 font-semibold hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition" onClick={() => revoke(grant.id)}>Confirm revoke</button><button onClick={() => setConfirmRevoke(null)} className="hover:underline transition">Cancel</button></div> : <button disabled={busy} className="text-xs text-rose-600 hover:text-rose-700 flex items-center gap-1 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition" onClick={() => setConfirmRevoke(grant.id)}><Trash2 className="w-3.5 h-3.5" />Revoke</button>}
      </div>)}{!grants.length && <p className="text-xs text-slate-400 py-2">No persistent agent grants yet.</p>}</div>}
    </>
    {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
    <McpTutorialModal
      isOpen={isTutorialOpen}
      onClose={() => setIsTutorialOpen(false)}
      activeUrl={token || undefined}
    />
  </section>;
}
export function ConnectionState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  return <main className="min-h-screen p-8 flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-text)' }}><div className="max-w-xl w-full p-8 rounded-2xl border" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><h1 className="text-2xl font-semibold mb-4">GitHub Notes</h1><p role="status" className="mb-6">{loading ? 'Opening your workspace…' : error}</p>{!loading && <div className="flex items-center gap-4"><button onClick={onRetry} className="px-4 py-2 border rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition active:scale-95">Retry</button><AuthControls /></div>}</div></main>;
}
