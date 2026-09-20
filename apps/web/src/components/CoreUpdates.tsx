import { useEffect, useState } from 'react';
import { RefreshCw, Shield } from 'lucide-react';
import type { CoreStatus, CoreUpdateReceipt, CoreUpdateRun } from '@mygitnotes/core';
import { CoreUpdateApiError, fetchCoreStatus, fetchCoreUpdateRun, installCoreSyncWorkflow, runCoreUpdate } from '../lib/api.js';
import { useTranslation } from '../lib/i18n/index.js';
import { Button } from './Button.js';

export function CoreUpdates({ local }: { local: boolean; }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<'updated' | 'alreadyCurrent' | null>(null);
  const [blockedState, setBlockedState] = useState<CoreStatus['state'] | null>(null);
  const [receipt, setReceipt] = useState<CoreUpdateReceipt | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('mygitnotes:core-update') || 'null');
    } catch {
      return null;
    }
  });
  const [run, setRun] = useState<CoreUpdateRun | null>(null);
  const working = busy || Boolean(receipt);
  useEffect(() => {
    if (!receipt) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await fetchCoreUpdateRun(receipt.requestId);
        if (!active) return;
        setRun(next);
        setError(null);
        if (next.state === 'pending' || next.state === 'running') {
          timer = setTimeout(poll, 3000);
          return;
        }
        sessionStorage.removeItem('mygitnotes:core-update');
        setReceipt(null);
        if (next.state === 'succeeded' || next.state === 'already_current') {
          setNotice(next.state === 'succeeded' ? 'updated' : 'alreadyCurrent');
          setStatus(await fetchCoreStatus());
        }
      } catch (error) {
        if (!active) return;
        setError(error instanceof Error ? error.message : String(error));
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [receipt]);
  useEffect(() => {
    let active = true;
    fetchCoreStatus().then(value => {
      if (active) setStatus(value);
    }).catch(error => {
      if (active) setError(error.message);
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => {
      active = false;
    };
  }, []);
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fetchCoreStatus());
      setBlockedState(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await installCoreSyncWorkflow();
      setStatus(await fetchCoreStatus());
      setBlockedState(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const update = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { result } = await runCoreUpdate();
      if (result.receipt) {
        sessionStorage.setItem('mygitnotes:core-update', JSON.stringify(result.receipt));
        setRun({ state: 'pending', targetSha: result.receipt.targetSha });
        setReceipt(result.receipt);
      } else {
        setNotice(result.alreadyUpToDate ? 'alreadyCurrent' : 'updated');
        setStatus(await fetchCoreStatus());
      }
    } catch (error) {
      if (error instanceof CoreUpdateApiError && ['PERMISSION_REQUIRED', 'WORKFLOW_PERMISSION_REQUIRED', 'WORKFLOW_MISSING', 'REAUTHORIZATION_REQUIRED', 'SECRET_PERMISSION_REQUIRED'].includes(error.code)) setBlockedState(error.code.toLowerCase() as CoreStatus['state']);
      else setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const state = blockedState || status?.state;
  return (
    <section id='settings-updates' aria-labelledby='core-updates-title' className='flex flex-col gap-3 p-4 bg-sidebar border border-line rounded-xl'>
      <h3 id='core-updates-title' className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
        <Shield className='w-4 h-4 text-primary' aria-hidden='true' />
        {t('settings.coreUpdates')}
      </h3>
      <p className='text-xs text-muted'>{t('coreUpdate.description')}</p>
      <div role='status' aria-live='polite' className='text-sm text-fg space-y-3' data-core-state={state || 'checking'}>
        {busy && <p>{t('coreUpdate.checking')}</p>}
        {run && <p data-core-run={run.state}>{t(`coreUpdate.run.${run.state}`)}</p>}
        {run?.url && <a className='text-primary underline' href={run.url} target='_blank' rel='noreferrer'>{t('coreUpdate.viewRun')}</a>}
        {status && (
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-2'>
            <div className='rounded-lg border border-line bg-surface p-3 space-y-1.5'>
              <p className='text-[11px] font-semibold uppercase tracking-wider text-muted'>{t('coreUpdate.repositoryLabel')}</p>
              {state && <p className='font-medium'>{t(`coreUpdate.${state}`, { count: status.current?.behind || 0 })}</p>}
              {status.upstream && <p className='text-xs text-muted break-all'>{status.upstream}</p>}
            </div>
            {state !== 'unsupported' && (
              <div className='rounded-lg border border-line bg-surface p-3 space-y-1.5'>
                <p className='text-[11px] font-semibold uppercase tracking-wider text-muted'>{t('coreUpdate.runningLabel')}</p>
                <p className='font-medium break-all'>{t('coreUpdate.running', { sha: status.runningBuild })}</p>
                <p className='text-xs text-muted' data-core-running-behind={status.running?.behind ?? 'unknown'}>{status.running ? t(status.running.ahead && status.running.behind ? 'coreUpdate.runningDiverged' : status.running.behind ? 'coreUpdate.runningBehind' : status.running.ahead ? 'coreUpdate.runningAhead' : 'coreUpdate.runningCurrent', { count: status.running.behind }) : t('coreUpdate.runningUnknown')}</p>
              </div>
            )}
          </div>
        )}
        {notice && <p>{t(`coreUpdate.${notice}`)}</p>}
        {((notice === 'updated') || (status?.running && status.running.behind > 0 && status.current?.behind === 0)) && <p className='text-xs text-muted'>{t(local ? 'coreUpdate.restartLocal' : 'coreUpdate.restartRemote')}</p>}
      </div>
      {error && <p role='alert' className='text-xs text-danger'>{error}</p>}
      <div className='flex flex-wrap gap-2'>
        {state === 'reauthorization_required' && <a className='text-primary underline' href='/api/auth/github'>{t('coreUpdate.reauthorize')}</a>}
        {state === 'workflow_missing' && <Button type='button' onClick={install} disabled={working}>{t('coreUpdate.install')}</Button>}
        <Button type='button' variant='primary' onClick={update} disabled={working || !status?.canUpdate || Boolean(blockedState)} data-core-update>
          <RefreshCw className={`w-3.5 h-3.5 ${working ? 'animate-spin' : ''}`} aria-hidden='true' />
          {t('coreUpdate.update')}
        </Button>
        <Button type='button' onClick={check} disabled={working}>{t('coreUpdate.check')}</Button>
      </div>
    </section>
  );
}
