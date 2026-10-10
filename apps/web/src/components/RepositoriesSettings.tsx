import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Eye, EyeOff, FolderGit2, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslation } from '../lib/i18n/index.js';
import { addMember, fetchMembers, type MembersAnswer, MembershipApiError, removeMember, reorderMembers, setDefaultMember, setMemberHidden, type WorkspaceMemberStatus } from '../lib/members-api.js';
import { discardRepositoryDrafts, type DraftRepository, type RepositoryDraft, repositoryDrafts } from '../lib/repository-drafts.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { useRepositoryNotices } from '../lib/web-features.js';
import { Button } from './Button.js';
import { limitReached, MembersLimitLine, RepositoryAddFlow } from './RepositoryAdd.js';
import { WorkspaceDialog } from './WorkspaceDialog.js';

export interface RepositoriesSettingsProps {
  /** The visible repositories as the workspace loaded them: titles, notebooks and why one is unavailable. */
  repositories: WorkspaceRepository[];
  /** Reloads the workspace after a membership change, dropping results of repositories that left. */
  onMembershipChanged: () => Promise<void>;
  /** Opens the Changes dialog, where drafts are committed or discarded. */
  onOpenChanges: () => void;
}

/** The local ids a repository's notebooks keep, from their keys. */
const localIds = (repository: WorkspaceRepository | undefined) => (repository?.notebooks ?? []).map(key => key.slice(key.indexOf('~') + 1));
/** Where a member lives: its platform repository and branch, or its worktree. */
const location = (member: WorkspaceMemberStatus) => member.repository ? `${member.repository} · ${member.branch}` : member.path ?? member.id;

/**
 * Settings → Repositories: every member of the workspace, hidden ones included, read from the configuration without
 * opening a repository. Where the deployment lets this page change them, it adds (a worktree path in a local
 * deployment, a repository from the picker where an account keeps the list), removes, hides, shows, reorders and
 * chooses the default; hiding or removing waits until this browser holds no drafts for it, then asks first where an
 * edition adds a notice. A visible-repository limit shows as a quiet line and keeps adding and showing past it.
 */
export function RepositoriesSettings({ repositories, onMembershipChanged, onOpenChanges }: RepositoriesSettingsProps) {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<MembersAnswer>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState('');
  const [folder, setFolder] = useState<string>();
  const [drafts, setDrafts] = useState<{ repository: DraftRepository; action: 'hide' | 'remove'; drafts: RepositoryDraft[]; }>();
  const [confirm, setConfirm] = useState<{ member: WorkspaceMemberStatus; action: 'hide' | 'remove'; change: (revision: string) => Promise<unknown>; }>();
  const [adding, setAdding] = useState(false);
  // A change the limit refused reads as part of the limit line, not as an error.
  const [limitRefusal, setLimitRefusal] = useState('');
  const notices = useRepositoryNotices();

  const load = useCallback(async () => {
    try {
      setAnswer(await fetchMembers());
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetchMembers().then(members => !cancelled && setAnswer(members), (cause: Error) => !cancelled && setError(cause.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const statusOf = (member: WorkspaceMemberStatus) => repositories.find(repository => repository.id === member.id);
  /** Where a member's drafts are kept: as the workspace loaded it, or, for a hidden member it did not load, as the list names it. */
  const draftsOf = (member: WorkspaceMemberStatus): DraftRepository => statusOf(member) ?? { id: member.id, alias: member.alias, branch: member.branch ?? '' };
  /** Runs one change against the revision this page read; a stale read reloads the list and says so. */
  const run = async (change: (revision: string) => Promise<unknown>) => {
    if (!answer?.revision) return;
    setBusy(true);
    setError('');
    setLimitRefusal('');
    try {
      await change(answer.revision);
      await Promise.all([load(), onMembershipChanged()]);
      return true;
    } catch (cause) {
      if (cause instanceof MembershipApiError && cause.code === 'visible-limit') {
        setLimitRefusal(cause.message);
        await load();
      } else if (cause instanceof MembershipApiError && cause.code === 'stale') {
        setError(t('repositories.stale'));
        await load();
      } else if (cause instanceof MembershipApiError && cause.code === 'folder-required') setFolder('');
      else setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  /**
   * Hiding or removing a repository this browser holds drafts for waits until they are committed or discarded; where an
   * edition adds a notice (what becomes of published pages, say), the person confirms it first.
   */
  const guarded = (member: WorkspaceMemberStatus, action: 'hide' | 'remove', change: (revision: string) => Promise<unknown>) => {
    const repository = draftsOf(member);
    const held = repositoryDrafts(repository);
    if (held.length) return setDrafts({ repository, action, drafts: held });
    if (notices.length) return setConfirm({ member, action, change });
    void run(change);
  };
  /** Adding from the picker changed the list: reload it and the workspace, and close the picker. */
  const added = async () => {
    setAdding(false);
    await Promise.all([load(), onMembershipChanged()]);
  };
  const add = async () => {
    if (await run(revision => addMember(path.trim(), revision, folder?.trim() || undefined))) {
      setPath('');
      setFolder(undefined);
    }
  };

  if (!answer) {
    return (
      <div id='settings-repositories' className='flex flex-col gap-3'>
        <Heading />
        {error ? <p role='alert' className='text-xs text-danger'>{error}</p> : <p role='status' className='text-xs text-muted'>{t('repositories.loading')}</p>}
      </div>
    );
  }
  const { members, changeable } = answer;
  const visible = members.filter(member => !member.hidden);
  const full = limitReached(answer.limit);
  const fullReason = full ? t('repositories.limitReached') : undefined;
  /** Visible members whose notebooks share a local id with another visible member, and so `r2:<id>/` keys. */
  const sharedKeys = (member: WorkspaceMemberStatus) => {
    if (!answer.sharedAssetKeys || member.hidden) return [];
    const own = localIds(statusOf(member));
    return visible.filter(other => other !== member && localIds(statusOf(other)).some(id => own.includes(id))).map(other => ({ alias: other.alias, ids: localIds(statusOf(other)).filter(id => own.includes(id)) }));
  };
  const move = (member: WorkspaceMemberStatus, by: -1 | 1) => {
    const order = members.map(entry => entry.id);
    const from = order.indexOf(member.id);
    [order[from], order[from + by]] = [order[from + by], order[from]];
    void run(revision => reorderMembers(order, revision));
  };

  return (
    <div id='settings-repositories' className='flex flex-col gap-3'>
      <Heading />
      {!changeable && <p className='text-xs text-muted'>{t(answer.repositoryChoice ? 'repositories.chosen' : 'repositories.readOnly')}</p>}
      <ul className='flex flex-col gap-2' aria-label={t('repositories.title')}>
        {members.map((member, index) => {
          const status = statusOf(member);
          const changes = changeable && member.editable !== 'none';
          const shared = sharedKeys(member);
          // The environment's member always stays (decision C9); the default stays while other members exist (decision C8).
          const environment = member.editable === 'environment' ? t('repositories.environmentMember', { setting: answer.environment ?? t('repositories.environmentSetting') }) : '';
          const removeBlocked = environment || (member.default && members.length > 1 ? t('repositories.defaultHide') : '');
          const reasons = changes ? [member.default ? t('repositories.defaultHide') : '', environment].filter(Boolean) : [];
          return (
            <li key={member.id} className='p-3 rounded-xl border border-line bg-surface flex flex-col gap-2' data-member={member.alias}>
              <div className='flex flex-wrap items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-1.5'>
                    <span className='font-semibold text-sm text-fg'>{status?.title ?? member.alias}</span>
                    <code className='text-[11px] px-1.5 py-0.5 rounded bg-sidebar text-muted'>{member.alias}</code>
                    {member.default && <span className='text-[11px] px-2 py-0.5 rounded-full bg-primary-soft text-primary'>{t('repositories.default')}</span>}
                    {member.hidden && <span className='text-[11px] px-2 py-0.5 rounded-full bg-sidebar text-muted'>{t('repositories.hidden')}</span>}
                    {status?.unavailable && <span className='text-[11px] px-2 py-0.5 rounded-full bg-danger-soft text-danger'>{t('repositories.unavailable')}</span>}
                  </div>
                  <p className='text-xs text-muted font-mono break-all mt-0.5'>{location(member)}{member.folder ? ` · ${t('repositories.folder', { folder: member.folder })}` : ''}</p>
                </div>
                {changes && (
                  <div className='flex flex-wrap items-center gap-1'>
                    <Button size='icon' aria-label={t('repositories.moveUp', { alias: member.alias })} title={t('repositories.moveUp', { alias: member.alias })} disabled={busy || index === 0} onClick={() => move(member, -1)}>
                      <ArrowUp className='w-4 h-4' />
                    </Button>
                    <Button size='icon' aria-label={t('repositories.moveDown', { alias: member.alias })} title={t('repositories.moveDown', { alias: member.alias })} disabled={busy || index === members.length - 1} onClick={() => move(member, 1)}>
                      <ArrowDown className='w-4 h-4' />
                    </Button>
                    {!member.default && (
                      <Button size='small' disabled={busy || (member.hidden && full)} title={member.hidden ? fullReason : undefined} onClick={() => void run(revision => setDefaultMember(member.id, revision))}>
                        <Star className='w-3.5 h-3.5' />
                        <span>{t('repositories.makeDefault')}</span>
                      </Button>
                    )}
                    {member.hidden
                      ? (
                        <Button size='small' disabled={busy || full} title={fullReason} onClick={() => void run(revision => setMemberHidden(member.id, false, revision))}>
                          <Eye className='w-3.5 h-3.5' />
                          <span>{t('repositories.show')}</span>
                        </Button>
                      )
                      : (
                        <Button size='small' disabled={busy || member.default} title={member.default ? t('repositories.defaultHide') : undefined} onClick={() => guarded(member, 'hide', revision => setMemberHidden(member.id, true, revision))}>
                          <EyeOff className='w-3.5 h-3.5' />
                          <span>{t('repositories.hide')}</span>
                        </Button>
                      )}
                    <Button size='small' variant='danger' disabled={busy || Boolean(removeBlocked)} title={removeBlocked || undefined} onClick={() => guarded(member, 'remove', revision => removeMember(member.id, revision))}>
                      <Trash2 className='w-3.5 h-3.5' />
                      <span>{t('repositories.remove')}</span>
                    </Button>
                  </div>
                )}
              </div>
              {reasons.map(reason => <p key={reason} className='text-xs text-muted'>{reason}</p>)}
              {status?.unavailable && <p className='text-xs text-danger'>{status.unavailable.message}</p>}
              {shared.length > 0 && (
                <p className='text-xs text-warning flex items-start gap-1.5'>
                  <AlertCircle className='w-3.5 h-3.5 shrink-0 mt-px' />
                  <span>{t('repositories.sharedKeys', { repositories: shared.map(other => `${other.alias} (${other.ids.map(id => `r2:${id}/`).join(', ')})`).join('; ') })}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {answer.hiddenUnnamed ? <p className='text-xs text-muted'>{t('repositories.hiddenUnnamed', { count: answer.hiddenUnnamed })}</p> : null}
      {answer.limit && <MembersLimitLine limit={answer.limit} refusal={limitRefusal} />}
      {changeable && answer.adds === 'repository' && (
        <div>
          <Button variant='primary' disabled={busy || full} title={fullReason} onClick={() => setAdding(true)}>
            <Plus className='w-3.5 h-3.5' />
            <span>{t('repositories.add')}</span>
          </Button>
        </div>
      )}
      {changeable && answer.adds !== 'repository' && (
        <form
          className='flex flex-col gap-2 p-3 rounded-xl border border-line bg-surface'
          onSubmit={event => {
            event.preventDefault();
            void add();
          }}
        >
          <label className='flex flex-col gap-1 text-xs'>
            <span className='font-semibold text-fg'>{t('repositories.addPath')}</span>
            <input className='ui-control' value={path} onChange={event => setPath(event.target.value)} placeholder='/Users/me/notes' aria-label={t('repositories.addPath')} disabled={busy} />
          </label>
          {folder !== undefined && (
            <label className='flex flex-col gap-1 text-xs'>
              <span className='font-semibold text-fg'>{t('repositories.addFolder')}</span>
              <span className='text-muted'>{t('repositories.addFolderHint')}</span>
              <input className='ui-control' value={folder} onChange={event => setFolder(event.target.value)} placeholder='notes' aria-label={t('repositories.addFolder')} disabled={busy} autoFocus />
            </label>
          )}
          <div>
            <Button type='submit' variant='primary' disabled={busy || !path.trim() || folder === ''}>
              <FolderGit2 className='w-3.5 h-3.5' />
              <span>{t('repositories.add')}</span>
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role='alert' className='p-3 rounded-lg text-xs flex items-start gap-2 bg-danger-soft text-danger border border-danger/40'>
          <AlertCircle className='w-4 h-4 shrink-0' />
          <span>{error}</span>
        </p>
      )}
      {adding && (
        <WorkspaceDialog title={t('repositories.addTitle')} onClose={() => setAdding(false)}>
          <p className='text-sm text-muted'>{t('repositories.addDescription')}</p>
          <RepositoryAddFlow
            members={answer}
            onAdded={added}
            onStale={load}
            onShow={async id => {
              if (await run(revision => setMemberHidden(id, false, revision))) setAdding(false);
            }}
          />
        </WorkspaceDialog>
      )}
      {confirm && (
        <WorkspaceDialog title={t(confirm.action === 'hide' ? 'repositories.confirmHideTitle' : 'repositories.confirmRemoveTitle', { alias: confirm.member.alias })} onClose={() => setConfirm(undefined)}>
          <p className='text-sm'>{t(confirm.action === 'hide' ? 'repositories.confirmHideBody' : 'repositories.confirmRemoveBody')}</p>
          {notices.map((render, index) => <div key={index} className='text-sm'>{render({ action: confirm.action, repository: { id: confirm.member.id, alias: confirm.member.alias, ...(confirm.member.repository ? { repository: confirm.member.repository } : {}) } })}</div>)}
          <div className='workspace-dialog-actions'>
            <Button onClick={() => setConfirm(undefined)}>{t('common.cancel')}</Button>
            <Button
              variant={confirm.action === 'remove' ? 'danger' : 'primary'}
              onClick={() => {
                const { change } = confirm;
                setConfirm(undefined);
                void run(change);
              }}
            >
              {t(confirm.action === 'hide' ? 'repositories.hide' : 'repositories.remove')}
            </Button>
          </div>
        </WorkspaceDialog>
      )}
      {drafts && (
        <WorkspaceDialog title={t(drafts.action === 'hide' ? 'repositories.draftsHideTitle' : 'repositories.draftsRemoveTitle', { alias: drafts.repository.alias })} onClose={() => setDrafts(undefined)}>
          <p className='text-sm'>{t('repositories.draftsBody', { count: drafts.drafts.length })}</p>
          <ul className='text-xs font-mono flex flex-col gap-1 max-h-48 overflow-auto'>{drafts.drafts.map(draft => <li key={`${draft.kind}:${draft.path}`}>{t(`repositories.draft.${draft.kind}`)}{' · '}{draft.path}</li>)}</ul>
          <div className='workspace-dialog-actions'>
            <Button onClick={() => setDrafts(undefined)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                setDrafts(undefined);
                onOpenChanges();
              }}
            >
              {t('repositories.openChanges')}
            </Button>
            <Button
              variant='danger'
              onClick={() => {
                discardRepositoryDrafts(drafts.repository);
                setDrafts(undefined);
                void onMembershipChanged();
              }}
            >
              {t('repositories.discardDrafts')}
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </div>
  );
}

function Heading() {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className='text-xs font-semibold text-fg uppercase tracking-wider flex items-center gap-1.5'>
        <FolderGit2 className='w-4 h-4 text-primary' />
        {t('repositories.title')}
      </h3>
      <p className='text-xs text-muted mt-0.5'>{t('repositories.description')}</p>
    </div>
  );
}
