// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DEFAULT_WORKSPACE_PREFERENCES } from '@mygitnotes/core/workspace-preferences';
import type { MembersAnswer, WorkspaceMemberStatus } from '../lib/members-api.js';
import type { WorkspaceRepository } from '../lib/workspace-repositories.js';
import { workingNotesKey } from '../lib/working-notes.js';
import { RepositoriesSettings, type RepositoriesSettingsProps } from './RepositoriesSettings.js';

const api = vi.hoisted(() => ({ fetchMembers: vi.fn(), setMemberHidden: vi.fn(), setDefaultMember: vi.fn(), removeMember: vi.fn(), reorderMembers: vi.fn(), addMember: vi.fn() }));
vi.mock('../lib/members-api.js', async importOriginal => ({ ...await importOriginal<typeof import('../lib/members-api.js')>(), ...api }));
const { MembershipApiError } = await import('../lib/members-api.js');

const member = (alias: string, flags: Partial<WorkspaceMemberStatus> = {}): WorkspaceMemberStatus => ({ id: `local:/work/${alias}`, alias, type: 'local', path: `/work/${alias}`, default: false, hidden: false, editable: 'server-file', ...flags });
const repository = (alias: string, ids: string[] = [alias]): WorkspaceRepository => ({ id: `local:/work/${alias}`, alias, type: 'local', branch: 'main', revision: '', write: true, notebooks: ids.map(id => `${alias}~${id}`), title: alias.toUpperCase(), defaultNotebook: `${alias}~${ids[0]}`, preferences: DEFAULT_WORKSPACE_PREFERENCES, config: null, configRevision: '' });
const answer = (members: WorkspaceMemberStatus[], overrides: Partial<MembersAnswer> = {}): MembersAnswer => ({ members, changeable: true, revision: 'rev-1', sharedAssetKeys: false, environment: 'MYGITNOTES_LOCAL_PATH', ...overrides });
const kb = member('kb', { default: true, editable: 'environment' }), journal = member('journal'), archive = member('archive', { hidden: true });
const show = (props: Partial<RepositoriesSettingsProps> = {}) => render(createElement(RepositoriesSettings, { repositories: [repository('kb'), repository('journal')], onMembershipChanged: vi.fn(async () => {}), onOpenChanges: vi.fn(), ...props }));
const row = (alias: string) => within(document.querySelector(`[data-member="${alias}"]`) as HTMLElement);

beforeEach(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  api.fetchMembers.mockResolvedValue(answer([kb, journal, archive]));
  for (const change of [api.setMemberHidden, api.setDefaultMember, api.removeMember, api.reorderMembers, api.addMember]) change.mockResolvedValue({ revision: 'rev-2' });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

it('lists hidden members with an unhide action, and keeps the default from being hidden or removed, saying why', async () => {
  const onMembershipChanged = vi.fn(async () => {});
  show({ onMembershipChanged });
  await screen.findByText('KB');
  expect(row('archive').getByText('Hidden')).toBeInTheDocument();
  expect(row('kb').getByRole('button', { name: 'Hide' })).toBeDisabled();
  expect(row('kb').getByRole('button', { name: 'Remove' })).toBeDisabled();
  expect(row('kb').getByText('The default repository cannot be hidden or removed. Make another repository the default first.')).toBeInTheDocument();
  expect(row('kb').getByText(/names this repository with MYGITNOTES_LOCAL_PATH, so Settings cannot remove it/)).toBeInTheDocument();
  fireEvent.click(row('archive').getByRole('button', { name: 'Show' }));
  await waitFor(() => expect(api.setMemberHidden).toHaveBeenCalledWith(archive.id, false, 'rev-1'));
  await waitFor(() => expect(onMembershipChanged).toHaveBeenCalled());
});

it('refuses to hide a repository this browser holds drafts for, names them, and offers Changes or discarding', async () => {
  const scope = `${journal.id}:main`;
  localStorage.setItem(workingNotesKey(scope), JSON.stringify({ 'notes/journal/today.md': { note: { path: 'notes/journal/today.md', notebookId: 'journal' }, base: null } }));
  const onOpenChanges = vi.fn();
  show({ onOpenChanges });
  await screen.findByText('JOURNAL');
  fireEvent.click(row('journal').getByRole('button', { name: 'Hide' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('Note · notes/journal/today.md')).toBeInTheDocument();
  expect(api.setMemberHidden).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Discard drafts' }));
  expect(localStorage.getItem(workingNotesKey(scope))).toBeNull();
  fireEvent.click(row('journal').getByRole('button', { name: 'Hide' }));
  await waitFor(() => expect(api.setMemberHidden).toHaveBeenCalledWith(journal.id, true, 'rev-1'));
  expect(onOpenChanges).not.toHaveBeenCalled();
});

it('refuses to remove a hidden repository this browser holds drafts for, found by the branch the list names', async () => {
  const hidden = member('archive', { hidden: true, branch: 'notes' });
  api.fetchMembers.mockResolvedValue(answer([kb, journal, hidden]));
  localStorage.setItem(workingNotesKey(`${hidden.id}:notes`), JSON.stringify({ 'notes/archive/old.md': { note: { path: 'notes/archive/old.md', notebookId: 'archive' }, base: null } }));
  show();
  await screen.findByText('JOURNAL');
  // The workspace did not load the hidden repository, so only the list says where its drafts are.
  fireEvent.click(row('archive').getByRole('button', { name: 'Remove' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByText('Note · notes/archive/old.md')).toBeInTheDocument();
  expect(api.removeMember).not.toHaveBeenCalled();
});

it('reloads the list and says so when it changed since it was read', async () => {
  api.setDefaultMember.mockRejectedValueOnce(new MembershipApiError('changed', 409, 'stale'));
  show();
  await screen.findByText('JOURNAL');
  fireEvent.click(row('journal').getByRole('button', { name: 'Make default' }));
  expect(await screen.findByText('The repository list changed since this page read it. It has been reloaded; try again.')).toBeInTheDocument();
  expect(api.fetchMembers).toHaveBeenCalledTimes(2);
});

it('asks for a folder when the added worktree has no manifest', async () => {
  api.addMember.mockRejectedValueOnce(new MembershipApiError('no manifest', 422, 'folder-required'));
  show();
  await screen.findByText('KB');
  fireEvent.change(screen.getByRole('textbox', { name: 'Add a repository: worktree path' }), { target: { value: '/work/scraps' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
  const folder = await screen.findByRole('textbox', { name: 'Notebook folder' });
  fireEvent.change(folder, { target: { value: 'notes/scraps' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
  await waitFor(() => expect(api.addMember).toHaveBeenLastCalledWith('/work/scraps', 'rev-1', 'notes/scraps'));
});

it('shows the members read-only where the administrator changes them, and the shared R2 keys of equal local ids', async () => {
  api.fetchMembers.mockResolvedValue(answer([member('kb', { default: true, editable: 'none' }), member('journal', { editable: 'none' })], { changeable: false, revision: null, sharedAssetKeys: true }));
  show({ repositories: [repository('kb', ['kb', 'inbox']), repository('journal', ['inbox'])] });
  expect(await screen.findByText(/The administrator changes them there and redeploys/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Add a repository: worktree path' })).toBeNull();
  expect(row('kb').getByText(/share keys with journal \(r2:inbox\/\)/)).toBeInTheDocument();
});

it("says how many repositories a hosted deployment's administrator hides, without names it was not told", async () => {
  api.fetchMembers.mockResolvedValue(answer([member('kb', { default: true, editable: 'none' })], { changeable: false, revision: null, hiddenUnnamed: 2 }));
  show({ repositories: [repository('kb')] });
  expect(await screen.findByText('The administrator also hides 2 repository(s), which this page does not name.')).toBeInTheDocument();
});

it("says a visitor-choice deployment's repository changes through Switch repository, not the configuration file", async () => {
  api.fetchMembers.mockResolvedValue(answer([member('notes', { default: true, editable: 'none' })], { changeable: false, revision: null, repositoryChoice: true }));
  show({ repositories: [repository('notes')] });
  expect(await screen.findByText('This deployment opens the one repository you chose. Use Switch repository to open another.')).toBeInTheDocument();
  expect(screen.queryByText(/The administrator changes them there/)).toBeNull();
});
